import { and, eq } from "drizzle-orm";
import { encryptedSecrets } from "../schema/encrypted-secrets.js";
import type { DrizzleClient } from "../client.js";

export type EncryptedSecretRow = typeof encryptedSecrets.$inferSelect;

export interface UpsertSecretInput {
  namespace?: string;
  capability: "LLM" | "TTS";
  provider: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  last4: string;
  userId: string;
}

export async function upsertSecret(
  db: DrizzleClient,
  input: UpsertSecretInput,
): Promise<void> {
  const namespace = input.namespace ?? "tutorial-production";
  await db
    .insert(encryptedSecrets)
    .values({
      namespace,
      capability: input.capability,
      provider: input.provider,
      ciphertext: input.ciphertext,
      iv: input.iv,
      auth_tag: input.auth_tag,
      last4: input.last4,
      created_by: input.userId,
      updated_by: input.userId,
    })
    .onConflictDoUpdate({
      target: [
        encryptedSecrets.namespace,
        encryptedSecrets.capability,
        encryptedSecrets.provider,
      ],
      set: {
        ciphertext: input.ciphertext,
        iv: input.iv,
        auth_tag: input.auth_tag,
        last4: input.last4,
        updated_by: input.userId,
        updated_at: new Date(),
      },
    });
}

export async function getSecretRow(
  db: DrizzleClient,
  provider: string,
  capability: "LLM" | "TTS",
  namespace = "tutorial-production",
): Promise<EncryptedSecretRow | undefined> {
  const [row] = await db
    .select()
    .from(encryptedSecrets)
    .where(
      and(
        eq(encryptedSecrets.namespace, namespace),
        eq(encryptedSecrets.capability, capability),
        eq(encryptedSecrets.provider, provider),
      ),
    )
    .limit(1);
  return row;
}

export async function listSecretSlots(
  db: DrizzleClient,
  namespace = "tutorial-production",
): Promise<Array<{ capability: string; provider: string; last4: string }>> {
  return db
    .select({
      capability: encryptedSecrets.capability,
      provider: encryptedSecrets.provider,
      last4: encryptedSecrets.last4,
    })
    .from(encryptedSecrets)
    .where(eq(encryptedSecrets.namespace, namespace));
}
