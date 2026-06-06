import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

/**
 * Drizzle Client Factory
 *
 * Creates a typed Drizzle ORM client connected to PostgreSQL.
 *
 * Design decisions:
 * - No singleton pattern - apps manage connection lifecycle
 * - Full schema provided for type inference
 * - Uses postgres.js driver for performance
 *
 * Usage:
 * ```typescript
 * const db = createDrizzleClient(process.env.DATABASE_URL);
 * const jobs = await db.select().from(schema.contentJobs);
 * ```
 */

export type DrizzleClient = ReturnType<typeof createDrizzleClient>;

export function createDrizzleClient(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}
