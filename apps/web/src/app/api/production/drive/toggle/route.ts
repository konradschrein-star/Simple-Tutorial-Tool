import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { setDriveAutoupload } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/production/drive/toggle  { enabled: boolean }
 * Turn this user's automatic upload on/off (keeps the connection).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  await setDriveAutoupload(db, session.userId, Boolean(body.enabled));
  return NextResponse.json({ success: true });
}
