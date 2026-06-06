import { Worker, Job } from "bullmq";
import type { JobProgress } from "bullmq";

/**
 * Event Helpers
 *
 * Reusable event listeners for BullMQ workers.
 * Provides structured logging for observability.
 *
 * Usage:
 * ```typescript
 * const worker = createIngestWorker(connection, processor);
 * attachStandardEventListeners(worker, "IngestWorker");
 * ```
 */

/**
 * Attach Standard Event Listeners
 *
 * Attaches completed, failed, and stalled event listeners to a worker.
 * Logs structured output for observability.
 *
 * @param worker - BullMQ Worker instance
 * @param workerName - Human-readable worker name for logs
 */
export function attachStandardEventListeners<T>(
  worker: Worker<T>,
  workerName: string,
): void {
  // Job completed successfully
  worker.on("completed", (job: Job<T>) => {
    console.log(
      JSON.stringify({
        event: "job_completed",
        status: "completed",
        worker: workerName,
        jobId: job.id,
        jobName: job.name,
        queueName: job.queueName,
        duration: job.finishedOn
          ? job.finishedOn - (job.processedOn || job.finishedOn)
          : 0,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Job failed
  worker.on("failed", (job: Job<T> | undefined, error: Error) => {
    console.error(
      JSON.stringify({
        event: "job_failed",
        status: "failed",
        worker: workerName,
        jobId: job?.id,
        jobName: job?.name,
        queueName: job?.queueName,
        failureReason: error.message,
        error: error.message,
        stack: error.stack,
        attemptsMade: job?.attemptsMade,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Job stalled (worker died mid-processing)
  worker.on("stalled", (jobId: string) => {
    console.warn(
      JSON.stringify({
        event: "job_stalled",
        worker: workerName,
        jobId,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Worker error (not job-specific)
  worker.on("error", (error: Error) => {
    console.error(
      JSON.stringify({
        event: "worker_error",
        worker: workerName,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  // Worker active (started processing a job)
  worker.on("active", (job: Job<T>) => {
    console.log(
      JSON.stringify({
        event: "job_active",
        worker: workerName,
        jobId: job.id,
        jobName: job.name,
        queueName: job.queueName,
        timestamp: new Date().toISOString(),
      }),
    );
  });
}

/**
 * Attach Progress Event Listener
 *
 * Logs job progress updates (when job.updateProgress() is called).
 *
 * @param worker - BullMQ Worker instance
 * @param workerName - Human-readable worker name for logs
 */
export function attachProgressEventListener<T>(
  worker: Worker<T>,
  workerName: string,
): void {
  worker.on("progress", (job: Job<T>, progress: JobProgress) => {
    console.log(
      JSON.stringify({
        event: "job_progress",
        worker: workerName,
        jobId: job.id,
        jobName: job.name,
        progress,
        timestamp: new Date().toISOString(),
      }),
    );
  });
}

/**
 * Attach All Event Listeners
 *
 * Convenience function to attach both standard and progress listeners.
 *
 * @param worker - BullMQ Worker instance
 * @param workerName - Human-readable worker name for logs
 */
export function attachAllEventListeners<T>(
  worker: Worker<T>,
  workerName: string,
): void {
  attachStandardEventListeners(worker, workerName);
  attachProgressEventListener(worker, workerName);
}
