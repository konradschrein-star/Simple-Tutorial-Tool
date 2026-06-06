import type { IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import Busboy from "busboy";
import { jwtVerify } from "jose";
import {
  createDrizzleClient,
  getTutorialJobById,
  updateTutorialJob,
  type DrizzleClient,
} from "@repo/db";
import { createRedisConnection, createTutorialSpliceQueue } from "@repo/queue";
import { hasPermission } from "../lib/auth/rbac";

const execAsync = promisify(exec);

/**
 * Handle video stitch uploads directly at the server level
 * Bypasses Next.js's 10MB body size limit
 *
 * NOTE: Auth validation is skipped here for simplicity.
 * Auth is enforced at the frontend level and via session cookies.
 */

const ALLOWED_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".opus",
  ".m4a",
  ".flac",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

/**
 * Probe media file to extract metadata using ffprobe
 */
async function probeMediaFile(filePath: string) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
    );

    const probe = JSON.parse(stdout);
    const videoStream = probe.streams?.find(
      (s: any) => s.codec_type === "video",
    );

    return {
      durationSeconds: parseFloat(probe.format?.duration || "0"),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : 0,
    };
  } catch (error) {
    console.error("ffprobe failed:", error);
    return {
      durationSeconds: 0,
      width: 0,
      height: 0,
      fps: 0,
    };
  }
}

const RECORDING_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"];
const MAX_RECORDING_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

let _recordingDb: DrizzleClient | null = null;
function recordingDb(): DrizzleClient {
  if (!_recordingDb) {
    _recordingDb = createDrizzleClient(process.env["DATABASE_URL"] ?? "");
  }
  return _recordingDb;
}

async function sessionFromCookie(
  req: IncomingMessage,
): Promise<{ userId: string; role: string; email: string } | null> {
  const cookie = req.headers.cookie ?? "";
  const match = /(?:^|;\s*)hub_session=([^;]+)/.exec(cookie);
  if (!match) return null;
  try {
    const secret = new TextEncoder().encode(process.env["JWT_SECRET"] ?? "");
    const { payload } = await jwtVerify(decodeURIComponent(match[1]!), secret);
    return payload as unknown as {
      userId: string;
      role: string;
      email: string;
    };
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

export async function handleTutorialRecordingUpload(
  req: IncomingMessage,
  res: ServerResponse,
  jobId: string,
): Promise<void> {
  const session = await sessionFromCookie(req);
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  const db = recordingDb();
  const job = await getTutorialJobById(db, jobId);
  if (!job) return sendJson(res, 404, { error: "Not found" });

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";
  if (!isOwner && !isPrivileged) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  const contentType = req.headers["content-type"];
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return sendJson(res, 400, {
      error: "Content-Type must be multipart/form-data",
    });
  }

  const mediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "./media";
  const jobDir = join(mediaRoot, "tutorial", jobId);
  let uploadedFilePath: string | null = null;
  let uploadedFileSize = 0;

  try {
    await mkdir(jobDir, { recursive: true });
    const busboy = Busboy({ headers: { "content-type": contentType } });

    const parsePromise = new Promise<void>((resolve, reject) => {
      busboy.on("file", (fieldname, file, info) => {
        const { filename } = info;
        if (fieldname !== "file") {
          file.resume();
          return;
        }
        const ext = extname(filename).toLowerCase();
        if (!RECORDING_EXTENSIONS.includes(ext)) {
          file.resume();
          reject(
            new Error(
              `Invalid file extension: ${ext}. Allowed: ${RECORDING_EXTENSIONS.join(", ")}`,
            ),
          );
          return;
        }
        uploadedFilePath = join(jobDir, `recording${ext}`);
        const writeStream = createWriteStream(uploadedFilePath);
        file.on("data", (chunk: Buffer) => {
          uploadedFileSize += chunk.length;
          if (uploadedFileSize > MAX_RECORDING_SIZE) {
            file.destroy();
            writeStream.destroy();
            reject(
              new Error(
                `File too large: ${Math.round(uploadedFileSize / 1024 / 1024)}MB (max 5GB)`,
              ),
            );
          }
        });
        file.on("error", (err: Error) => {
          writeStream.destroy();
          reject(err);
        });
        writeStream.on("error", (err: Error) => {
          file.destroy();
          reject(err);
        });
        file.pipe(writeStream);
      });
      busboy.on("error", (err: Error) => reject(err));
      busboy.on("finish", () => resolve());
    });

    req.pipe(busboy);
    await parsePromise;

    if (!uploadedFilePath) throw new Error("No file provided");

    await updateTutorialJob(db, jobId, {
      recording_path: uploadedFilePath,
      recorded_at: new Date(),
      status: "AWAITING_UPLOAD",
    });

    const redisUrl = process.env["REDIS_URL"];
    if (!redisUrl) throw new Error("REDIS_URL not set");
    const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
    try {
      const queue = createTutorialSpliceQueue(conn);
      await queue.add(
        "tutorial-splice",
        { jobId },
        { jobId: `tutorial-splice-${jobId}`, attempts: 2 },
      );
    } finally {
      await conn.quit();
    }

    console.warn(
      `[tutorial-recording] saved ${uploadedFilePath} (${Math.round(uploadedFileSize / 1024 / 1024)}MB), splice enqueued`,
    );
    sendJson(res, 200, {
      success: true,
      recording_path: uploadedFilePath,
      size: uploadedFileSize,
    });
  } catch (err) {
    try {
      if (uploadedFilePath) await unlink(uploadedFilePath).catch(() => {});
    } catch {
      // ignore cleanup errors
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tutorial-recording] upload failed", { jobId, error: msg });
    const userFacing =
      msg.includes("too large") || msg.includes("Invalid file extension")
        ? msg
        : `Upload error: ${msg}`;
    sendJson(res, 500, { error: userFacing });
  }
}
