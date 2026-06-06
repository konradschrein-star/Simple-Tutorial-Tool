import {
  pgTable,
  integer,
  text,
  numeric,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

// single-row settings; id is a fixed guard value of 1
export const tutorialSettings = pgTable("tutorial_settings", {
  id: integer("id").primaryKey().default(1),
  default_script_provider: text("default_script_provider")
    .notNull()
    .default("gemini_pool"),
  default_script_model: text("default_script_model"),
  default_tts_provider: text("default_tts_provider")
    .notNull()
    .default("ai33_elevenlabs"),
  default_tts_voice: text("default_tts_voice").notNull().default(""),
  default_playback_speed: numeric("default_playback_speed", {
    precision: 4,
    scale: 2,
  })
    .notNull()
    .default("1.00"),
  record_hotkey: text("record_hotkey").notNull().default("Space"),
  retention_hours: integer("retention_hours").notNull().default(48),
  drive_autoupload_enabled: boolean("drive_autoupload_enabled")
    .notNull()
    .default(false),
  // ── Silence Cap (audio post-processing) ──────────────────────────────────
  // After TTS, shorten every silence to at most `max_ms`, treating anything
  // quieter than `threshold_db` as silence. Only silence is trimmed — speech
  // is never cut. Off = raw TTS audio is kept exactly as generated.
  silence_cap_enabled: boolean("silence_cap_enabled").notNull().default(false),
  silence_cap_max_ms: integer("silence_cap_max_ms").notNull().default(250),
  silence_cap_threshold_db: integer("silence_cap_threshold_db")
    .notNull()
    .default(-40),
  default_voice_settings: jsonb("default_voice_settings").$type<
    Record<string, unknown>
  >(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
