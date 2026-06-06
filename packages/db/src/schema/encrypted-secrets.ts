import {
  pgTable,
  uuid,
  text,
  customType,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { secretCapabilityEnum } from "./tutorial-enums.js";

// bytea column helper (Drizzle has no first-class bytea)
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const encryptedSecrets = pgTable(
  "encrypted_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    namespace: text("namespace").notNull().default("tutorial-production"),
    capability: secretCapabilityEnum("capability").notNull(),
    provider: text("provider").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    auth_tag: bytea("auth_tag").notNull(),
    last4: text("last4").notNull(),
    created_by: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    slot: unique("encrypted_secrets_slot_uq").on(
      t.namespace,
      t.capability,
      t.provider,
    ),
  }),
);
