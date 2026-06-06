import { db } from "@/lib/db";
import { upsertSecret, listSecretSlots } from "@repo/db";
import { encryptSecret, last4 } from "@/lib/crypto/secret-box";

export async function saveProviderKey(params: {
  capability: "LLM" | "TTS";
  provider: string;
  apiKey: string;
  userId: string;
}): Promise<void> {
  const box = encryptSecret(params.apiKey);
  await upsertSecret(db, {
    capability: params.capability,
    provider: params.provider,
    ciphertext: box.ciphertext,
    iv: box.iv,
    auth_tag: box.authTag,
    last4: last4(params.apiKey),
    userId: params.userId,
  });
}

export async function listProviderKeyMasks(): Promise<
  Array<{ capability: string; provider: string; last4: string }>
> {
  return listSecretSlots(db);
}
