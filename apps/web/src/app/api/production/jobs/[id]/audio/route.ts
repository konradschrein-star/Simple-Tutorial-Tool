import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { readFile, stat } from "fs/promises";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/audio
 * Stream the generated TTS audio (audio_path) as audio/mpeg.
 * Used by the Studio player to play the voiceover during recording.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!job.audio_path) {
    return NextResponse.json(
      { error: "Audio not yet generated" },
      { status: 404 },
    );
  }

  try {
    const audioBuffer = await readFile(job.audio_path);
    const fileStats = await stat(job.audio_path);

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": fileStats.size.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Failed to serve tutorial audio", err);
    return NextResponse.json(
      { error: "Failed to read audio file" },
      { status: 500 },
    );
  }
}
