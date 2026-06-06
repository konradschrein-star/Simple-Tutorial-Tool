import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getDriveConnection } from "@repo/db";
import { driveOAuthConfigured } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * GET /api/production/drive/status
 * The current user's Drive connection state (drives the Settings card).
 */
export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const conn = await getDriveConnection(db, session.userId);
  return NextResponse.json({
    configured: driveOAuthConfigured(),
    connected: Boolean(conn),
    email: conn?.google_email ?? null,
    folderName: conn?.folder_name ?? null,
    autouploadEnabled: conn?.autoupload_enabled ?? false,
  });
}
