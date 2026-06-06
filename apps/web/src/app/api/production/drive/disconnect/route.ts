import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { deleteDriveConnection } from "@repo/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/production/drive/disconnect
 * Remove this user's stored Drive connection (deletes the encrypted token).
 */
export async function POST() {
  const session = await getSession();
  if (!session || !hasPermission(session, "view:production")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteDriveConnection(db, session.userId);
  return NextResponse.json({ success: true });
}
