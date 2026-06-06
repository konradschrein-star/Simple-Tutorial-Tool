import "dotenv/config";
import { createDrizzleClient } from "@repo/db";
import {
  createRedisConnection,
  createTutorialGenerateQueue,
  createTutorialSpliceQueue,
  createTutorialStitchQueue,
  createTutorialGenerateWorker,
  createTutorialSpliceWorker,
  createTutorialStitchWorker,
  attachAllEventListeners,
} from "@repo/queue";
import { createTutorialGenerateProcessor } from "./processors/tutorial/generate.js";
import { createTutorialSpliceProcessor } from "./processors/tutorial/splice.js";
import { createTutorialStitchProcessor } from "./processors/tutorial/stitch.js";
import { startTutorialCleanupInterval } from "./watchdog/tutorial-cleanup.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const redisUrl = required("REDIS_URL");

  const db = createDrizzleClient(databaseUrl);

  // BullMQ recommends separate connections for queues vs workers.
  const genQueueConn = createRedisConnection(redisUrl);
  const spliceQueueConn = createRedisConnection(redisUrl);
  const stitchQueueConn = createRedisConnection(redisUrl);
  const genWorkerConn = createRedisConnection(redisUrl);
  const spliceWorkerConn = createRedisConnection(redisUrl);
  const stitchWorkerConn = createRedisConnection(redisUrl);

  const tutorialGenerateQueue = createTutorialGenerateQueue(genQueueConn);
  const tutorialSpliceQueue = createTutorialSpliceQueue(spliceQueueConn);
  const tutorialStitchQueue = createTutorialStitchQueue(stitchQueueConn);

  const generateProcessor = createTutorialGenerateProcessor(db, {
    tutorialGenerate: tutorialGenerateQueue,
  });
  const spliceProcessor = createTutorialSpliceProcessor(db, {
    tutorialStitch: tutorialStitchQueue,
  });
  const stitchProcessor = createTutorialStitchProcessor(db);

  const generateWorker = createTutorialGenerateWorker(genWorkerConn, generateProcessor);
  const spliceWorker = createTutorialSpliceWorker(spliceWorkerConn, spliceProcessor);
  const stitchWorker = createTutorialStitchWorker(stitchWorkerConn, stitchProcessor);

  attachAllEventListeners(generateWorker, "tutorial-generate");
  attachAllEventListeners(spliceWorker, "tutorial-splice");
  attachAllEventListeners(stitchWorker, "tutorial-stitch");

  startTutorialCleanupInterval();

  console.log(
    JSON.stringify({ level: "info", message: "Tutorial worker started", queues: 3 }),
  );

  const shutdown = async () => {
    console.log(JSON.stringify({ level: "info", message: "Shutting down worker" }));
    await Promise.allSettled([
      generateWorker.close(),
      spliceWorker.close(),
      stitchWorker.close(),
      tutorialGenerateQueue.close(),
      tutorialSpliceQueue.close(),
      tutorialStitchQueue.close(),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", message: "Worker failed to start", error: String(err) }));
  process.exit(1);
});
