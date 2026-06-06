"use client";

import { useState } from "react";
import { toast } from "sonner";
import { V2Button, GlassCard } from "../../_components";
import type { TutorialJob } from "@repo/db";

interface LibraryProps {
  jobs: TutorialJob[];
  onChange: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  AWAITING_UPLOAD: "#3b82f6",
  SPLICING: "#f59e0b",
  COMPLETED: "#22c55e",
  FAILED_SPLICE: "#ef4444",
};

// Recording uploaded, being turned into the final video.
const PROCESSING = new Set(["AWAITING_UPLOAD", "SPLICING"]);
// A splice is one FFmpeg pass with no granular progress; we estimate the bar
// from elapsed time so it visibly moves, capped just shy of 100 until done.
const SPLICE_ETA_SECONDS = 90;

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? "#6b7280";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        background: `${c}22`,
        color: c,
        border: `1px solid ${c}44`,
        whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function secondsSince(from: string | Date | null | undefined): number {
  if (!from) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(from).getTime()) / 1000),
  );
}

function elapsedLabel(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function byNewest(a: TutorialJob, b: TutorialJob): number {
  const at = new Date(a.completed_at ?? a.created_at).getTime();
  const bt = new Date(b.completed_at ?? b.created_at).getTime();
  return bt - at;
}

function formatCompleted(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProductionLibrary({ jobs, onChange }: LibraryProps) {
  const processing = jobs
    .filter((j) => PROCESSING.has(j.status as string))
    .sort(byNewest);
  const finished = jobs.filter((j) => j.status === "COMPLETED").sort(byNewest);
  const failed = jobs
    .filter((j) => j.status === "FAILED_SPLICE")
    .sort(byNewest);

  // Finished videos are collapsed by default (scales to hundreds of rows); the
  // <video> player only mounts for rows the VA expands, so we don't load 200
  // players at once.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function markUploaded(id: string) {
    try {
      const res = await fetch(`/api/production/jobs/${id}/mark-uploaded`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Marked as uploaded to Drive.");
      onChange();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function cancelJob(id: string) {
    try {
      const res = await fetch(`/api/production/jobs/${id}`, { method: "POST" });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      toast.success("Job cancelled.");
      onChange();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function deleteJob(id: string) {
    if (!window.confirm("Delete this job and its files? This can't be undone."))
      return;
    try {
      const res = await fetch(`/api/production/jobs/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      toast.success("Job deleted.");
      onChange();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function copyError(j: TutorialJob) {
    const text = `Tutorial job failed\nTitle: ${j.title}\nJob ID: ${j.id}\nStage: ${j.error_stage ?? ""}\nStatus: ${j.status}\nError: ${j.error_message ?? ""}${j.error_detail ? "\nDetail: " + j.error_detail : ""}`;
    navigator.clipboard
      .writeText(text)
      .then(() =>
        toast.success("Full error copied — paste it to your manager."),
      )
      .catch(() => toast.error("Couldn't copy to clipboard."));
  }

  const smallBtn = {
    background: "none",
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    padding: "3px 8px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };

  const sectionTitle = (text: string, count?: number) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--v2-text-2)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        marginBottom: 12,
      }}
    >
      {text}
      {count !== undefined && count > 0 ? ` (${count})` : ""}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Processing ─────────────────────────────────────────────── */}
      <GlassCard style={{ padding: 20 }}>
        {sectionTitle("Processing", processing.length)}
        {processing.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
            Nothing processing right now. After you upload a recording in the
            Studio, it appears here while we splice the final video.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {processing.map((j) => {
              const elapsed = secondsSince(j.recorded_at ?? j.created_at);
              const pct = Math.min(
                95,
                Math.round((elapsed / SPLICE_ETA_SECONDS) * 100),
              );
              return (
                <div
                  key={j.id}
                  style={{
                    padding: "12px 14px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span
                      title={j.title}
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--v2-text-1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {j.title}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                      {elapsedLabel(elapsed)}
                    </span>
                    <StatusBadge status={j.status as string} />
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 9999,
                      background: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.max(pct, 6)}%`,
                        background: "#f59e0b",
                        borderRadius: 9999,
                        transition: "width 1s linear",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                    {j.status === "AWAITING_UPLOAD"
                      ? "Recording received — queued for processing…"
                      : "Splicing your recording with the audio — this usually takes a couple of minutes."}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      onClick={() => cancelJob(j.id)}
                      style={{
                        ...smallBtn,
                        border: "1px solid rgba(245,158,11,0.4)",
                        color: "#f59e0b",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteJob(j.id)}
                      style={{
                        ...smallBtn,
                        border: "1px solid rgba(239,68,68,0.4)",
                        color: "#ef4444",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* ── Failed ─────────────────────────────────────────────────── */}
      {failed.length > 0 && (
        <GlassCard
          style={{ padding: 20, border: "1px solid rgba(239,68,68,0.3)" }}
        >
          {sectionTitle("Failed", failed.length)}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {failed.map((j) => (
              <div
                key={j.id}
                style={{
                  padding: "10px 12px",
                  background: "rgba(239,68,68,0.06)",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--v2-text-1)",
                    marginBottom: 4,
                  }}
                >
                  {j.title}
                </div>
                <div
                  style={{ fontSize: 11, color: "#ef4444", lineHeight: 1.4 }}
                >
                  {j.error_message ?? "Splice failed."} — re-upload the
                  recording in the Studio to try again.
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "flex-end",
                    marginTop: 8,
                  }}
                >
                  <button
                    onClick={() => copyError(j)}
                    style={{
                      ...smallBtn,
                      border: "1px solid rgba(255,255,255,0.2)",
                      color: "var(--v2-text-2)",
                    }}
                  >
                    Copy error
                  </button>
                  <button
                    onClick={() => deleteJob(j.id)}
                    style={{
                      ...smallBtn,
                      border: "1px solid rgba(239,68,68,0.4)",
                      color: "#ef4444",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* ── Finished videos ────────────────────────────────────────── */}
      <GlassCard style={{ padding: 20 }}>
        {sectionTitle("Finished videos", finished.length)}
        {finished.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
            No finished videos yet. They show up here, ready to download, once
            processing completes.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {finished.map((j) => {
              const isOpen = expanded.has(j.id);
              return (
                <div
                  key={j.id}
                  style={{
                    background: "rgba(34,197,94,0.06)",
                    border: "1px solid rgba(34,197,94,0.18)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {/* Compact header — click anywhere to expand the player. */}
                  <div
                    onClick={() => toggleExpand(j.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: 18,
                        color: "var(--v2-text-2)",
                        transform: isOpen ? "rotate(90deg)" : "none",
                        transition: "transform 0.15s",
                        flexShrink: 0,
                      }}
                    >
                      chevron_right
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--v2-text-1)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {j.title}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--v2-text-2)",
                          marginTop: 1,
                        }}
                      >
                        {formatCompleted(j.completed_at ?? j.created_at)}
                        {j.delivered_to_drive ? " · ✓ on Drive" : ""}
                      </div>
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: "flex", gap: 8, flexShrink: 0 }}
                    >
                      <a
                        href={`/api/production/jobs/${j.id}/download`}
                        download
                        style={{ textDecoration: "none" }}
                      >
                        <V2Button variant="accent" size="sm">
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 15 }}
                          >
                            download
                          </span>
                          Download
                        </V2Button>
                      </a>
                      <V2Button
                        variant="outline"
                        size="sm"
                        onClick={() => markUploaded(j.id)}
                        disabled={j.delivered_to_drive ?? false}
                      >
                        {j.delivered_to_drive ? "On Drive" : "Mark on Drive"}
                      </V2Button>
                    </div>
                  </div>

                  {/* Player mounts only while expanded — keeps the list light. */}
                  {isOpen && (
                    <div style={{ padding: "0 12px 12px 12px" }}>
                      <video
                        controls
                        preload="metadata"
                        src={`/api/production/jobs/${j.id}/preview`}
                        style={{
                          width: "100%",
                          maxHeight: 360,
                          borderRadius: 6,
                          background: "#000",
                          display: "block",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* ── Google Drive (coming soon) ─────────────────────────────── */}
      <GlassCard style={{ padding: 20, opacity: 0.75 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Google Drive
          </div>
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 9999,
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              background: "rgba(99,102,241,0.15)",
              color: "#818cf8",
              border: "1px solid rgba(99,102,241,0.3)",
            }}
          >
            Coming Soon
          </span>
        </div>
        <div
          style={{ fontSize: 12, color: "var(--v2-text-2)", lineHeight: 1.5 }}
        >
          For now, download a finished video above and upload it to Drive
          yourself, then hit “Mark on Drive” to keep track. Automatic upload to
          a Drive folder is coming soon.
        </div>
      </GlassCard>
    </div>
  );
}
