import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  driveOAuthConfigured,
  buildDriveAuthUrl,
  signDriveState,
} from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/drive/connect
 * Start the per-user Google Drive OAuth flow: sign a CSRF state tied to this
 * user and redirect to Google's consent screen. Any user who can see the
 * Tutorial tool (incl. VAs) can connect their own Drive.
 */
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!driveOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google Drive isn't configured on this server yet." },
      { status: 503 },
    );
  }
  const state = signDriveState(session.userId);
  return NextResponse.redirect(buildDriveAuthUrl(state));
}
