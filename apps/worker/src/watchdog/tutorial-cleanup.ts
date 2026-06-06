import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const LOCAL_MEDIA_ROOT =
  process.env["LOCAL_MEDIA_ROOT"] ?? "./media";

const TUTORIAL_MEDIA_BASE = join(LOCAL_MEDIA_ROOT, "tutorial");

const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 h

const INTERMEDIATE_PATTERNS = [
  /^tts-chunk-\d+\.mp3$/,
  /^tts-concat\.txt$/,
  /^tts\.mp3$/,
];

/**
 * Reclaim tutorial intermediate files older than 48 h.
 *
 * Targets: ${LOCAL_MEDIA_ROOT}/tutorial/* — per-job subdirectories.
 * Removes TTS chunk files and concat lists left behind by interrupted runs.
 * Final outputs (final.mp4) are intentionally excluded.
 */
export async function runTutorialCleanup(): Promise<void> {
  let removed = 0;
  let bytesFreed = 0;
  try {
    const jobs = await readdir(TUTORIAL_MEDIA_BASE).catch(() => []);
    const now = Date.now();
    for (const jobDir of jobs) {
      const jobPath = join(TUTORIAL_MEDIA_BASE, jobDir);
      await walkAndClean(jobPath, now, (size) => {
        removed += 1;
        bytesFreed += size;
      });
    }
    if (removed > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "[tutorial-cleanup] Reclaimed intermediate files",
          files: removed,
          bytes_freed: bytesFreed,
          gb_freed: (bytesFreed / 1e9).toFixed(2),
        }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "[tutorial-cleanup] Scan failed",
        error: String(err).slice(0, 200),
      }),
    );
  }
}

async function walkAndClean(
  dir: string,
  now: number,
  onRemoved: (size: number) => void,
): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      await walkAndClean(full, now, onRemoved);
      continue;
    }
    if (!INTERMEDIATE_PATTERNS.some((re) => re.test(entry))) continue;
    if (now - s.mtimeMs < MAX_AGE_MS) continue;
    try {
      await unlink(full);
      onRemoved(s.size);
    } catch {
      // race: someone else got to it, fine
    }
  }
}

/**
 * Start periodic tutorial cleanup interval.
 * Runs once at startup + every hour thereafter.
 */
export function startTutorialCleanupInterval(
  intervalMs = 60 * 60 * 1000,
): NodeJS.Timeout {
  runTutorialCleanup().catch(() => {});
  return setInterval(() => {
    runTutorialCleanup().catch(() => {});
  }, intervalMs);
}
