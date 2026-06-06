import type { Job, Queue } from "bullmq";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TutorialGeneratePayload, VoiceSettings } from "@repo/contracts";
import {
  TutorialGeneratePayloadSchema,
  TUTORIAL_PROVIDERS,
} from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import {
  getTutorialJobById,
  updateTutorialJob,
  getPromptPresetById,
  getSecretRow,
  getTutorialSettings,
  createTutorialJob,
} from "@repo/db";
import { generateScript } from "../../utils/tutorial/llm-registry.js";
import { createTutorialTTSProvider } from "../../utils/tutorial/tts-registry.js";
import { decryptSecret } from "../../utils/tutorial/secret-box.js";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "./media";

// Max characters per TTS request. AI33's ElevenLabs V3 leg was verified to fully
// render single requests of 2.9k and 3.8k chars (no truncation), so we keep each
// block under 3500 and split ONLY at sentence boundaries — never mid-sentence.
// With this cap a 3-min script (~2.7-3.3k chars) is a SINGLE request, and a
// 6-min script (~5-6k) becomes two sentence-aligned halves.
const MAX_TTS_CHARS = 3500;

/**
 * Split text into sentences, keeping each sentence's trailing punctuation and
 * whitespace so they re-join seamlessly.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]*[.!?]+["')\]]*\s*|[^.!?]+$/g);
  if (!matches) return [text.trim()].filter((s) => s.length > 0);
  return matches.filter((s) => s.trim().length > 0);
}

/**
 * Pack a script into the FEWEST blocks where each is <= MAX_TTS_CHARS, breaking
 * ONLY at sentence boundaries (never mid-sentence). A 3-minute script fits in a
 * single block; a 6-minute script becomes two sentence-aligned halves. A lone
 * sentence longer than the cap is sent on its own (unavoidable).
 */
function chunkScript(script: string): string[] {
  const text = script.trim();
  if (text.length <= MAX_TTS_CHARS) return [text];
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > MAX_TTS_CHARS) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim().length > 0) chunks.push(cur.trim());
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Normalize a script for TTS so the voice reads it as one continuous take.
 *
 * The ElevenLabs V3 voice model interprets blank lines / line breaks as cues
 * for long, theatrical DEAD-AIR pauses (verified: ~0.5s of true silence at
 * every "\n\n"). Strung together these sound like edits/cuts in the narration.
 * Collapsing every run of line breaks + surrounding whitespace down to a single
 * space removes those pause cues WITHOUT touching a single spoken word, and
 * WITHOUT changing the stored script_text the VA reads in the Review step —
 * this transform applies only to the text handed to the TTS provider.
 */
function normalizeForTts(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]*\n(?:[ \t]*\n)+[ \t]*/g, " ") // blank-line paragraph breaks
    .replace(/[ \t]*\n[ \t]*/g, " ") // remaining single line breaks
    .replace(/[ \t]{2,}/g, " ") // collapse runs of spaces/tabs
    .trim();
}

/**
 * Map a provider id (e.g. "ai33_elevenlabs", "minimax_llm") to the
 * encrypted_secrets `provider` slot it uses (e.g. "ai33", "minimax").
 * Returns null when the provider needs no stored key (e.g. gemini_pool).
 */
function resolveSecretProvider(
  type: "llm" | "tts",
  providerId: string,
): string | null {
  const list = type === "llm" ? TUTORIAL_PROVIDERS.llm : TUTORIAL_PROVIDERS.tts;
  return list.find((p) => p.id === providerId)?.secretProvider ?? null;
}

// ── Per-API-key TTS concurrency balancer ────────────────────────────────────
// AI33 allows ~3 concurrent requests per key. We track in-flight TTS jobs per
// key slot (ai33 / ai33-2 / ai33-3) and assign each job to the least-loaded
// slot, so with 2 keys + the generate worker running 6 jobs at once, load stays
// balanced at ~3 per key instead of randomly piling onto one.
const ttsKeyInFlight = new Map<string, number>();
function acquireLeastLoadedKeySlot(slots: string[]): {
  slot: string;
  release: () => void;
} {
  let best = slots[0]!;
  let bestN = ttsKeyInFlight.get(best) ?? 0;
  for (const s of slots) {
    const n = ttsKeyInFlight.get(s) ?? 0;
    if (n < bestN) {
      best = s;
      bestN = n;
    }
  }
  ttsKeyInFlight.set(best, bestN + 1);
  let released = false;
  return {
    slot: best,
    release: () => {
      if (released) return;
      released = true;
      ttsKeyInFlight.set(
        best,
        Math.max(0, (ttsKeyInFlight.get(best) ?? 1) - 1),
      );
    },
  };
}

/**
 * Tutorial Generate Processor
 *
 * Handles two stages of tutorial generation:
 *   - "script": Fetches prompt preset, decrypts LLM API key, calls LLM to generate script,
 *               saves script_text + dispatches "tts" stage.
 *   - "tts": Decrypts TTS API key, generates audio in chunks via TTSProvider,
 *             concatenates with ffmpeg, saves audio_path + dispatches splice queue.
 */
/**
 * Word-count based segmenter for SIX_MIN_STITCH mode.
 * Splits a master script into segments of ~SEGMENT_WORDS words,
 * breaking at paragraph or sentence boundaries.
 */
const SEGMENT_WORDS = 900; // ~6 min at ~150 words/min

function segmentScriptByWords(script: string): string[] {
  const paragraphs = script.split(/\n\n+/);
  const segments: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter(Boolean).length;
    if (wordCount > 0 && wordCount + paraWords > SEGMENT_WORDS) {
      // Flush current segment
      segments.push(current.join("\n\n").trim());
      current = [para];
      wordCount = paraWords;
    } else {
      current.push(para);
      wordCount += paraWords;
    }
  }
  if (current.length > 0) {
    segments.push(current.join("\n\n").trim());
  }

  // If we ended up with a single segment anyway, return it
  if (segments.length === 0) return [script.trim()];
  return segments;
}

export function createTutorialGenerateProcessor(
  db: DrizzleClient,
  queues: {
    tutorialGenerate: Queue<TutorialGeneratePayload>;
  },
) {
  return async (job: Job<TutorialGeneratePayload>) => {
    const { jobId, stage } = TutorialGeneratePayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Tutorial generate processor started",
        job_id: jobId,
        stage,
      }),
    );

    const tutorialJob = await getTutorialJobById(db, jobId);
    if (!tutorialJob) {
      throw new Error(`Tutorial job ${jobId} not found`);
    }

    try {
      if (stage === "script") {
        await updateTutorialJob(db, jobId, {
          status: "GENERATING_SCRIPT",
          progress: 10,
        });

        // Fetch prompt text
        let promptText = tutorialJob.custom_prompt ?? "";
        if (!promptText && tutorialJob.prompt_preset_id) {
          const preset = await getPromptPresetById(
            db,
            tutorialJob.prompt_preset_id,
          );
          if (!preset) {
            throw new Error(
              `Prompt preset ${tutorialJob.prompt_preset_id} not found`,
            );
          }
          promptText = preset.system_prompt;
        }
        if (!promptText) {
          throw new Error(`No prompt found for tutorial job ${jobId}`);
        }

        // Build full prompt with the tutorial title (so the SEO opener can name
        // the exact task/app) and the steps.
        const titleLine = `Tutorial title: ${tutorialJob.title}`;
        const fullPrompt = tutorialJob.steps_input
          ? `${promptText}\n\n${titleLine}\n\nSteps:\n${tutorialJob.steps_input}`
          : `${promptText}\n\n${titleLine}`;

        // Decrypt LLM API key (look it up by the provider's secret slot,
        // e.g. id "minimax_llm" -> secret provider "minimax").
        const llmSecretProvider = resolveSecretProvider(
          "llm",
          tutorialJob.script_provider,
        );
        const llmSecretRow = llmSecretProvider
          ? await getSecretRow(db, llmSecretProvider, "LLM")
          : undefined;
        let llmApiKey = "";
        if (llmSecretRow) {
          llmApiKey = decryptSecret({
            ciphertext: llmSecretRow.ciphertext,
            iv: llmSecretRow.iv,
            authTag: llmSecretRow.auth_tag,
          });
        }

        // Generate script via LLM registry
        const scriptText = await generateScript({
          provider: tutorialJob.script_provider,
          prompt: fullPrompt,
          apiKey: llmApiKey,
          model: tutorialJob.script_model ?? undefined,
        });

        // ── SIX_MIN_STITCH parent branch ────────────────────────────────────
        // Guard: only enter this branch when this job IS the parent
        // (mode == SIX_MIN_STITCH AND parent_job_id IS NULL).
        if (
          tutorialJob.mode === "SIX_MIN_STITCH" &&
          tutorialJob.parent_job_id === null
        ) {
          // Save master script on the parent, move parent to AWAITING_UPLOAD
          // (it waits for all child recordings to be spliced & COMPLETED).
          await updateTutorialJob(db, jobId, {
            script_text: scriptText,
            script_done_at: new Date(),
            status: "AWAITING_UPLOAD",
            progress: 100,
          });

          // Split master script into word-capped segments
          const segments = segmentScriptByWords(scriptText);

          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial SIX_MIN_STITCH: creating child segments",
              parent_job_id: jobId,
              segment_count: segments.length,
            }),
          );

          // Create a child job per segment and immediately dispatch its TTS stage
          for (let i = 0; i < segments.length; i++) {
            const child = await createTutorialJob(db, {
              created_by: tutorialJob.created_by,
              parent_job_id: jobId,
              segment_index: i,
              title: `${tutorialJob.title} — Part ${i + 1}`,
              mode: "SIX_MIN",
              status: "GENERATING_AUDIO",
              steps_input: "",
              prompt_preset_id: tutorialJob.prompt_preset_id,
              custom_prompt: tutorialJob.custom_prompt,
              script_provider: tutorialJob.script_provider,
              script_model: tutorialJob.script_model,
              tts_provider: tutorialJob.tts_provider,
              tts_voice: tutorialJob.tts_voice,
              voice_settings: tutorialJob.voice_settings ?? undefined,
              script_text: segments[i],
              script_done_at: new Date(),
            });

            await queues.tutorialGenerate.add(
              "tutorial-generate",
              { jobId: child.id, stage: "tts" },
              { jobId: `tutorial-generate-tts-${child.id}`, attempts: 3 },
            );
          }

          // Parent processing is complete for now — it waits for children
          return;
        }
        // ── End SIX_MIN_STITCH parent branch ────────────────────────────────

        await updateTutorialJob(db, jobId, {
          script_text: scriptText,
          script_done_at: new Date(),
          status: "GENERATING_AUDIO",
          progress: 40,
        });

        console.log(
          JSON.stringify({
            level: "info",
            message: "Tutorial script generated",
            job_id: jobId,
            script_length: scriptText.length,
          }),
        );

        // Dispatch TTS stage
        await queues.tutorialGenerate.add(
          "tutorial-generate",
          { jobId, stage: "tts" },
          { jobId: `tutorial-generate-tts-${jobId}`, attempts: 3 },
        );
      } else {
        // stage === "tts"
        await updateTutorialJob(db, jobId, {
          status: "GENERATING_AUDIO",
          progress: 45,
        });

        const scriptText = tutorialJob.script_text;
        if (!scriptText) {
          throw new Error(
            `Tutorial job ${jobId} has no script_text for TTS stage`,
          );
        }

        // Decrypt TTS API key. A provider slot may hold multiple keys ("ai33",
        // "ai33-2", "ai33-3"); assign this job to the LEAST-loaded key so no key
        // exceeds ~3 concurrent requests (held until the chunk loop finishes).
        const ttsSecretProvider = resolveSecretProvider(
          "tts",
          tutorialJob.tts_provider,
        );
        // All available keys for this provider, least-loaded FIRST. The happy
        // path uses the balanced key (ttsApiKeys[0]); on failure we rotate to
        // the other key(s) for redundancy before changing backend.
        let ttsApiKeys: string[] = [];
        let releaseKeySlot: (() => void) | null = null;
        if (ttsSecretProvider) {
          const slotNames = [
            ttsSecretProvider,
            `${ttsSecretProvider}-2`,
            `${ttsSecretProvider}-3`,
          ];
          const slotRows = await Promise.all(
            slotNames.map(async (name) => ({
              name,
              row: await getSecretRow(db, name, "TTS"),
            })),
          );
          const available = slotRows.filter((s) => Boolean(s.row));
          if (available.length > 0) {
            const acquired = acquireLeastLoadedKeySlot(
              available.map((s) => s.name),
            );
            releaseKeySlot = acquired.release;
            // Acquired (least-loaded) slot first, then the rest as fallbacks.
            const ordered = [
              ...available.filter((s) => s.name === acquired.slot),
              ...available.filter((s) => s.name !== acquired.slot),
            ];
            ttsApiKeys = ordered.map((s) =>
              decryptSecret({
                ciphertext: s.row!.ciphertext,
                iv: s.row!.iv,
                authTag: s.row!.auth_tag,
              }),
            );
          }
        }

        // Merge default_voice_settings from settings with job-level voice_settings.
        // Job-level wins over defaults.
        const tutorialSettingsRow = await getTutorialSettings(db);
        const defaultVs = (tutorialSettingsRow.default_voice_settings ??
          {}) as Record<string, unknown>;
        const jobVs = (tutorialJob.voice_settings ?? {}) as Record<
          string,
          unknown
        >;
        const mergedVs: VoiceSettings = {
          ...defaultVs,
          ...jobVs,
        } as VoiceSettings;

        const outputDir = join(LOCAL_MEDIA_ROOT, "tutorial", jobId);
        await mkdir(outputDir, { recursive: true });

        // Strip line/paragraph breaks before TTS so the V3 voice reads the
        // narration continuously instead of inserting long dead-air pauses at
        // every blank line (which sound like cuts). Words are unchanged.
        const ttsScript = normalizeForTts(scriptText);
        const chunks = chunkScript(ttsScript);
        const chunkPaths: string[] = [];

        // ── TTS fallback chain ────────────────────────────────────────────────
        // AI33's V3 backends (ElevenLabs, Minimax) hit intermittent
        // *_chunk_error outages. For reliability we try an ordered chain of
        // (backend, voice) and, within each, EVERY available API key, taking the
        // first combination that succeeds. A whole take is always produced by a
        // single (backend, voice) so the finished video keeps one consistent
        // voice. The fallback voices below were chosen by the operator.
        type TtsAttempt = { providerId: string; voice: string };
        const attempts: TtsAttempt[] = [
          { providerId: tutorialJob.tts_provider, voice: tutorialJob.tts_voice },
        ];
        if (ttsSecretProvider === "ai33") {
          // The same AI33 keys drive every AI33 backend, so these cost no extra
          // credentials. Minimax first (operator's preferred fallback), then
          // Kokoro as a last resort.
          for (const fb of [
            { providerId: "ai33_v3", voice: "minimax_209533299589189" },
            { providerId: "ai33_v3", voice: "kokoro_bm_lewis" },
          ]) {
            if (
              !attempts.some(
                (a) => a.providerId === fb.providerId && a.voice === fb.voice,
              )
            ) {
              attempts.push(fb);
            }
          }
        }

        // Generate every chunk's audio with one provider/voice, advancing the
        // 45→90 progress band as chunks complete.
        const generateChunkBuffers = async (
          provider: ReturnType<typeof createTutorialTTSProvider>,
          voice: string,
        ): Promise<Buffer[]> => {
          const buffers: Buffer[] = [];
          for (let i = 0; i < chunks.length; i++) {
            console.log(
              JSON.stringify({
                level: "info",
                message: "Generating TTS chunk",
                job_id: jobId,
                chunk_index: i,
                chunk_count: chunks.length,
                voice,
              }),
            );
            buffers.push(await provider.generateChunk(chunks[i]!, voice));
            await updateTutorialJob(db, jobId, {
              progress: 45 + Math.round(((i + 1) / chunks.length) * 45),
            });
          }
          return buffers;
        };

        try {
          // Walk the (backend, voice) × key matrix; first success wins.
          let audioBuffers: Buffer[] | null = null;
          let lastErr: unknown;
          for (const att of attempts) {
            if (audioBuffers) break;
            for (let ki = 0; ki < ttsApiKeys.length; ki++) {
              const isPrimary = att === attempts[0] && ki === 0;
              try {
                const provider = createTutorialTTSProvider(
                  att.providerId,
                  ttsApiKeys[ki]!,
                  { voice: att.voice, settings: mergedVs },
                );
                audioBuffers = await generateChunkBuffers(provider, att.voice);
                if (!isPrimary) {
                  console.warn(
                    JSON.stringify({
                      level: "warn",
                      message: "TTS recovered via fallback",
                      job_id: jobId,
                      provider: att.providerId,
                      voice: att.voice,
                      key_index: ki,
                    }),
                  );
                }
                break;
              } catch (err) {
                lastErr = err;
                console.warn(
                  JSON.stringify({
                    level: "warn",
                    message: "TTS attempt failed, trying next key/backend",
                    job_id: jobId,
                    provider: att.providerId,
                    voice: att.voice,
                    key_index: ki,
                    error: err instanceof Error ? err.message : String(err),
                  }),
                );
              }
            }
          }

          if (!audioBuffers) {
            throw lastErr instanceof Error
              ? lastErr
              : new Error("All TTS backends and keys failed");
          }

          for (let i = 0; i < audioBuffers.length; i++) {
            const chunkPath = join(outputDir, `tts-chunk-${i}.mp3`);
            await writeFile(chunkPath, audioBuffers[i]!);
            chunkPaths.push(chunkPath);
          }

          const audioPath = join(outputDir, "tts.mp3");
          const LOUDNORM = "loudnorm=I=-14:TP=-2:LRA=11";

          // Silence Cap (audio post-processing). Shorten every silence to at
          // most `silence_cap_max_ms`, treating audio quieter than
          // `silence_cap_threshold_db` as silence. This removes the dead-air
          // pauses the V3 voice leaves at sentence boundaries (which sound like
          // cuts) WITHOUT touching speech — silenceremove only trims samples
          // below the dB floor. Settings-driven + toggleable; when disabled the
          // raw TTS audio is kept exactly as generated. Runs BEFORE loudnorm.
          const capEnabled = tutorialSettingsRow.silence_cap_enabled ?? true;
          const capMaxSec = Math.max(
            0.05,
            (tutorialSettingsRow.silence_cap_max_ms ?? 250) / 1000,
          );
          const capThresholdDb =
            tutorialSettingsRow.silence_cap_threshold_db ?? -40;
          // Keep `capMaxSec` of REAL silence right before speech resumes
          // (stop_silence) plus a tiny lead-in, instead of hard-cutting onto a
          // non-zero sample. The earlier hard cut joined deep silence straight
          // onto the speech onset → an instantaneous waveform step → an audible
          // click/pop. Preserving the trailing silence lets the voice rise out
          // of silence naturally, eliminating the click. Net pause ≈ capMaxSec.
          const capFilter = capEnabled
            ? `silenceremove=stop_periods=-1:stop_duration=0.04:stop_threshold=${capThresholdDb}dB:stop_silence=${capMaxSec}`
            : null;
          const audioFilter = capFilter ? `${capFilter},${LOUDNORM}` : LOUDNORM;
          // Output CBR (constant bitrate) MP3 so the duration header is exact —
          // VBR concatenated MP3s can report a wrong (short) duration and make
          // players cut playback off before the end.
          if (chunkPaths.length === 1) {
            // Single chunk — silence-cap (if enabled) then normalise loudness.
            await execFileAsync(
              FFMPEG_BIN,
              [
                // -hide_banner + -loglevel error keep stderr tiny; without this
                // ffmpeg's per-frame progress on a long encode overflows the
                // child_process stderr buffer ("maxBuffer length exceeded").
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                chunkPaths[0]!,
                "-af",
                audioFilter,
                "-c:a",
                "libmp3lame",
                "-b:a",
                "192k",
                "-y",
                audioPath,
              ],
              { maxBuffer: 1024 * 1024 * 64 },
            );
          } else {
            // Multiple chunks — join with the concat FILTER (operates on decoded
            // samples) instead of the concat DEMUXER. The demuxer leaves audible
            // gaps/clicks between MP3s AND can clip the tail because of per-file
            // encoder/decoder priming; the filter is sample-accurate and gapless
            // and keeps the full ending. Then loudness-normalise the joined stream.
            const inputArgs = chunkPaths.flatMap((p) => ["-i", p]);
            const n = chunkPaths.length;
            const pre = chunkPaths
              .map((_, i) => `[${i}:a]aresample=44100[a${i}]`)
              .join(";");
            const labels = chunkPaths.map((_, i) => `[a${i}]`).join("");
            const filter = `${pre};${labels}concat=n=${n}:v=0:a=1[j];[j]${audioFilter}[out]`;
            await execFileAsync(
              FFMPEG_BIN,
              [
                "-hide_banner",
                "-loglevel",
                "error",
                ...inputArgs,
                "-filter_complex",
                filter,
                "-map",
                "[out]",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "192k",
                "-y",
                audioPath,
              ],
              { maxBuffer: 1024 * 1024 * 64 },
            );
          }

          await updateTutorialJob(db, jobId, {
            audio_path: audioPath,
            audio_done_at: new Date(),
            status: "READY_TO_RECORD",
            progress: 100,
          });

          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial TTS audio saved",
              job_id: jobId,
              audio_path: audioPath,
            }),
          );
        } finally {
          // Release this job's key slot so another job can use that key.
          releaseKeySlot?.();
          // Clean up chunk files
          for (const p of chunkPaths) {
            const { unlink } = await import("node:fs/promises");
            await unlink(p).catch(() => {});
          }
        }
      }

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial generate processor complete",
          job_id: jobId,
          stage,
        }),
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStage = stage === "script" ? "FAILED_SCRIPT" : "FAILED_AUDIO";

      console.error(
        JSON.stringify({
          level: "error",
          message: "Tutorial generate processor failed",
          job_id: jobId,
          stage,
          error: errorMessage,
        }),
      );

      try {
        await updateTutorialJob(db, jobId, {
          status: errorStage as "FAILED_SCRIPT" | "FAILED_AUDIO",
          error_stage: stage,
          error_message: errorMessage,
        });
      } catch {
        // no-op
      }
      throw err;
    }
  };
}
