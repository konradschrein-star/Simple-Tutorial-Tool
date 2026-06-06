import { stat, readFile } from "node:fs/promises";
import type { DrizzleClient, TutorialJob } from "@repo/db";
import {
  getDriveConnection,
  setDriveFolder,
  updateTutorialJob,
} from "@repo/db";
import { decryptSecret } from "./secret-box.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink";

function oauthConfigured(): boolean {
  return Boolean(
    process.env["GOOGLE_OAUTH_CLIENT_ID"] &&
    process.env["GOOGLE_OAUTH_CLIENT_SECRET"],
  );
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env["GOOGLE_OAUTH_CLIENT_ID"]!,
      client_secret: process.env["GOOGLE_OAUTH_CLIENT_SECRET"]!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Drive token refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function ensureFolder(
  accessToken: string,
  name: string,
): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listRes = await fetch(
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (listRes.ok) {
    const data = (await listRes.json()) as { files?: Array<{ id: string }> };
    if (data.files && data.files.length > 0) return data.files[0]!.id;
  }
  const createRes = await fetch(`${DRIVE_FILES_URL}?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!createRes.ok)
    throw new Error(`Drive folder create failed (${createRes.status})`);
  return ((await createRes.json()) as { id: string }).id;
}

function driveFileName(job: TutorialJob): string {
  const d = new Date(job.completed_at ?? job.created_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const title = job.title
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${ts}_${title}.mp4`;
}

async function uploadResumable(
  accessToken: string,
  folderId: string | null,
  filePath: string,
  fileName: string,
): Promise<void> {
  const size = (await stat(filePath)).size;
  const initRes = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      name: fileName,
      parents: folderId ? [folderId] : undefined,
    }),
  });
  if (!initRes.ok) {
    throw new Error(`Drive resumable init failed (${initRes.status})`);
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) throw new Error("Drive resumable: no session URL");

  const fileBuffer = await readFile(filePath);
  const putRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: fileBuffer,
  });
  if (putRes.status !== 200 && putRes.status !== 201) {
    throw new Error(`Drive upload failed (${putRes.status})`);
  }
}

/**
 * Best-effort: if the job's owner has a connected + enabled Google Drive, push
 * the finished video into their "Tutorial Videos" folder. Never throws back to
 * the splice — a Drive failure must not fail an otherwise-complete video; the
 * caller logs it. No-op when OAuth isn't configured or the user isn't connected.
 */
export async function maybeUploadToDrive(
  db: DrizzleClient,
  job: TutorialJob,
  filePath: string,
): Promise<boolean> {
  if (!oauthConfigured() || !job.created_by) return false;
  const conn = await getDriveConnection(db, job.created_by);
  if (!conn || !conn.autoupload_enabled) return false;

  const refreshToken = decryptSecret({
    ciphertext: Buffer.from(conn.refresh_ciphertext),
    iv: Buffer.from(conn.refresh_iv),
    authTag: Buffer.from(conn.refresh_auth_tag),
  });
  const accessToken = await refreshAccessToken(refreshToken);

  let folderId = conn.folder_id;
  if (!folderId) {
    folderId = await ensureFolder(accessToken, conn.folder_name);
    await setDriveFolder(db, job.created_by, folderId, conn.folder_name);
  }

  await uploadResumable(accessToken, folderId, filePath, driveFileName(job));
  await updateTutorialJob(db, job.id, { delivered_to_drive: true });
  return true;
}
