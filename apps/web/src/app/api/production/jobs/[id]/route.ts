import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import {
  getTutorialJobById,
  updateTutorialJob,
  deleteTutorialJob,
  listTutorialJobsByParent,
} from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
  createTutorialSpliceQueue,
} from "@repo/queue";

export const dynamic = "force-dynamic";

/** Remove any pending BullMQ jobs for these tutorial job ids from both lanes. */
async function dequeue(ids: string[]) {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) return;
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const gen = createTutorialGenerateQueue(conn);
    const spl = createTutorialSpliceQueue(conn);
    const removals: Promise<unknown>[] = [];
    for (const id of ids) {
      removals.push(gen.remove(`tutorial-script-${id}`).catch(() => {}));
      removals.push(gen.remove(`tutorial-generate-tts-${id}`).catch(() => {}));
      removals.push(spl.remove(`tutorial-splice-${id}`).catch(() => {}));
    }
    await Promise.allSettled(removals);
  } finally {
    await conn.quit();
  }
}

/** Delete the on-disk media folders for these tutorial job ids. */
async function removeMedia(ids: string[]) {
  const mediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "./media";
  await Promise.allSettled(
    ids.map((id) =>
      rm(join(mediaRoot, "tutorial", id), { recursive: true, force: true }),
    ),
  );
}

/** owner-or-privileged check used by every method here. */
async function authorize(id: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return { error: "Forbidden", status: 403 as const };
  }
  const job = await getTutorialJobById(db, id);
  if (!job) return { error: "Not found", status: 404 as const };
  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { job };
}

/** A stitch parent + all its child segments; otherwise just the job itself. */
async function jobIdGroup(job: {
  id: string;
  mode: string;
  parent_job_id: string | null;
}): Promise<string[]> {
  if (job.mode === "SIX_MIN_STITCH" && job.parent_job_id === null) {
    const children = await listTutorialJobsByParent(db, job.id);
    return [job.id, ...children.map((c) => c.id)];
  }
  return [job.id];
}

/**
 * GET /api/production/jobs/[id]
 * Get a single tutorial job (owner or admin/manager only).
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

  return NextResponse.json({ job });
}

const PatchSchema = z.object({
  playback_speed: z.number().min(0.1).max(5),
});

/**
 * PATCH /api/production/jobs/[id]
 * Update mutable fields — currently only playback_speed.
 */
export async function PATCH(
  req: NextRequest,
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

  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const updated = await updateTutorialJob(db, id, {
    playback_speed: String(parsed.data.playback_speed),
  });

  return NextResponse.json({ job: updated });
}

/**
 * DELETE /api/production/jobs/[id]
 * Remove the job entirely: de-queue any pending work, delete its media folder,
 * and delete the row (child segments cascade). Owner or admin/manager.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const ids = await jobIdGroup(auth.job);
  await dequeue(ids);
  await removeMedia(ids);
  await deleteTutorialJob(db, id);
  return NextResponse.json({ success: true });
}

/**
 * POST /api/production/jobs/[id]  → cancel a stuck / in-progress job:
 * de-queue it and mark it CANCELLED (the row stays so the VA still sees it).
 * Owner or admin/manager.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.job.status === "COMPLETED") {
    return NextResponse.json(
      { error: "Job already completed — delete it instead." },
      { status: 400 },
    );
  }
  const ids = await jobIdGroup(auth.job);
  await dequeue(ids);
  for (const jid of ids) {
    await updateTutorialJob(db, jid, { status: "CANCELLED" });
  }
  return NextResponse.json({ success: true });
}
