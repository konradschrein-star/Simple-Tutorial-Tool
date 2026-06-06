import "dotenv/config";
import bcrypt from "bcryptjs";
import { createDrizzleClient, users, eq } from "@repo/db";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_NAME || "Admin";

if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env, then re-run.");
}

// Match the login form's whitespace handling so the credentials line up.
const email = ADMIN_EMAIL.replace(/\s+/g, "");
const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

const db = createDrizzleClient(DATABASE_URL);
const existing = await db.select().from(users).where(eq(users.email, email));

if (existing.length > 0) {
  await db
    .update(users)
    .set({ passwordHash, name: ADMIN_NAME, role: "ADMIN", is_active: true })
    .where(eq(users.email, email));
  console.log(`Updated existing admin: ${email}`);
} else {
  await db.insert(users).values({ email, name: ADMIN_NAME, role: "ADMIN", passwordHash });
  console.log(`Created admin: ${email}`);
}
process.exit(0);
