"use client";

import { useEffect, useRef, useState } from "react";
import { V2Button } from "../_components";
import { ProductionDashboard } from "./_components/dashboard";
import { ProductionCreate } from "./_components/create";
import { ProductionStudio } from "./_components/studio";
import { ProductionLibrary } from "./_components/library";
import { ProductionSettings } from "./_components/settings";
import type { TutorialJob } from "@repo/db";
import type { TutorialPromptPreset } from "@repo/db";
import type { TutorialSettingsRow } from "@repo/db";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "create", label: "Create" },
  { id: "studio", label: "Studio" },
  { id: "videos", label: "Videos" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TERMINAL = new Set([
  "COMPLETED",
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
  "CANCELLED",
]);

interface LeaderboardEntry {
  userId: string | null;
  name: string | null;
  completed: number;
}

interface ProductionClientProps {
  initialJobs: TutorialJob[];
  presets: TutorialPromptPreset[];
  settings: TutorialSettingsRow;
  keyMasks: Array<{ capability: string; provider: string; last4: string }>;
  configuredSlots: Array<{ capability: string; provider: string }>;
  providers: { llm: any[]; tts: any[] };
  canManage: boolean;
  totals: { total: number; week: number };
  leaderboard: LeaderboardEntry[];
  myCompleted: number;
  userId: string;
}

export function ProductionClient({
  initialJobs,
  presets,
  settings,
  keyMasks,
  configuredSlots,
  providers,
  canManage,
  totals,
  leaderboard,
  myCompleted,
  userId,
}: ProductionClientProps) {
  const [tab, setTab] = useState<TabId>("create");
  const [jobs, setJobs] = useState<TutorialJob[]>(initialJobs);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Honor ?tab=<id> on load (e.g. the Drive OAuth callback returns to Settings).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.id === t)) setTab(t as TabId);
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/production/jobs");
      if (res.ok) {
        const data = (await res.json()) as { jobs: TutorialJob[] };
        setJobs(data.jobs);
      }
    } catch {
      // ignore network errors
    }
  }

  useEffect(() => {
    const hasActive = jobs.some((j) => !TERMINAL.has(j.status));
    if (hasActive && !timer.current) {
      timer.current = setInterval(refresh, 2500);
    } else if (!hasActive && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [jobs]);

  const readyCount = jobs.filter((j) => j.status === "READY_TO_RECORD").length;
  const processingCount = jobs.filter(
    (j) => j.status === "AWAITING_UPLOAD" || j.status === "SPLICING",
  ).length;
  const badgeFor = (id: TabId) =>
    id === "studio" ? readyCount : id === "videos" ? processingCount : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <V2Button
            key={t.id}
            variant={tab === t.id ? "accent" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {badgeFor(t.id) > 0 && (
              <span
                style={{
                  background: "var(--v2-accent)",
                  color: "#fff",
                  borderRadius: 9999,
                  fontSize: 9,
                  padding: "1px 5px",
                  fontWeight: 700,
                  marginLeft: 4,
                }}
              >
                {badgeFor(t.id)}
              </span>
            )}
          </V2Button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "dashboard" && (
        <ProductionDashboard
          jobs={jobs}
          totals={totals}
          leaderboard={leaderboard}
          myCompleted={myCompleted}
          userId={userId}
        />
      )}
      {tab === "create" && (
        <ProductionCreate
          presets={presets}
          providers={providers}
          configuredSlots={configuredSlots}
          settings={settings}
          jobs={jobs}
          userId={userId}
          onCreated={() => {
            void refresh();
          }}
          onGoToStudio={() => setTab("studio")}
        />
      )}
      {tab === "studio" && (
        <ProductionStudio
          jobs={jobs}
          settings={settings}
          onChange={refresh}
          onRecordingUploaded={() => {
            void refresh();
            setTab("videos");
          }}
        />
      )}
      {tab === "videos" && <ProductionLibrary jobs={jobs} onChange={refresh} />}
      {tab === "settings" && (
        <ProductionSettings
          presets={presets}
          keyMasks={keyMasks}
          providers={providers}
          settings={settings}
          canManage={canManage}
        />
      )}
    </div>
  );
}
