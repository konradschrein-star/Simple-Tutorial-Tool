import { createDrizzleClient, type DrizzleClient } from "@repo/db";
import { initializeDb } from "@repo/db/singleton";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in.");
}

export const db: DrizzleClient = createDrizzleClient(databaseUrl);
initializeDb(databaseUrl);

export type Database = DrizzleClient;
export * from "@repo/db";
