import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById } from "@repo/db";
import { readFile, stat } from "fs/promises";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/jobs/[id]/download
 * Stream the completed final.mp4 as video/mp4 with Content-Disposition: attachment.
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

  if (job.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "Video not ready for download" },
      { status: 400 },
    );
  }

  if (!job.final_path) {
    return NextResponse.json(
      { error: "Video file path not available" },
      { status: 500 },
    );
  }

  try {
    const videoBuffer = await readFile(job.final_path);
    const fileStats = await stat(job.final_path);
    // Name downloads "<YYYY-MM-DD_HH-MM-SS>_<title>.mp4" so they sort by time
    // and are easy to find/search. Timestamp is the completion time in the
    // server's local zone (Europe/Berlin), matching what the UI shows.
    const d = new Date(job.completed_at ?? job.created_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const safeTitle = job.title
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    const filename = `${ts}_${safeTitle}.mp4`;

    return new NextResponse(videoBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": fileStats.size.toString(),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Failed to download tutorial video", err);
    return NextResponse.json(
      { error: "Failed to read video file" },
      { status: 500 },
    );
  }
}
