import { eq } from "drizzle-orm";
import { googleDriveConnections } from "../schema/google-drive-connections.js";
import type { DrizzleClient } from "../client.js";

export type GoogleDriveConnectionRow =
  typeof googleDriveConnections.$inferSelect;
export type GoogleDriveConnectionInsert =
  typeof googleDriveConnections.$inferInsert;

export async function getDriveConnection(
  db: DrizzleClient,
  userId: string,
): Promise<GoogleDriveConnectionRow | undefined> {
  const [row] = await db
    .select()
    .from(googleDriveConnections)
    .where(eq(googleDriveConnections.user_id, userId))
    .limit(1);
  return row;
}

/** Insert or replace a user's Drive connection (one row per user). */
export async function upsertDriveConnection(
  db: DrizzleClient,
  data: GoogleDriveConnectionInsert,
): Promise<GoogleDriveConnectionRow> {
  const [row] = await db
    .insert(googleDriveConnections)
    .values(data)
    .onConflictDoUpdate({
      target: googleDriveConnections.user_id,
      set: {
        google_email: data.google_email,
        refresh_ciphertext: data.refresh_ciphertext,
        refresh_iv: data.refresh_iv,
        refresh_auth_tag: data.refresh_auth_tag,
        folder_id: data.folder_id,
        folder_name: data.folder_name,
        autoupload_enabled: data.autoupload_enabled,
        updated_at: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function setDriveAutoupload(
  db: DrizzleClient,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(googleDriveConnections)
    .set({ autoupload_enabled: enabled, updated_at: new Date() })
    .where(eq(googleDriveConnections.user_id, userId));
}

export async function setDriveFolder(
  db: DrizzleClient,
  userId: string,
  folderId: string,
  folderName: string,
): Promise<void> {
  await db
    .update(googleDriveConnections)
    .set({
      folder_id: folderId,
      folder_name: folderName,
      updated_at: new Date(),
    })
    .where(eq(googleDriveConnections.user_id, userId));
}

export async function deleteDriveConnection(
  db: DrizzleClient,
  userId: string,
): Promise<void> {
  await db
    .delete(googleDriveConnections)
    .where(eq(googleDriveConnections.user_id, userId));
}
