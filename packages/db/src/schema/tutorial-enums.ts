import { pgEnum } from "drizzle-orm/pg-core";

export const tutorialJobStatusEnum = pgEnum("tutorial_job_status", [
  "QUEUED",
  "GENERATING_SCRIPT",
  "GENERATING_AUDIO",
  "READY_TO_RECORD",
  "AWAITING_UPLOAD",
  "SPLICING",
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
]);

export const tutorialModeEnum = pgEnum("tutorial_mode", [
  "THREE_MIN",
  "SIX_MIN",
  "SIX_MIN_STITCH",
]);

export const tutorialPromptCategoryEnum = pgEnum("tutorial_prompt_category", [
  "THREE_MIN",
  "SIX_MIN",
  "SIX_MIN_STITCH",
]);

// capability identifies WHAT kind of key this is (LLM vs TTS).
// The specific provider is stored in the encrypted_secrets.provider text column.
export const secretCapabilityEnum = pgEnum("secret_capability", ["LLM", "TTS"]);
