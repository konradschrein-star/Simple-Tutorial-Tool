"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { saveProviderKey } from "@/lib/services/tutorial-secret-service";
import { db } from "@/lib/db";
import {
  createPromptPreset,
  updatePromptPreset,
  updateTutorialSettings,
} from "@repo/db";
import { VoiceSettingsSchema } from "@repo/contracts";

type ActionResult = { success: boolean; error?: string };

const SaveKeySchema = z.object({
  capability: z.enum(["LLM", "TTS"]),
  provider: z.string().min(1),
  apiKey: z.string().min(8),
});

export async function saveTutorialProviderKey(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:tutorial-settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = SaveKeySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    await saveProviderKey({ ...parsed.data, userId: session.userId });
    revalidatePath("/production");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ── Prompt presets ───────────────────────────────────────────────────────────

const CreatePromptSchema = z.object({
  category: z.enum(["THREE_MIN", "SIX_MIN", "SIX_MIN_STITCH"]),
  name: z.string().min(1).max(120),
  system_prompt: z.string().min(10),
});

export async function createTutorialPrompt(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:tutorial-settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = CreatePromptSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    await createPromptPreset(db, {
      ...parsed.data,
      created_by: session.userId,
      is_seeded: false,
      is_default: false,
    });
    revalidatePath("/production");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

const UpdatePromptSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  system_prompt: z.string().min(10).optional(),
});

export async function updateTutorialPrompt(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:tutorial-settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = UpdatePromptSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    const { id, ...data } = parsed.data;
    await updatePromptPreset(db, id, data);
    revalidatePath("/production");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

const UpdateSettingsSchema = z.object({
  default_script_provider: z.string().min(1).optional(),
  default_tts_provider: z.string().min(1).optional(),
  default_tts_voice: z.string().optional(),
  default_playback_speed: z.number().min(0.5).max(2.5).optional(),
  record_hotkey: z.string().min(1).optional(),
  retention_hours: z.number().int().min(1).max(720).optional(),
  default_voice_settings: VoiceSettingsSchema.optional(),
  // Silence Cap (audio post-processing)
  silence_cap_enabled: z.boolean().optional(),
  silence_cap_max_ms: z.number().int().min(50).max(2000).optional(),
  silence_cap_threshold_db: z.number().int().min(-60).max(-10).optional(),
});

export async function updateTutorialSettingsAction(
  input: unknown,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage:tutorial-settings")) {
    return { success: false, error: "Unauthorized" };
  }
  const parsed = UpdateSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    const data = parsed.data;
    await updateTutorialSettings(db, {
      ...data,
      default_playback_speed: data.default_playback_speed
        ? String(data.default_playback_speed)
        : undefined,
    });
    revalidatePath("/production");
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
