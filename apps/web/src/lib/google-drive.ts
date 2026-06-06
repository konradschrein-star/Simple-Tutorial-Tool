import { createHmac } from "node:crypto";

/**
 * Google Drive OAuth + folder helpers for the per-user "Connect your Drive"
 * flow. Uses the non-sensitive `drive.file` scope (app only ever sees/creates
 * the files it makes — never the rest of the user's Drive), so no heavy Google
 * security assessment is required. Authorization-code flow with
 * access_type=offline + prompt=consent to obtain a refresh token.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
// openid+email identify the connected account; drive.file is the upload scope.
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

const STATE_TTL_MS = 10 * 60 * 1000;

export function driveOAuthConfigured(): boolean {
  return Boolean(
    process.env["GOOGLE_OAUTH_CLIENT_ID"] &&
    process.env["GOOGLE_OAUTH_CLIENT_SECRET"],
  );
}

export function driveRedirectUri(): string {
  return (
    process.env["GOOGLE_OAUTH_REDIRECT_URI"] ??
    `${process.env["PUBLIC_URL"] ?? "http://localhost:3000"}/api/production/drive/callback`
  );
}

// ── CSRF state: HMAC(userId.timestamp) signed with JWT_SECRET, 10-min TTL ────
function stateSecret(): string {
  return process.env["JWT_SECRET"] ?? "";
}

export function signDriveState(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyDriveState(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const payload = Buffer.from(parts[0]!, "base64url").toString("utf8");
  const expected = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  if (parts[1] !== expected) return null;
  const [userId, iat] = payload.split(".");
  if (!userId || !iat) return null;
  if (Date.now() - Number(iat) > STATE_TTL_MS) return null;
  return userId;
}

export function buildDriveAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env["GOOGLE_OAUTH_CLIENT_ID"]!,
    redirect_uri: driveRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env["GOOGLE_OAUTH_CLIENT_ID"]!,
      client_secret: process.env["GOOGLE_OAUTH_CLIENT_SECRET"]!,
      redirect_uri: driveRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Drive token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

export async function getGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { email?: string };
  return data.email ?? "";
}

/**
 * Find (or create) the app's folder in the user's Drive by name. With the
 * drive.file scope files.list only returns files this app created, so this
 * safely reuses our own folder and never sees the user's other files.
 */
export async function ensureDriveFolder(
  accessToken: string,
  name: string,
): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listRes = await fetch(
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
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
  if (!createRes.ok) {
    throw new Error(`Drive folder create failed (${createRes.status})`);
  }
  const data = (await createRes.json()) as { id: string };
  return data.id;
}
