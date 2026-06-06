import type { Job, Queue } from "bullmq";
import { join } from "node:path";
import type {
  TutorialSplicePayload,
  TutorialStitchPayload,
} from "@repo/contracts";
import { TutorialSplicePayloadSchema } from "@repo/contracts";
import type { DrizzleClient } from "@repo/db";
import {
  getTutorialJobById,
  updateTutorialJob,
  listTutorialJobsByParent,
} from "@repo/db";
import { probeMedia, muxTtsOntoRecording } from "@repo/media-core";
import { maybeUploadToDrive } from "../../utils/tutorial/google-drive-upload.js";

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "./media";

/**
 * Tutorial Splice Processor
 *
 * Muxes the TTS audio onto the screen recording:
 *   1. Probe recording duration
 *   2. Probe TTS audio duration
 *   3. Compute time-scale factor = audioDurationSeconds / recordingDurationSeconds
 *   4. FFmpeg mux — time-scales video to match 1x TTS audio, drops original mic audio
 *   5. Save final_path and mark COMPLETED
 */
export function createTutorialSpliceProcessor(
  db: DrizzleClient,
  queues: { tutorialStitch: Queue<TutorialStitchPayload> },
) {
  return async (job: Job<TutorialSplicePayload>) => {
    const { jobId } = TutorialSplicePayloadSchema.parse(job.data);

    console.log(
      JSON.stringify({
        level: "info",
        message: "Tutorial splice processor started",
        job_id: jobId,
      }),
    );

    const tutorialJob = await getTutorialJobById(db, jobId);
    if (!tutorialJob) {
      throw new Error(`Tutorial job ${jobId} not found`);
    }

    try {
      await updateTutorialJob(db, jobId, { status: "SPLICING", progress: 40 });

      const recordingPath = tutorialJob.recording_path;
      const ttsAudioPath = tutorialJob.audio_path;

      if (!recordingPath) {
        throw new Error(`Tutorial job ${jobId} has no recording_path`);
      }
      if (!ttsAudioPath) {
        throw new Error(`Tutorial job ${jobId} has no audio_path`);
      }

      // Probe both files to compute time-scale factor
      const [recordingProbe, ttsProbe] = await Promise.all([
        probeMedia(recordingPath),
        probeMedia(ttsAudioPath),
      ]);

      const recordingDurationS = recordingProbe.durationSeconds;
      const ttsDurationS = ttsProbe.durationSeconds;

      if (recordingDurationS <= 0) {
        throw new Error(
          `Recording duration is zero or negative for job ${jobId}`,
        );
      }
      if (ttsDurationS <= 0) {
        throw new Error(`TTS duration is zero or negative for job ${jobId}`);
      }

      // factor > 1 slows the video; factor < 1 speeds it up
      const factor = ttsDurationS / recordingDurationS;

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial splice: computed time-scale factor",
          job_id: jobId,
          recording_duration_s: recordingDurationS,
          tts_duration_s: ttsDurationS,
          factor,
        }),
      );

      const outputDir = join(LOCAL_MEDIA_ROOT, "tutorial", jobId);
      const outputPath = join(outputDir, "final.mp4");

      await muxTtsOntoRecording({
        recordingPath,
        ttsAudioPath,
        outputPath,
        factor,
      });

      const completedJob = await updateTutorialJob(db, jobId, {
        final_path: outputPath,
        recording_duration_s: String(recordingDurationS),
        status: "COMPLETED",
        completed_at: new Date(),
        progress: 100,
      });

      console.log(
        JSON.stringify({
          level: "info",
          message: "Tutorial splice processor complete",
          job_id: jobId,
          output_path: outputPath,
        }),
      );

      // Best-effort: auto-upload to the owner's Google Drive. Only for
      // standalone videos (stitch children skip this — the stitched parent is
      // the deliverable). Never fails the job if Drive is down/unconfigured.
      if (completedJob && !completedJob.parent_job_id) {
        try {
          const uploaded = await maybeUploadToDrive(
            db,
            completedJob,
            outputPath,
          );
          if (uploaded) {
            console.log(
              JSON.stringify({
                level: "info",
                message: "Tutorial uploaded to Google Drive",
                job_id: jobId,
              }),
            );
          }
        } catch (e) {
          console.error(
            JSON.stringify({
              level: "warn",
              message: "Tutorial Drive auto-upload failed (non-fatal)",
              job_id: jobId,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      }

      // ── SIX_MIN_STITCH sibling check ────────────────────────────────────
      // If this is a child segment, check whether all siblings are COMPLETED.
      // If they are, enqueue the stitch job for the parent (idempotent jobId).
      if (tutorialJob.parent_job_id) {
        const siblings = await listTutorialJobsByParent(
          db,
          tutorialJob.parent_job_id,
        );
        const allDone =
          siblings.length > 0 &&
          siblings.every((s) => s.status === "COMPLETED");
        if (allDone) {
          await queues.tutorialStitch.add(
            "tutorial-stitch",
            { parentJobId: tutorialJob.parent_job_id },
            {
              jobId: `tutorial-stitch-${tutorialJob.parent_job_id}`,
              attempts: 2,
            },
          );
          console.log(
            JSON.stringify({
              level: "info",
              message: "Tutorial stitch enqueued — all segments COMPLETED",
              parent_job_id: tutorialJob.parent_job_id,
              segment_count: siblings.length,
            }),
          );
        }
      }
      // ── End SIX_MIN_STITCH sibling check ────────────────────────────────
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      console.error(
        JSON.stringify({
          level: "error",
          message: "Tutorial splice processor failed",
          job_id: jobId,
          error: errorMessage,
        }),
      );

      try {
        await updateTutorialJob(db, jobId, {
          status: "FAILED_SPLICE",
          error_stage: "splice",
          error_message: errorMessage,
        });
      } catch {
        // no-op
      }
      throw err;
    }
  };
}
