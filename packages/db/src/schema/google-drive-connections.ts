import {
  pgTable,
  uuid,
  text,
  boolean,
  customType,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// bytea column helper (Drizzle has no first-class bytea)
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * One row per user: their connected Google Drive for automatic upload of
 * finished tutorial videos. The OAuth refresh token is stored encrypted with
 * the same AES-256-GCM box (SECRETS_ENCRYPTION_KEY) used for provider API keys.
 * `folder_id` is an app-created "Tutorial Videos" folder in the user's own
 * Drive — with the drive.file scope the app can only see/write files it
 * creates, so we never touch the rest of the user's Drive.
 */
export const googleDriveConnections = pgTable("google_drive_connections", {
  user_id: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  google_email: text("google_email").notNull(),
  refresh_ciphertext: bytea("refresh_ciphertext").notNull(),
  refresh_iv: bytea("refresh_iv").notNull(),
  refresh_auth_tag: bytea("refresh_auth_tag").notNull(),
  folder_id: text("folder_id"),
  folder_name: text("folder_name").notNull().default("Tutorial Videos"),
  autoupload_enabled: boolean("autoupload_enabled").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
