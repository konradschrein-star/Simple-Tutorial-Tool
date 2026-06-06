import { z } from "zod";

export const LLMProviderId = z.enum([
  "gemini_pool",
  "google_gemini",
  "minimax_llm",
  "openai",
  "qwen_hosted",
  "qwen_local", // coming soon
]);
export type LLMProviderId = z.infer<typeof LLMProviderId>;

export const TTSProviderId = z.enum([
  "ai33_elevenlabs",
  "ai33_minimax",
  "google_tts",
  "elevenlabs_official",
  "minimax_official",
  "qwen3_local", // coming soon
]);
export type TTSProviderId = z.infer<typeof TTSProviderId>;

export interface ProviderMeta {
  id: string;
  label: string;
  /** maps to encrypted_secrets.provider key; null if no key needed (e.g. gemini_pool uses env) */
  secretProvider: string | null;
  unreliable?: boolean;
  comingSoon?: boolean;
  isDefault?: boolean;
}

export const TUTORIAL_PROVIDERS: {
  llm: ProviderMeta[];
  tts: ProviderMeta[];
} = {
  llm: [
    {
      id: "gemini_pool",
      label: "Gemini Pool (free)",
      secretProvider: null,
      isDefault: true,
    },
    {
      id: "google_gemini",
      label: "Google Gemini (direct)",
      secretProvider: "google_gemini",
    },
    { id: "minimax_llm", label: "Minimax", secretProvider: "minimax" },
    { id: "openai", label: "OpenAI", secretProvider: "openai" },
    { id: "qwen_hosted", label: "Qwen 3 (hosted)", secretProvider: "qwen" },
    {
      id: "qwen_local",
      label: "Qwen 3 (local)",
      secretProvider: null,
      comingSoon: true,
    },
  ],
  tts: [
    {
      id: "ai33_elevenlabs",
      label: "ElevenLabs (via AI33)",
      secretProvider: "ai33",
      unreliable: true,
      isDefault: true,
    },
    {
      id: "ai33_minimax",
      label: "Minimax (via AI33)",
      secretProvider: "ai33",
      unreliable: true,
    },
    {
      id: "google_tts",
      label: "Google Text-to-Speech",
      secretProvider: "google_tts",
    },
    {
      id: "elevenlabs_official",
      label: "ElevenLabs (official)",
      secretProvider: "elevenlabs",
    },
    {
      id: "minimax_official",
      label: "Minimax (official)",
      secretProvider: "minimax_tts",
    },
    {
      id: "qwen3_local",
      label: "Qwen 3 (local)",
      secretProvider: null,
      comingSoon: true,
    },
  ],
};
