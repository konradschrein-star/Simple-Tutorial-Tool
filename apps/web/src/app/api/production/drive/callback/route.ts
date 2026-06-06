import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { upsertDriveConnection } from "@repo/db";
import { encryptSecret } from "@/lib/crypto/secret-box";
import {
  driveOAuthConfigured,
  exchangeCodeForTokens,
  getGoogleEmail,
  ensureDriveFolder,
  verifyDriveState,
} from "@/lib/google-drive";

export const dynamic = "force-dynamic";

const FOLDER_NAME = "Tutorial Videos";

function hubBase(): string {
  return (
    process.env["PUBLIC_URL"] ?? "http://localhost:3000"
  );
}

/** Land back on the Settings tab with a result code the UI can toast. */
function back(result: string): NextResponse {
  return NextResponse.redirect(
    `${hubBase()}/production?tab=settings&drive=${result}`,
  );
}

/**
 * GET /api/production/drive/callback?code&state
 * Google redirects here after consent. Verify the CSRF state, exchange the
 * code for tokens, store the refresh token ENCRYPTED, and auto-create the
 * user's "Tutorial Videos" folder.
 */
export async function GET(req: NextRequest) {
  if (!driveOAuthConfigured()) return back("unconfigured");

  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${hubBase()}/login`);
  }

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("error");

  const stateUserId = verifyDriveState(state);
  if (!stateUserId || stateUserId !== session.userId) return back("error");

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // No refresh token means a prior grant without offline access — the user
      // should revoke access and reconnect. prompt=consent normally avoids this.
      return back("norefresh");
    }
    const [email, folderId] = await Promise.all([
      getGoogleEmail(tokens.access_token),
      ensureDriveFolder(tokens.access_token, FOLDER_NAME),
    ]);
    const box = encryptSecret(tokens.refresh_token);
    await upsertDriveConnection(db, {
      user_id: session.userId,
      google_email: email,
      refresh_ciphertext: box.ciphertext,
      refresh_iv: box.iv,
      refresh_auth_tag: box.authTag,
      folder_id: folderId,
      folder_name: FOLDER_NAME,
      autoupload_enabled: true,
    });
    return back("connected");
  } catch (err) {
    console.error("Drive OAuth callback failed", err);
    return back("error");
  }
}
