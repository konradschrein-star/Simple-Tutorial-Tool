"use client";

import { GlassCard } from "../../_components";
import type { TutorialJob } from "@repo/db";

interface LeaderboardEntry {
  userId: string | null;
  name: string | null;
  completed: number;
}

interface DashboardProps {
  jobs: TutorialJob[];
  totals: { total: number; week: number };
  leaderboard: LeaderboardEntry[];
  myCompleted: number;
  userId: string;
}

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "#6366f1",
  GENERATING_SCRIPT: "#f59e0b",
  GENERATING_AUDIO: "#f59e0b",
  READY_TO_RECORD: "#22c55e",
  AWAITING_UPLOAD: "#3b82f6",
  SPLICING: "#f59e0b",
  COMPLETED: "#22c55e",
  FAILED_SCRIPT: "#ef4444",
  FAILED_AUDIO: "#ef4444",
  FAILED_SPLICE: "#ef4444",
  CANCELLED: "#6b7280",
};

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <GlassCard
      style={{
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        border: accent
          ? "1px solid rgba(var(--v2-accent-rgb), 0.3)"
          : undefined,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--v2-text-2)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 40,
          fontWeight: 900,
          color: accent ? "var(--v2-accent)" : "var(--v2-text-1)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>{sub}</div>
      )}
    </GlassCard>
  );
}

export function ProductionDashboard({
  jobs,
  totals,
  leaderboard,
  myCompleted,
  userId,
}: DashboardProps) {
  const maxCompleted = Math.max(...leaderboard.map((r) => r.completed), 1);

  const activeJobs = jobs.filter(
    (j) =>
      j.status !== "COMPLETED" &&
      j.status !== "CANCELLED" &&
      !j.status.startsWith("FAILED"),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        <Tile
          label="Total Completed"
          value={totals.total}
          sub="All-time finished tutorials"
        />
        <Tile
          label="This Week"
          value={totals.week}
          sub="Completed in last 7 days"
        />
        <Tile
          label="Your Videos"
          value={myCompleted}
          sub="Completed by you"
          accent
        />
        <Tile
          label="Active Jobs"
          value={activeJobs.length}
          sub="In progress right now"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Leaderboard */}
        <GlassCard style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 16,
            }}
          >
            Leaderboard — Completed Tutorials
          </div>

          {leaderboard.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
              No completed tutorials yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {leaderboard.slice(0, 10).map((entry, i) => {
                const isMe = entry.userId === userId;
                const pct =
                  maxCompleted > 0 ? (entry.completed / maxCompleted) * 100 : 0;
                return (
                  <div key={entry.userId ?? i}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: isMe ? "var(--v2-accent)" : "var(--v2-text-1)",
                          fontWeight: isMe ? 700 : 400,
                        }}
                      >
                        {i + 1}. {entry.name ?? "Unknown"}
                        {isMe && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 9,
                              color: "var(--v2-accent)",
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            You
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--v2-text-1)",
                        }}
                      >
                        {entry.completed}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: "rgba(255,255,255,0.07)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: isMe
                            ? "var(--v2-accent)"
                            : "rgba(255,255,255,0.3)",
                          borderRadius: 2,
                          transition: "width 600ms ease",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Recent jobs */}
        <GlassCard style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 16,
            }}
          >
            Your Recent Jobs
          </div>

          {jobs.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
              No jobs yet. Go to Create to get started.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {jobs.slice(0, 8).map((j) => (
                <div
                  key={j.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 8,
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--v2-text-1)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.title}
                  </span>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 9999,
                      fontSize: 9,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      background: `${STATUS_COLORS[j.status] ?? "#6b7280"}22`,
                      color: STATUS_COLORS[j.status] ?? "#6b7280",
                      border: `1px solid ${STATUS_COLORS[j.status] ?? "#6b7280"}44`,
                      flexShrink: 0,
                    }}
                  >
                    {j.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
