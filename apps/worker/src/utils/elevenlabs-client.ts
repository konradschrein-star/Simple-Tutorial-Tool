/**
 * AI33 V3 TTS client — https://api.ai33.pro/v3/text-to-speech
 *
 * One client for every V3 backend (ElevenLabs, Minimax, Kokoro, Edge, cloned
 * voices) — the backend is selected by the voice_id prefix.
 *
 * Flow:
 *   1. POST /v3/text-to-speech (FormData) → { success: true, task_id }
 *   2. Poll GET /v3/task/{task_id} until data.status === "done"
 *   3. Download audio from data.metadata.audio_url
 *
 * AI33's ElevenLabs backend has intermittent outages that fail tasks with a
 * retryable `tts_chunk_error`. We retry the whole submit→poll cycle with
 * backoff on retryable failures so transient blips don't fail the job; sustained
 * outages are handled by falling back to a different backend (e.g. Kokoro).
 */

const AI33_BASE = "https://api.ai33.pro";

// Voice-id prefixes the V3 endpoint recognises; a bare id defaults to elevenlabs_.
const KNOWN_V3_PREFIXES = [
  "elevenlabs_",
  "minimax_",
  "clone_",
  "edge_",
  "kokoro_",
];
const POLL_INTERVAL_MS = 5000;
// 20 min hard ceiling. AI33's ElevenLabs leg has been processing 2.5 k char
// chunks in ~6-8 min, so the old 6-min cap abandoned completed tasks (AI33
// charges on submit, the worker never picked up the audio). A *progressing*
// task is allowed the full budget; a stalled one is cut much sooner (below).
const MAX_POLL_ATTEMPTS = 240;
// When AI33's pipeline is degraded a task submits, reports a low `progress`,
// and then sticks there forever. If progress stops advancing for this long we
// give up so the caller can fall back to another backend instead of waiting out
// the full 20-min budget on a task that will never finish.
const STALL_TIMEOUT_MS = 150000;

// Backoff (ms) BEFORE each attempt — immediate, then one retry after 8s. Just
// enough to ride out a momentary blip on this backend/key; sustained outages
// are handled by the caller's (backend, voice) × key fallback chain, so we keep
// per-combination time short instead of retrying a dead backend many times.
const RETRY_BACKOFFS_MS = [0, 8000];

export interface ElevenLabsTTSSettings {
  speed?: number;
  similarity?: number;
}

interface Ai33V3SubmitResponse {
  success: boolean;
  task_id?: string;
  message?: string;
  error?: { code?: string; message?: string };
}

interface Ai33V3TaskResponse {
  success: boolean;
  data?: {
    id: string;
    status: string; // "done" | "doing" | "error"
    progress?: number;
    metadata?: {
      audio_url?: string;
    };
    error_code?: string;
    error?: { code?: string; message?: string; retryable?: boolean };
  };
}

/** Error that knows whether the failure is worth retrying. */
class TTSError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "TTSError";
    this.retryable = retryable;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** One submit→poll→download cycle. Throws TTSError with a retryable flag. */
async function generateOnce(
  apiKey: string,
  voiceId: string,
  text: string,
  settings: ElevenLabsTTSSettings,
): Promise<Buffer> {
  const { speed = 1.0, similarity = 2 } = settings;

  // The V3 endpoint serves several backends keyed by the voice_id prefix
  // (elevenlabs_, minimax_, clone_, edge_, kokoro_). Only prepend the default
  // elevenlabs_ prefix when the caller passed a bare voice id.
  const v3VoiceId = KNOWN_V3_PREFIXES.some((p) => voiceId.startsWith(p))
    ? voiceId
    : `elevenlabs_${voiceId}`;
  // Kokoro and Edge are text-only — `similarity` must be omitted for them.
  const sendsSimilarity =
    v3VoiceId.startsWith("elevenlabs_") || v3VoiceId.startsWith("minimax_");
  const clampedSpeed = Math.min(1.5, Math.max(0.5, speed));

  const form = new FormData();
  form.append("text", text);
  form.append("voice_id", v3VoiceId);
  form.append("speed", String(clampedSpeed));
  if (sendsSimilarity) form.append("similarity", String(similarity));
  form.append("with_transcript", "false");

  const submitRes = await fetch(`${AI33_BASE}/v3/text-to-speech`, {
    method: "POST",
    headers: { Authorization: apiKey },
    body: form,
  });

  if (!submitRes.ok) {
    const body = await submitRes.text();
    // 5xx / 429 are transient; 4xx (bad request, auth) are not.
    const retryable = submitRes.status >= 500 || submitRes.status === 429;
    throw new TTSError(
      `ElevenLabs V3 TTS submit failed (${submitRes.status}): ${body.slice(0, 300)}`,
      retryable,
    );
  }

  const submitData = (await submitRes.json()) as Ai33V3SubmitResponse;
  if (!submitData.success || !submitData.task_id) {
    throw new TTSError(
      `ElevenLabs V3 TTS submit returned no task_id: ${JSON.stringify(submitData).slice(0, 200)}`,
      true,
    );
  }
  const taskId = submitData.task_id;

  let lastProgress = -1;
  let stagnantMs = 0;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${AI33_BASE}/v3/task/${taskId}`, {
      headers: { Authorization: apiKey },
    });
    if (!pollRes.ok) continue;

    let taskData: Ai33V3TaskResponse;
    try {
      taskData = (await pollRes.json()) as Ai33V3TaskResponse;
    } catch {
      // AI33 occasionally returns an empty body for an in-flight task — keep
      // polling the same task instead of treating it as a failure.
      continue;
    }
    const data = taskData.data;
    if (!data) continue;

    // Detect a stalled task: progress reported but not advancing. AI33's
    // degraded pipeline parks tasks at a low progress and never finishes them.
    const progress = typeof data.progress === "number" ? data.progress : null;
    if (
      progress !== null &&
      data.status !== "done" &&
      data.status !== "error"
    ) {
      if (progress > lastProgress) {
        lastProgress = progress;
        stagnantMs = 0;
      } else {
        stagnantMs += POLL_INTERVAL_MS;
        if (stagnantMs >= STALL_TIMEOUT_MS) {
          throw new TTSError(
            `TTS task ${taskId} stalled at progress ${progress} for ${STALL_TIMEOUT_MS / 1000}s`,
            false,
          );
        }
      }
    }

    if (data.status === "done") {
      const audioUrl = data.metadata?.audio_url;
      if (!audioUrl) {
        throw new TTSError(
          `TTS task ${taskId} done but no audio_url in metadata`,
          true,
        );
      }
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        throw new TTSError(
          `Failed to download TTS audio from ${audioUrl}: ${audioRes.status}`,
          true,
        );
      }
      return Buffer.from(await audioRes.arrayBuffer());
    }

    if (data.status === "error") {
      const errCode = data.error_code ?? data.error?.code ?? "unknown";
      const errMsg = data.error?.message ?? errCode;
      // AI33 tells us whether to retry (tts_chunk_error is retryable: true).
      const retryable = data.error?.retryable ?? true;
      throw new TTSError(
        `TTS task ${taskId} failed: ${errCode} (${errMsg})`,
        retryable,
      );
    }
  }

  throw new TTSError(
    `TTS task ${taskId} did not complete within ${(POLL_INTERVAL_MS * MAX_POLL_ATTEMPTS) / 1000}s`,
    // A task that burned the whole budget won't be helped by re-polling the
    // same backend — let the caller fall back instead.
    false,
  );
}

/**
 * Generate TTS audio, retrying the whole cycle with backoff on retryable AI33
 * failures (transient `tts_chunk_error`, 5xx, download/timeout). Non-retryable
 * failures (bad request, auth) throw immediately.
 */
export async function generateElevenLabsTTS(
  apiKey: string,
  voiceId: string,
  text: string,
  settings: ElevenLabsTTSSettings = {},
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_BACKOFFS_MS.length; attempt++) {
    if (RETRY_BACKOFFS_MS[attempt]) await sleep(RETRY_BACKOFFS_MS[attempt]!);
    try {
      return await generateOnce(apiKey, voiceId, text, settings);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof TTSError ? err.retryable : true;
      const isLastAttempt = attempt === RETRY_BACKOFFS_MS.length - 1;
      if (retryable && !isLastAttempt) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "AI33 TTS attempt failed, retrying",
            attempt: attempt + 1,
            of: RETRY_BACKOFFS_MS.length,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("TTS failed");
}
