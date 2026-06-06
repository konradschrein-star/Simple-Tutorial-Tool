import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "../_lib/v2-auth";
import { db } from "@/lib/db";
import {
  listTutorialJobsByUser,
  listPromptPresets,
  getTutorialSettings,
  listSecretSlots,
} from "@repo/db";
import { TUTORIAL_PROVIDERS } from "@repo/contracts";
import {
  getTutorialTotals,
  getTutorialLeaderboard,
} from "@/lib/repositories/tutorial-repository";
import { ProductionClient } from "./page-client";

export default async function ProductionPage() {
  const session = await getSession();
  if (!hasPermission(session, "view:production")) notFound();

  const canManage = hasPermission(session, "manage:tutorial-settings");

  const [jobs, presets, settings, slots, totals, leaderboard] =
    await Promise.all([
      listTutorialJobsByUser(db, session.userId, 100),
      listPromptPresets(db),
      getTutorialSettings(db),
      listSecretSlots(db),
      getTutorialTotals(),
      getTutorialLeaderboard(),
    ]);

  // Managers see the masked key list in Settings. Everyone (incl. VAs) gets a
  // last4-free list of which provider slots have a key configured, so the
  // Create dropdowns can flag providers that aren't set up yet.
  const keyMasks = canManage ? slots : [];
  const configuredSlots = slots.map((s) => ({
    capability: s.capability,
    provider: s.provider,
  }));

  const myCompleted =
    leaderboard.find((r) => r.userId === session.userId)?.completed ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "var(--v2-text-1)",
            margin: "0 0 6px 0",
          }}
        >
          Tutorial Studio
        </h1>
        <p style={{ fontSize: 13, color: "var(--v2-text-2)", margin: 0 }}>
          Create, record, and produce tutorial videos
        </p>
      </div>

      <ProductionClient
        initialJobs={jobs}
        presets={presets}
        settings={settings}
        keyMasks={keyMasks}
        configuredSlots={configuredSlots}
        providers={TUTORIAL_PROVIDERS}
        canManage={canManage}
        totals={totals}
        leaderboard={leaderboard}
        myCompleted={myCompleted}
        userId={session.userId}
      />
    </div>
  );
}
