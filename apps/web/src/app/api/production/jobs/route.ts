import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createTutorialJob, listTutorialJobsByUser } from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
} from "@repo/queue";
import { VoiceSettingsSchema } from "@repo/contracts";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(["THREE_MIN", "SIX_MIN", "SIX_MIN_STITCH"]),
  steps_input: z.string().default(""),
  prompt_preset_id: z.string().uuid().optional(),
  custom_prompt: z.string().optional(),
  script_provider: z.string().min(1),
  script_model: z.string().optional(),
  tts_provider: z.string().min(1),
  tts_voice: z.string().min(1),
  batch_id: z.string().uuid().optional(),
  voice_settings: VoiceSettingsSchema.optional(),
  // SIX_MIN_STITCH only
  target_minutes: z.number().int().positive().optional(),
  ref_video_seconds: z.number().int().positive().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const jobs = await listTutorialJobsByUser(db, session.userId, 100);
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const data = parsed.data;
  const job = await createTutorialJob(db, {
    created_by: session.userId,
    batch_id: data.batch_id ?? randomUUID(),
    title: data.title,
    mode: data.mode,
    steps_input: data.steps_input,
    prompt_preset_id: data.prompt_preset_id,
    custom_prompt: data.custom_prompt,
    script_provider: data.script_provider,
    script_model: data.script_model,
    tts_provider: data.tts_provider,
    tts_voice: data.tts_voice,
    voice_settings: data.voice_settings as Record<string, unknown> | undefined,
    target_minutes: data.target_minutes,
    ref_video_seconds: data.ref_video_seconds,
  });

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    return NextResponse.json({ error: "REDIS_URL not set" }, { status: 500 });
  }
  const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
  try {
    const queue = createTutorialGenerateQueue(conn);
    await queue.add(
      "tutorial-generate",
      { jobId: job.id, stage: "script" },
      { jobId: `tutorial-script-${job.id}`, attempts: 2 },
    );
  } finally {
    await conn.quit();
  }
  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
