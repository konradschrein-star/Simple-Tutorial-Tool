"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { V2Button, GlassCard } from "../../_components";
import { uploadFileWithProgress } from "@/lib/upload-with-progress";
import type { TutorialJob, TutorialSettingsRow } from "@repo/db";

interface StudioProps {
  jobs: TutorialJob[];
  settings: TutorialSettingsRow;
  onChange: () => void;
  /** Called after a recording finishes uploading (to jump to the Videos tab). */
  onRecordingUploaded?: () => void;
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

function StatusBadge({ status }: { status: string }) {
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
        background: `${STATUS_COLORS[status] ?? "#6b7280"}22`,
        color: STATUS_COLORS[status] ?? "#6b7280",
        border: `1px solid ${STATUS_COLORS[status] ?? "#6b7280"}44`,
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** Whether a job is a SIX_MIN_STITCH parent (created via API, mode=SIX_MIN_STITCH, no parent). */
function isStitchParent(j: TutorialJob): boolean {
  return j.mode === "SIX_MIN_STITCH" && j.parent_job_id === null;
}

/** Whether a job is a child segment (has a parent_job_id set). */
function isSegmentChild(j: TutorialJob): boolean {
  return j.parent_job_id !== null;
}

/**
 * Set an audio element's playback rate while preserving pitch, so faster
 * speeds sound natural (not chipmunk-y / perceptually "way too fast").
 */
function applyRate(el: HTMLAudioElement | null, rate: number) {
  if (!el) return;
  el.playbackRate = rate;
  const a = el as unknown as Record<string, unknown>;
  a.preservesPitch = true;
  a.mozPreservesPitch = true;
  a.webkitPreservesPitch = true;
}

export function ProductionStudio({
  jobs,
  settings,
  onChange,
  onRecordingUploaded,
}: StudioProps) {
  // Top-level recordable jobs: either single-clip jobs that are ready-ish,
  // or SIX_MIN_STITCH parent jobs (shown as progress trackers).
  const readyJobs = jobs.filter(
    (j) =>
      // Include SIX_MIN_STITCH parents regardless of status (they show segment progress)
      isStitchParent(j) ||
      // Include single-clip jobs that are in an active/terminal state
      (!isSegmentChild(j) &&
        !isStitchParent(j) &&
        (j.status === "READY_TO_RECORD" ||
          j.status === "AWAITING_UPLOAD" ||
          j.status === "SPLICING" ||
          j.status === "COMPLETED" ||
          j.status === "FAILED_SPLICE")),
  );

  const [selected, setSelected] = useState<TutorialJob | null>(null);
  const [speed, setSpeed] = useState<number>(
    Number(settings?.default_playback_speed ?? 1),
  );
  const [speedLocked, setSpeedLocked] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [regenerating, setRegenerating] = useState<"script" | "audio" | null>(
    null,
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hotkey = settings?.record_hotkey ?? "Space";

  // Keep selected in sync with latest job data
  const selectedJob = selected
    ? (jobs.find((j) => j.id === selected.id) ?? selected)
    : null;

  // Reset speed + lock when a new job is selected
  useEffect(() => {
    setSpeedLocked(false);
    setUploadProgress(null);
    setSpeed(
      Number(selected?.playback_speed ?? settings?.default_playback_speed ?? 1),
    );
  }, [selected?.id]);

  async function lockAndPlay() {
    if (!audioRef.current || !selectedJob) return;
    if (!speedLocked) {
      setSpeedLocked(true);
      await fetch(`/api/production/jobs/${selectedJob.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playback_speed: speed }),
      }).catch(() => {});
    }
    applyRate(audioRef.current, speed);
    if (audioRef.current.paused) {
      void audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }

  // Keep the preview player's rate in sync with the chosen speed (pitch
  // preserved) so the VA hears exactly how fast it will be — whether they play
  // it via the play-bar controls or the hotkey — without having to lock first.
  useEffect(() => {
    applyRate(audioRef.current, speed);
  }, [speed, selectedJob?.id, selectedJob?.audio_path]);

  // Hotkey: Space (or configured key) toggles play/pause
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const code = e.code === "Space" ? "Space" : e.key;
      const target = e.target as HTMLElement;
      if (
        selectedJob &&
        code === hotkey &&
        !target.closest("input,textarea,select")
      ) {
        e.preventDefault();
        void lockAndPlay();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedJob, speed, speedLocked, hotkey]);

  async function handleRegenerate(target: "script" | "audio") {
    if (!selectedJob) return;
    setRegenerating(target);
    try {
      const res = await fetch(
        `/api/production/jobs/${selectedJob.id}/regenerate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target }),
        },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        `Regenerating ${target === "script" ? "script" : "audio"}…`,
      );
      onChange();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegenerating(null);
    }
  }

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file || !selectedJob) return;

      setUploading(true);
      setUploadProgress(0);
      try {
        await uploadFileWithProgress(
          file,
          `/api/production/jobs/${selectedJob.id}/recording`,
          (p) => setUploadProgress(p),
        );
        toast.success(
          "Recording uploaded! Processing your final video — track it in the Videos tab.",
        );
        onChange();
        setUploadProgress(null);
        // Jump to the Videos tab so the VA sees the processing bar + download.
        onRecordingUploaded?.();
      } catch (e) {
        toast.error(
          `Upload failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        setUploadProgress(null);
      } finally {
        setUploading(false);
      }
    },
    [selectedJob, onChange, onRecordingUploaded],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
      "video/x-matroska": [".mkv"],
      "video/webm": [".webm"],
    },
    multiple: false,
    disabled:
      uploading || !selectedJob || selectedJob.status !== "READY_TO_RECORD",
  });

  async function handleMarkUploaded() {
    if (!selectedJob) return;
    try {
      const res = await fetch(
        `/api/production/jobs/${selectedJob.id}/mark-uploaded`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Marked as uploaded to Drive.");
      onChange();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "280px 1fr",
        gap: 20,
        alignItems: "start",
        minHeight: 500,
      }}
    >
      {/* Left: job list */}
      <GlassCard style={{ padding: 16 }}>
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
          Jobs Ready to Record
        </div>

        {readyJobs.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "24px 12px",
              color: "var(--v2-text-2)",
              fontSize: 12,
            }}
          >
            No jobs ready yet.
            <br />
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              Create a job in the Create tab.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {readyJobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setSelected(j)}
                style={{
                  background:
                    selectedJob?.id === j.id
                      ? "rgba(var(--v2-accent-rgb), 0.15)"
                      : "rgba(255,255,255,0.03)",
                  border:
                    selectedJob?.id === j.id
                      ? "1px solid rgba(var(--v2-accent-rgb), 0.4)"
                      : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--v2-text-1)",
                    marginBottom: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {j.title}
                </div>
                <StatusBadge status={j.status} />
              </button>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Right: guided flow */}
      {!selectedJob ? (
        <GlassCard style={{ padding: 40, textAlign: "center" }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 48, color: "var(--v2-text-2)", opacity: 0.4 }}
          >
            smart_display
          </span>
          <p
            style={{
              fontSize: 14,
              color: "var(--v2-text-2)",
              marginTop: 12,
            }}
          >
            Select a job from the list to begin recording
          </p>
        </GlassCard>
      ) : isStitchParent(selectedJob) ? (
        // ── SIX_MIN_STITCH parent view ────────────────────────────────────
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Parent header */}
          <GlassCard style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--v2-text-1)",
                    margin: 0,
                  }}
                >
                  {selectedJob.title}
                </h2>
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <StatusBadge status={selectedJob.status} />
                  <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                    Long-Form Stitch
                    {selectedJob.target_minutes
                      ? ` · target ${selectedJob.target_minutes} min`
                      : ""}
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Segments panel */}
          {(() => {
            const children = jobs
              .filter((j) => j.parent_job_id === selectedJob.id)
              .sort((a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0));
            const completedCount = children.filter(
              (c) => c.status === "COMPLETED",
            ).length;
            const totalCount = children.length;

            return (
              <GlassCard style={{ padding: 20 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--v2-accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Segments
                  </div>
                  {totalCount > 0 && (
                    <span style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
                      {completedCount} / {totalCount} completed
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {totalCount > 0 && (
                  <div
                    style={{
                      height: 4,
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 2,
                      marginBottom: 16,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((completedCount / totalCount) * 100)}%`,
                        height: "100%",
                        background: "var(--v2-accent)",
                        transition: "width 300ms",
                      }}
                    />
                  </div>
                )}

                {totalCount === 0 ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--v2-text-2)",
                      margin: 0,
                    }}
                  >
                    Segments are being generated — check back in a moment.
                  </p>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {children.map((child) => (
                      <div
                        key={child.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 8,
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
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
                            {child.title}
                          </div>
                          {child.audio_duration_s && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--v2-text-2)",
                                marginTop: 2,
                              }}
                            >
                              Audio: {Number(child.audio_duration_s).toFixed(1)}
                              s
                            </div>
                          )}
                        </div>
                        <StatusBadge status={child.status} />
                        {(child.status === "READY_TO_RECORD" ||
                          child.status === "AWAITING_UPLOAD" ||
                          child.status === "SPLICING" ||
                          child.status === "COMPLETED" ||
                          child.status === "FAILED_SPLICE") && (
                          <V2Button
                            variant={
                              child.status === "READY_TO_RECORD"
                                ? "accent"
                                : "outline"
                            }
                            size="sm"
                            onClick={() => setSelected(child)}
                          >
                            {child.status === "READY_TO_RECORD"
                              ? "Record"
                              : "View"}
                          </V2Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            );
          })()}

          {/* If parent COMPLETED, show stitched video */}
          {selectedJob.status === "COMPLETED" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#22c55e",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Final Stitched Video
              </div>
              <video
                src={`/api/production/jobs/${selectedJob.id}/download`}
                controls
                style={{
                  width: "100%",
                  borderRadius: 8,
                  background: "#000",
                  marginBottom: 16,
                  maxHeight: 360,
                }}
              />
              <div style={{ display: "flex", gap: 12 }}>
                <a
                  href={`/api/production/jobs/${selectedJob.id}/download`}
                  download
                  style={{ textDecoration: "none" }}
                >
                  <V2Button variant="accent" size="md">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      download
                    </span>
                    Download Final MP4
                  </V2Button>
                </a>
                <V2Button
                  variant="outline"
                  size="md"
                  onClick={handleMarkUploaded}
                  disabled={selectedJob.delivered_to_drive ?? false}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    {selectedJob.delivered_to_drive
                      ? "check_circle"
                      : "drive_folder_upload"}
                  </span>
                  {selectedJob.delivered_to_drive
                    ? "Uploaded to Drive"
                    : "Mark Uploaded to Drive"}
                </V2Button>
              </div>
            </GlassCard>
          )}

          {/* Parent failed-stitch state */}
          {selectedJob.status === "FAILED_SPLICE" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#ef4444",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 8,
                }}
              >
                Stitch Failed
              </div>
              {selectedJob.error_message && (
                <p
                  style={{ fontSize: 12, color: "var(--v2-text-2)", margin: 0 }}
                >
                  {selectedJob.error_message}
                </p>
              )}
            </GlassCard>
          )}
        </div>
      ) : (
        // ── Standard single-clip flow ────────────────────────────────────
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Job header */}
          <GlassCard style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--v2-text-1)",
                    margin: 0,
                  }}
                >
                  {selectedJob.title}
                </h2>
                <div style={{ marginTop: 6 }}>
                  <StatusBadge status={selectedJob.status} />
                  {selectedJob.audio_duration_s && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        color: "var(--v2-text-2)",
                      }}
                    >
                      Audio: {Number(selectedJob.audio_duration_s).toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Step 1: Review Script */}
          <GlassCard style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--v2-accent)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              Step 1 — Review Script
            </div>

            {selectedJob.script_text ? (
              <pre
                style={{
                  background: "rgba(0,0,0,0.3)",
                  borderRadius: 8,
                  padding: 16,
                  fontSize: 12,
                  color: "var(--v2-text-1)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 300,
                  overflow: "auto",
                  fontFamily: "inherit",
                  margin: 0,
                }}
              >
                {selectedJob.script_text}
              </pre>
            ) : (
              <p style={{ color: "var(--v2-text-2)", fontSize: 12 }}>
                Script not yet generated.
              </p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <V2Button
                variant="outline"
                size="sm"
                onClick={() => handleRegenerate("script")}
                disabled={!!regenerating}
              >
                {regenerating === "script"
                  ? "Regenerating…"
                  : "Regenerate Script"}
              </V2Button>
              <V2Button
                variant="outline"
                size="sm"
                onClick={() => handleRegenerate("audio")}
                disabled={!!regenerating || !selectedJob.script_text}
              >
                {regenerating === "audio"
                  ? "Regenerating…"
                  : "Regenerate Audio"}
              </V2Button>
            </div>
          </GlassCard>

          {/* Step 2: Speed Control */}
          <GlassCard style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--v2-accent)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              Step 2 — Playback Speed
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={speed}
                disabled={speedLocked}
                onChange={(e) => setSpeed(Number(e.target.value))}
                style={{
                  flex: 1,
                  accentColor: "var(--v2-accent)",
                  opacity: speedLocked ? 0.5 : 1,
                  cursor: speedLocked ? "not-allowed" : "pointer",
                }}
              />
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: speedLocked ? "var(--v2-text-2)" : "var(--v2-accent)",
                  minWidth: 48,
                  textAlign: "right",
                }}
              >
                {speed.toFixed(1)}×
              </span>
            </div>

            {speedLocked && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: "#f59e0b",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 14 }}
                >
                  lock
                </span>
                Speed locked — selected on first play
              </div>
            )}

            {!speedLocked && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: "var(--v2-text-2)",
                }}
              >
                Drag to set the speed, then use the player below to preview how
                it sounds. The speed only locks once you start recording (Step
                3).
              </div>
            )}

            {/* Preview play-bar — listen at the chosen speed before recording */}
            {selectedJob.audio_path && (
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--v2-text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 6,
                  }}
                >
                  Preview ({speed.toFixed(1)}×)
                </div>
                <audio
                  ref={audioRef}
                  src={`/api/production/jobs/${selectedJob.id}/audio`}
                  controls
                  preload="auto"
                  onLoadedMetadata={(e) => applyRate(e.currentTarget, speed)}
                  style={{ width: "100%" }}
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: "var(--v2-text-2)",
                  }}
                >
                  Play this to hear the full clip at {speed.toFixed(1)}× before
                  you record — adjusting the slider changes it live.
                </div>
              </div>
            )}
          </GlassCard>

          {/* Step 3: Record Instructions */}
          {selectedJob.status === "READY_TO_RECORD" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#22c55e",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 12,
                }}
              >
                Step 3 — Record Your Screen
              </div>

              <ol
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  Open OBS and set up your screen capture.
                </li>
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  Press{" "}
                  <kbd
                    style={{
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  >
                    {hotkey}
                  </kbd>{" "}
                  to play the audio — it starts at {speed.toFixed(1)}× speed.
                </li>
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  <strong style={{ color: "#22c55e" }}>
                    Record the WHOLE thing in ONE take
                  </strong>{" "}
                  from the very start.
                </li>
                <li style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
                  Stop OBS and save the recording, then upload it below.
                </li>
              </ol>

              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <V2Button
                  variant="accent"
                  size="lg"
                  onClick={lockAndPlay}
                  disabled={!selectedJob.audio_path}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18 }}
                  >
                    play_arrow
                  </span>
                  Play Audio ({hotkey})
                </V2Button>
                <span style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                  Locks speed on first play
                </span>
              </div>
            </GlassCard>
          )}

          {/* Step 4: Upload Recording */}
          {selectedJob.status === "READY_TO_RECORD" && (
            <GlassCard style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 12,
                }}
              >
                Step 4 — Upload Your Recording
              </div>

              <div
                {...getRootProps()}
                style={{
                  border: isDragActive
                    ? "2px dashed var(--v2-accent)"
                    : "2px dashed rgba(255,255,255,0.15)",
                  borderRadius: 12,
                  padding: "32px 24px",
                  textAlign: "center",
                  cursor: uploading ? "wait" : "pointer",
                  transition: "border-color 150ms, background 150ms",
                  background: isDragActive
                    ? "rgba(var(--v2-accent-rgb), 0.07)"
                    : "transparent",
                }}
              >
                <input {...getInputProps()} />
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 40,
                    color: "var(--v2-text-2)",
                    opacity: 0.5,
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  upload_file
                </span>
                {uploading ? (
                  <div>
                    <p
                      style={{
                        fontSize: 14,
                        color: "var(--v2-text-1)",
                        margin: 0,
                      }}
                    >
                      Uploading… {uploadProgress ?? 0}%
                    </p>
                    <div
                      style={{
                        marginTop: 8,
                        height: 4,
                        background: "rgba(255,255,255,0.1)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${uploadProgress ?? 0}%`,
                          height: "100%",
                          background: "var(--v2-accent)",
                          transition: "width 300ms",
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        fontSize: 14,
                        color: "var(--v2-text-1)",
                        margin: "0 0 4px 0",
                      }}
                    >
                      Drag & drop or click to upload
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--v2-text-2)",
                        margin: 0,
                      }}
                    >
                      .mp4 · .mov · .mkv · .webm
                    </p>
                  </>
                )}
              </div>
            </GlassCard>
          )}

          {/* Step 5: Splicing in progress */}
          {(selectedJob.status === "AWAITING_UPLOAD" ||
            selectedJob.status === "SPLICING") && (
            <GlassCard style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#f59e0b",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 12,
                }}
              >
                Processing
              </div>
              <p style={{ fontSize: 13, color: "var(--v2-text-1)", margin: 0 }}>
                Your recording is being processed into the final video. Track
                the progress and download it from the <strong>Videos</strong>{" "}
                tab — it updates automatically when it&apos;s ready.
              </p>
            </GlassCard>
          )}

          {/* Step 5: Completed — preview + download + drive */}
          {selectedJob.status === "COMPLETED" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#22c55e",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Step 5 — Preview & Download
              </div>

              <video
                src={`/api/production/jobs/${selectedJob.id}/download`}
                controls
                style={{
                  width: "100%",
                  borderRadius: 8,
                  background: "#000",
                  marginBottom: 16,
                  maxHeight: 360,
                }}
              />

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a
                  href={`/api/production/jobs/${selectedJob.id}/download`}
                  download
                  style={{ textDecoration: "none" }}
                >
                  <V2Button variant="accent" size="md">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16 }}
                    >
                      download
                    </span>
                    Download MP4
                  </V2Button>
                </a>

                <V2Button
                  variant="outline"
                  size="md"
                  onClick={handleMarkUploaded}
                  disabled={selectedJob.delivered_to_drive ?? false}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    {selectedJob.delivered_to_drive
                      ? "check_circle"
                      : "drive_folder_upload"}
                  </span>
                  {selectedJob.delivered_to_drive
                    ? "Uploaded to Drive"
                    : "Mark Uploaded to Drive"}
                </V2Button>

                <V2Button
                  variant="ghost"
                  size="md"
                  disabled
                  title="Coming soon"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    cloud_upload
                  </span>
                  Auto-upload to Drive — Coming Soon
                </V2Button>
              </div>
            </GlassCard>
          )}

          {/* Failed state */}
          {selectedJob.status === "FAILED_SPLICE" && (
            <GlassCard
              style={{
                padding: 20,
                border: "1px solid rgba(239, 68, 68, 0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#ef4444",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 8,
                }}
              >
                Splice Failed
              </div>
              {selectedJob.error_message && (
                <p
                  style={{ fontSize: 12, color: "var(--v2-text-2)", margin: 0 }}
                >
                  {selectedJob.error_message}
                </p>
              )}
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
