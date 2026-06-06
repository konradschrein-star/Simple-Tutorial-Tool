import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tutorialJobStatusEnum, tutorialModeEnum } from "./tutorial-enums.js";

export const tutorialJobs = pgTable(
  "tutorial_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    created_by: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    batch_id: uuid("batch_id"),

    // SIX_MIN_STITCH chaining: parent has mode=SIX_MIN_STITCH, children have parent_job_id set
    parent_job_id: uuid("parent_job_id").references(
      (): AnyPgColumn => tutorialJobs.id,
      { onDelete: "cascade" },
    ),
    segment_index: integer("segment_index"),

    title: text("title").notNull(),
    mode: tutorialModeEnum("mode").notNull(),
    status: tutorialJobStatusEnum("status").notNull().default("QUEUED"),
    progress: integer("progress").notNull().default(0),

    steps_input: text("steps_input").notNull().default(""),
    prompt_preset_id: uuid("prompt_preset_id"),
    custom_prompt: text("custom_prompt"),

    script_provider: text("script_provider").notNull(),
    script_model: text("script_model"),
    tts_provider: text("tts_provider").notNull(),
    tts_voice: text("tts_voice").notNull(),
    voice_settings: jsonb("voice_settings").$type<Record<string, unknown>>(),

    script_text: text("script_text"),
    audio_path: text("audio_path"),
    audio_duration_s: numeric("audio_duration_s", { precision: 10, scale: 3 }),
    playback_speed: numeric("playback_speed", { precision: 4, scale: 2 }),
    recording_path: text("recording_path"),
    recording_duration_s: numeric("recording_duration_s", {
      precision: 10,
      scale: 3,
    }),
    final_path: text("final_path"),

    target_minutes: integer("target_minutes"),
    ref_video_seconds: integer("ref_video_seconds"),

    delivered_to_drive: boolean("delivered_to_drive").notNull().default(false),

    error_stage: text("error_stage"),
    error_message: text("error_message"),
    error_detail: text("error_detail"),

    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    script_done_at: timestamp("script_done_at", { withTimezone: true }),
    audio_done_at: timestamp("audio_done_at", { withTimezone: true }),
    recorded_at: timestamp("recorded_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    createdByIdx: index("tutorial_jobs_created_by_idx").on(t.created_by),
    statusIdx: index("tutorial_jobs_status_idx").on(t.status),
    batchIdx: index("tutorial_jobs_batch_id_idx").on(t.batch_id),
    parentJobIdx: index("tutorial_jobs_parent_job_id_idx").on(t.parent_job_id),
  }),
);
