// Boundary contracts for the Tutorial tool — Zod schemas, enums, queue payloads.

// === Enums ===
export { TutorialJobStatus } from "./enums/tutorial-job-status.js";
export { TutorialMode } from "./enums/tutorial-mode.js";
export { TutorialPromptCategory } from "./enums/tutorial-prompt-category.js";
export { SecretCapability } from "./enums/secret-capability.js";

// === Schemas ===
export {
  LLMProviderId,
  TTSProviderId,
  TUTORIAL_PROVIDERS,
  type ProviderMeta,
} from "./schemas/tutorial-provider.js";
export { VoiceSettingsSchema, type VoiceSettings } from "./schemas/voice-settings.js";
export {
  ErrorDetailSchema,
  buildErrorDetail,
  type ErrorDetail,
} from "./schemas/error-detail.js";

// === Queue Payloads ===
export {
  TutorialGeneratePayloadSchema,
  TutorialSplicePayloadSchema,
  TutorialStitchPayloadSchema,
  type TutorialGeneratePayload,
  type TutorialSplicePayload,
  type TutorialStitchPayload,
} from "./queue-payloads/tutorial-payloads.js";
