import type { Config } from "drizzle-kit";

export default {
  dialect: "postgresql",
  schema: "./dist/schema/index.js",
  out: "./src/migrations",
  dbCredentials: { url: process.env.DATABASE_URL || "" },
} satisfies Config;
