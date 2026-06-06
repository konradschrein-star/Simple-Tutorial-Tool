import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { Readable } from "stream";
import Busboy from "busboy";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTutorialJobById, updateTutorialJob } from "@repo/db";
import { createRedisConnection, createTutorialSpliceQueue } from "@repo/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

/**
 * POST /api/production/jobs/[id]/recording
 *
 * Upload a screen recording for a tutorial job using Busboy streaming.
 * Writes to ${LOCAL_MEDIA_ROOT}/tutorial/<jobId>/recording<ext>, then
 * updates the job to AWAITING_UPLOAD and enqueues the splice job.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, "create:tutorial-job")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await getTutorialJobById(db, id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = job.created_by === session.userId;
  const isPrivileged =
    hasPermission(session, "manage:tutorial-settings") ||
    session.role === "ADMIN" ||
    session.role === "MANAGER";

  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Content-Type must be multipart/form-data" },
      { status: 400 },
    );
  }

  const mediaRoot =
    process.env["LOCAL_MEDIA_ROOT"] ?? "./media";
  const jobDir = join(mediaRoot, "tutorial", id);

  let uploadedFilePath: string | null = null;
  let uploadedFileSize = 0;

  try {
    await mkdir(jobDir, { recursive: true });

    const nodeStream = Readable.fromWeb(
      request.body as Parameters<typeof Readable.fromWeb>[0],
    );
    const busboy = Busboy({ headers: { "content-type": contentType } });

    const parsePromise = new Promise<void>((resolve, reject) => {
      busboy.on("file", (fieldname, file, info) => {
        const { filename } = info;

        if (fieldname !== "file") {
          file.resume();
          return;
        }

        const ext = extname(filename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          file.resume();
          reject(
            new Error(
              `Invalid file extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
            ),
          );
          return;
        }

        uploadedFilePath = join(jobDir, `recording${ext}`);
        const writeStream = createWriteStream(uploadedFilePath);

        file.on("data", (chunk: Buffer) => {
          uploadedFileSize += chunk.length;
          if (uploadedFileSize > MAX_FILE_SIZE) {
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

        writeStream.on("finish", () => {
          console.warn(`[recording-upload] File saved: ${uploadedFilePath}`);
        });

        file.pipe(writeStream);
      });

      busboy.on("error", (err: Error) => {
        reject(err);
      });

      busboy.on("finish", () => {
        resolve();
      });
    });

    nodeStream.pipe(busboy);
    await parsePromise;

    if (!uploadedFilePath) {
      throw new Error("No file provided");
    }

    // Update job: set recording_path, recorded_at, status AWAITING_UPLOAD
    await updateTutorialJob(db, id, {
      recording_path: uploadedFilePath,
      recorded_at: new Date(),
      status: "AWAITING_UPLOAD",
    });

    // Enqueue the splice job
    const redisUrl = process.env["REDIS_URL"];
    if (!redisUrl) {
      throw new Error("REDIS_URL not set");
    }
    const conn = createRedisConnection({ url: redisUrl, mode: "queue" });
    try {
      const queue = createTutorialSpliceQueue(conn);
      await queue.add(
        "tutorial-splice",
        { jobId: id },
        { jobId: `tutorial-splice-${id}`, attempts: 2 },
      );
    } finally {
      await conn.quit();
    }

    // Read filesystem stat for uploaded size info
    const fileStats = await stat(uploadedFilePath);

    return NextResponse.json({
      success: true,
      recording_path: uploadedFilePath,
      size: fileStats.size,
    });
  } catch (err) {
    // Cleanup on failure
    try {
      if (uploadedFilePath) {
        await unlink(uploadedFilePath).catch(() => {});
      }
    } catch (cleanupErr) {
      console.error("Failed to cleanup recording file", cleanupErr);
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Recording upload failed", {
      error: errorMessage,
      jobId: id,
      userId: session.userId,
    });

    let userFacingError = "Failed to process upload";
    if (errorMessage.includes("too large")) {
      userFacingError = errorMessage;
    } else if (errorMessage.includes("Invalid file extension")) {
      userFacingError = errorMessage;
    } else if (errorMessage.includes("No file provided")) {
      userFacingError =
        "No file was uploaded. Please select a file and try again.";
    } else if (errorMessage.includes("ENOSPC")) {
      userFacingError = "Server storage is full. Please contact administrator.";
    } else {
      userFacingError = `Upload error: ${errorMessage}`;
    }

    return NextResponse.json({ error: userFacingError }, { status: 500 });
  }
}
