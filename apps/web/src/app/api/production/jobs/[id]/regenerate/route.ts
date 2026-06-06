import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById, updateTutorialJob } from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";

export const dynamic = "force-dynamic";

const RegenerateSchema = z.object({
  target: z.enum(["script", "audio"]),
});

/**
 * POST /api/production/jobs/[id]/regenerate
 * Re-queue a job for script or audio re-generation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
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

  const parsed = RegenerateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { target } = parsed.data;

  if (target === "script") {
    await updateTutorialJob(db, id, {
      status: "QUEUED",
      progress: 0,
      script_text: null,
      audio_path: null,
      audio_duration_s: null,
      audio_done_at: null,
      final_path: null,
      script_done_at: null,
      error_stage: null,
      error_message: null,
      error_detail: null,
    });
  } else {
    // audio only
    await updateTutorialJob(db, id, {
      status: "GENERATING_AUDIO",
      progress: 40,
      audio_path: null,
      audio_duration_s: null,
      audio_done_at: null,
      final_path: null,
      error_stage: null,
      error_message: null,
      error_detail: null,
    });
  }

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return NextResponse.json({ error: "REDIS_URL not set" }, { status: 500 });
  }
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialGenerateQueue(conn);
    const stage = target === "script" ? "script" : "tts";
    await queue.add(
      "tutorial-generate",
      { jobId: id, stage },
      {
        jobId: `tutorial-${stage}-regen-${id}-${Date.now()}`,
        attempts: 2,
      },
    );
  } finally {
    await conn.quit();
  }

  return NextResponse.json({ success: true });
}
