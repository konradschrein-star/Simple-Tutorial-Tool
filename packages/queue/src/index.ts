/**
 * @repo/queue — typed BullMQ wiring for the Tutorial tool's three lanes.
 */
import { Queue, Worker, type QueueOptions, type WorkerOptions, type Processor } from "bullmq";
import type { Redis } from "ioredis";
import type {
  TutorialGeneratePayload,
  TutorialSplicePayload,
  TutorialStitchPayload,
} from "@repo/contracts";

export { createRedisConnection, closeRedisConnection } from "./connection.js";
export type { RedisConnectionOptions } from "./connection.js";
export {
  attachStandardEventListeners,
  attachProgressEventListener,
  attachAllEventListeners,
} from "./events/event-helpers.js";

export const QUEUE_NAMES = {
  TUTORIAL_GENERATE: "queue-tutorial-generate",
  TUTORIAL_SPLICE: "queue-tutorial-splice",
  TUTORIAL_STITCH: "queue-tutorial-stitch",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const baseQueueOptions: Omit<QueueOptions, "connection"> = {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
};

const baseWorkerOptions: Omit<WorkerOptions, "connection"> = {
  stalledInterval: 30_000,
  maxStalledCount: 2,
};

// ── Queue factories ─────────────────────────────────────────────────────────
export function createTutorialGenerateQueue(connection: Redis): Queue<TutorialGeneratePayload> {
  return new Queue<TutorialGeneratePayload>(QUEUE_NAMES.TUTORIAL_GENERATE, { connection, ...baseQueueOptions });
}
export function createTutorialSpliceQueue(connection: Redis): Queue<TutorialSplicePayload> {
  return new Queue<TutorialSplicePayload>(QUEUE_NAMES.TUTORIAL_SPLICE, { connection, ...baseQueueOptions });
}
export function createTutorialStitchQueue(connection: Redis): Queue<TutorialStitchPayload> {
  return new Queue<TutorialStitchPayload>(QUEUE_NAMES.TUTORIAL_STITCH, { connection, ...baseQueueOptions });
}

// ── Worker factories ────────────────────────────────────────────────────────
export function createTutorialGenerateWorker(connection: Redis, processor: Processor<TutorialGeneratePayload>): Worker<TutorialGeneratePayload> {
  return new Worker<TutorialGeneratePayload>(QUEUE_NAMES.TUTORIAL_GENERATE, processor, {
    connection, ...baseWorkerOptions, concurrency: 6, lockDuration: 30 * 60 * 1000,
  });
}
export function createTutorialSpliceWorker(connection: Redis, processor: Processor<TutorialSplicePayload>): Worker<TutorialSplicePayload> {
  return new Worker<TutorialSplicePayload>(QUEUE_NAMES.TUTORIAL_SPLICE, processor, {
    connection, ...baseWorkerOptions, concurrency: 4, lockDuration: 30 * 60 * 1000,
  });
}
export function createTutorialStitchWorker(connection: Redis, processor: Processor<TutorialStitchPayload>): Worker<TutorialStitchPayload> {
  return new Worker<TutorialStitchPayload>(QUEUE_NAMES.TUTORIAL_STITCH, processor, {
    connection, ...baseWorkerOptions, concurrency: 1, lockDuration: 20 * 60 * 1000, lockRenewTime: 5 * 60 * 1000,
  });
}
