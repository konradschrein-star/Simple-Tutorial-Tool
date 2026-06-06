"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { V2Button, V2Input, V2Select, GlassCard } from "../../_components";
import type {
  TutorialPromptPreset,
  TutorialSettingsRow,
  TutorialJob,
} from "@repo/db";
import type { ProviderMeta } from "@repo/contracts";

interface CreateProps {
  presets: TutorialPromptPreset[];
  providers: { llm: ProviderMeta[]; tts: ProviderMeta[] };
  /** Provider slots that have an API key configured (no secret material). */
  configuredSlots: Array<{ capability: string; provider: string }>;
  settings: TutorialSettingsRow;
  /** Live job list (polled by the parent) — drives the Generation Queue. */
  jobs: TutorialJob[];
  /** Current user id — used to remember sidebar selections per account. */
  userId: string;
  onCreated: () => void;
  /** Switch to the Studio tab (to record a READY job). */
  onGoToStudio: () => void;
}

type TutorialMode = "THREE_MIN" | "SIX_MIN" | "SIX_MIN_STITCH";

// Curated "standard" tutorial voices (ElevenLabs via AI33). VAs pick one of
// these from a dropdown; a specific voice id is still possible via "Custom…".
const STANDARD_VOICES: Array<{ id: string; label: string }> = [
  { id: "elevenlabs_TX3LPaxmHKxFdv7VOQHJ", label: "Standard Voice 1" },
  { id: "elevenlabs_LYg7sV1lKlWiLfgmyT5L", label: "Standard Voice 2" },
  { id: "elevenlabs_L9YfwBz6PMs8GipTR591", label: "Standard Voice 3" },
];
const CUSTOM_VOICE = "__custom__";
const isStandardVoice = (v: string) => STANDARD_VOICES.some((x) => x.id === v);

interface QueueJob {
  id: string;
  title: string;
  status: string;
  progress: number;
  created_at: string | Date;
  error_message: string | null;
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

// Statuses where the system is actively working → show a determinate bar.
const ACTIVE_STATUSES = new Set([
  "QUEUED",
  "GENERATING_SCRIPT",
  "GENERATING_AUDIO",
  "SPLICING",
]);
const FAILED_STATUSES = new Set([
  "FAILED_SCRIPT",
  "FAILED_AUDIO",
  "FAILED_SPLICE",
]);

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
        whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

interface VoiceSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number | "";
  onChange: (v: number | "") => void;
  hint?: string;
}

function VoiceSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  hint,
}: VoiceSliderProps) {
  const displayValue =
    value === "" ? "—" : (value as number).toFixed(step < 1 ? 2 : 0);
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ fontSize: 12, color: "var(--v2-text-1)", fontWeight: 600 }}
          >
            {displayValue}
          </span>
          {value !== "" && (
            <button
              onClick={() => onChange("")}
              title="Clear (use provider default)"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--v2-text-2)",
                fontSize: 10,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value === "" ? min + (max - min) / 2 : value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--v2-accent)" }}
      />
      {hint && (
        <div style={{ fontSize: 9, color: "var(--v2-text-2)", marginTop: 3 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function ProductionCreate({
  presets,
  providers,
  configuredSlots,
  settings,
  jobs,
  userId,
  onCreated,
  onGoToStudio,
}: CreateProps) {
  // The prompt-preset category for a given mode (stitch shares SIX_MIN_STITCH).
  const categoryForMode = (m: TutorialMode) =>
    m === "SIX_MIN_STITCH" ? "SIX_MIN_STITCH" : m;
  // All "standard" presets for a mode (admin-marked is_default). We CYCLE
  // through these per job so consecutive scripts don't open the same way.
  const standardPresetsFor = (m: TutorialMode) =>
    presets.filter((p) => p.category === categoryForMode(m) && p.is_default);
  // Remember the last standard preset we auto-picked so the next pick differs.
  const lastPresetRef = useRef<string>("");
  // Pick a standard preset for the mode, avoiding the previous one so the
  // opener/CTA varies job-to-job. Side-effecty (updates ref + randomness) —
  // call from effects/handlers, never during render.
  const pickStandardPreset = (m: TutorialMode): string => {
    const pool = standardPresetsFor(m);
    if (pool.length === 0) return "none";
    if (pool.length === 1) return pool[0]!.id;
    const fresh = pool.filter((p) => p.id !== lastPresetRef.current);
    const arr = fresh.length ? fresh : pool;
    const pick = arr[Math.floor(Math.random() * arr.length)]!;
    lastPresetRef.current = pick.id;
    return pick.id;
  };

  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [mode, setMode] = useState<TutorialMode>("THREE_MIN");
  const [targetMinutes, setTargetMinutes] = useState<number | "">(20);
  const [refVideoSeconds, setRefVideoSeconds] = useState<number | "">("");
  const [scriptProvider, setScriptProvider] = useState(
    providers.llm.find((p) => p.isDefault)?.id ?? providers.llm[0]?.id ?? "",
  );
  const [ttsProvider, setTtsProvider] = useState(
    providers.tts.find((p) => p.isDefault)?.id ?? providers.tts[0]?.id ?? "",
  );
  // Pre-fill the voice with the tool's default (if an admin set one), else the
  // first standard voice. The VA picks from the standard voices or a custom id.
  const initialVoice =
    settings.default_tts_voice || STANDARD_VOICES[0]?.id || "";
  const [ttsVoice, setTtsVoice] = useState(initialVoice);
  const [voiceCustom, setVoiceCustom] = useState(
    () => initialVoice !== "" && !isStandardVoice(initialVoice),
  );
  // Voice settings state
  const [vsModel, setVsModel] = useState("");
  // Speed starts from the tool's standard (default_voice_settings.speed = 1.0 =
  // normal pace). Falls back to 1.0 if unset, so the standard is always 1×.
  const [vsSpeed, setVsSpeed] = useState<number | "">(() => {
    const s = (settings.default_voice_settings as { speed?: unknown } | null)
      ?.speed;
    return typeof s === "number" ? s : 1.0;
  });
  const [vsStability, setVsStability] = useState<number | "">("");
  const [vsSimilarity, setVsSimilarity] = useState<number | "">("");
  const [vsPitch, setVsPitch] = useState<number | "">("");
  const [vsVolume, setVsVolume] = useState<number | "">("");
  const [vsLanguage, setVsLanguage] = useState("");
  const [presetId, setPresetId] = useState<string>("none");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  // Optimistic rows so a just-created job shows in the queue instantly,
  // before the first poll returns it from the server.
  const [optimistic, setOptimistic] = useState<QueueJob[]>([]);
  const batchIdRef = useRef<string | null>(null);

  // ── Per-account memory of the sidebar selections ────────────────────────
  // Persisted to localStorage keyed by user id, so each VA's provider/voice
  // choices are remembered across visits on their machine.
  // v2: reset previously-remembered sidebar prefs once, to clear any stale Speed
  // value (e.g. an accidental 1.5) saved before the slider range/defaults fix.
  const PERSIST_KEY = userId ? `tpe:create:v2:${userId}` : null;
  const hydrated = useRef(false);

  useEffect(() => {
    if (!PERSIST_KEY) {
      hydrated.current = true;
      return;
    }
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Record<string, unknown>;
        if (
          typeof p.mode === "string" &&
          ["THREE_MIN", "SIX_MIN", "SIX_MIN_STITCH"].includes(p.mode)
        )
          setMode(p.mode as TutorialMode);
        if (
          typeof p.scriptProvider === "string" &&
          providers.llm.some((x) => x.id === p.scriptProvider)
        )
          setScriptProvider(p.scriptProvider);
        if (
          typeof p.ttsProvider === "string" &&
          providers.tts.some((x) => x.id === p.ttsProvider)
        )
          setTtsProvider(p.ttsProvider);
        if (typeof p.ttsVoice === "string") {
          setTtsVoice(p.ttsVoice);
          setVoiceCustom(p.ttsVoice !== "" && !isStandardVoice(p.ttsVoice));
        }
        if (typeof p.vsModel === "string") setVsModel(p.vsModel);
        if (typeof p.vsLanguage === "string") setVsLanguage(p.vsLanguage);
        const num = (v: unknown): number | "" =>
          v === "" || typeof v === "number" ? (v as number | "") : "";
        // Speed is intentionally NOT restored from saved prefs — it always
        // follows the tool's standard (default_voice_settings.speed = 1.0) so it
        // can't get stuck at an old value.
        if ("vsStability" in p) setVsStability(num(p.vsStability));
        if ("vsSimilarity" in p) setVsSimilarity(num(p.vsSimilarity));
        if ("vsPitch" in p) setVsPitch(num(p.vsPitch));
        if ("vsVolume" in p) setVsVolume(num(p.vsVolume));
        if (typeof p.useCustomPrompt === "boolean")
          setUseCustomPrompt(p.useCustomPrompt);
        if (typeof p.customPrompt === "string") setCustomPrompt(p.customPrompt);
      }
    } catch {
      // ignore corrupt prefs
    }
    hydrated.current = true;
    // Only run once per user — providers list is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [PERSIST_KEY]);

  useEffect(() => {
    if (!hydrated.current || !PERSIST_KEY) return;
    try {
      localStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({
          mode,
          scriptProvider,
          ttsProvider,
          ttsVoice,
          vsModel,
          vsSpeed,
          vsStability,
          vsSimilarity,
          vsPitch,
          vsVolume,
          vsLanguage,
          useCustomPrompt,
          customPrompt,
        }),
      );
    } catch {
      // storage full / unavailable — non-fatal
    }
  }, [
    PERSIST_KEY,
    mode,
    scriptProvider,
    ttsProvider,
    ttsVoice,
    vsModel,
    vsSpeed,
    vsStability,
    vsSimilarity,
    vsPitch,
    vsVolume,
    vsLanguage,
    useCustomPrompt,
    customPrompt,
  ]);

  // Keep the prompt preset in sync with the selected mode, cycling through the
  // standard presets so a usable (and varied) prompt is always selected. The VA
  // can still override it in the dropdown.
  useEffect(() => {
    setPresetId(pickStandardPreset(mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Dropzone for .md / .txt files → paste into steps textarea
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setSteps((prev) => (prev ? prev + "\n\n" + text : text));
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/markdown": [".md"], "text/plain": [".txt"] },
    multiple: false,
    noClick: true,
  });

  // ── Provider availability ───────────────────────────────────────────────
  const configuredSet = useMemo(
    () =>
      new Set(
        configuredSlots.map(
          // strip the -2/-3 throughput suffix so "ai33-2" counts as "ai33"
          (s) => `${s.capability}:${s.provider.replace(/-\d+$/, "")}`,
        ),
      ),
    [configuredSlots],
  );

  const providerHasKey = useCallback(
    (p: ProviderMeta | undefined, capability: "LLM" | "TTS"): boolean => {
      if (!p) return false;
      if (!p.secretProvider) return true; // no key needed (e.g. Gemini Pool)
      return configuredSet.has(`${capability}:${p.secretProvider}`);
    },
    [configuredSet],
  );

  const optLabel = useCallback(
    (p: ProviderMeta, capability: "LLM" | "TTS"): string => {
      if (p.comingSoon) return `${p.label} — Coming Soon`;
      if (!providerHasKey(p, capability)) return `${p.label} — no API key`;
      if (p.unreliable) return `${p.label} ⚠ can be unreliable`;
      return p.label;
    },
    [providerHasKey],
  );

  const llmOptions = providers.llm.map((p) => ({
    value: p.id,
    label: optLabel(p, "LLM"),
  }));

  const ttsOptions = providers.tts.map((p) => ({
    value: p.id,
    label: optLabel(p, "TTS"),
  }));

  const modeOptions = [
    { value: "THREE_MIN", label: "3-Minute Tutorial" },
    { value: "SIX_MIN", label: "6-Minute Tutorial" },
    { value: "SIX_MIN_STITCH", label: "Long-Form Stitch (6-Min segments)" },
  ];

  const relevantPresets = presets.filter(
    (p) => p.category === (mode === "SIX_MIN_STITCH" ? "SIX_MIN_STITCH" : mode),
  );
  const presetOptions = [
    { value: "none", label: "— Select a prompt preset —" },
    ...relevantPresets.map((p) => ({ value: p.id, label: p.name })),
  ];

  const selectedLlm = providers.llm.find((p) => p.id === scriptProvider);
  const selectedTts = providers.tts.find((p) => p.id === ttsProvider);

  // What's still missing before a job can be created (drives the disabled
  // state + the hint under the button).
  const missing: string[] = [];
  if (!title.trim()) missing.push("a title");
  if (!steps.trim()) missing.push("the steps / outline");
  if (!ttsVoice.trim()) missing.push("a voice ID (sidebar)");
  if (selectedLlm?.comingSoon) missing.push("an available script provider");
  else if (selectedLlm && !providerHasKey(selectedLlm, "LLM"))
    missing.push("a script provider with an API key");
  if (selectedTts?.comingSoon) missing.push("an available voice provider");
  else if (selectedTts && !providerHasKey(selectedTts, "TTS"))
    missing.push("a voice provider with an API key");
  if (useCustomPrompt) {
    if (!customPrompt.trim()) missing.push("a custom prompt");
  } else if (presetId === "none") {
    missing.push("a prompt preset");
  }
  const canSubmit = missing.length === 0;

  // ── Live Generation Queue (optimistic rows + polled jobs, deduped) ───────
  const queueJobs: QueueJob[] = useMemo(() => {
    const byId = new Map<string, QueueJob>();
    for (const o of optimistic) byId.set(o.id, o);
    for (const j of jobs) {
      byId.set(j.id, {
        id: j.id,
        title: j.title,
        status: j.status as string,
        progress: j.progress ?? 0,
        created_at: j.created_at,
        error_message: j.error_message ?? null,
      });
    }
    return Array.from(byId.values())
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 15);
  }, [jobs, optimistic]);

  async function handleGenerate() {
    // Validation — a job must have a title, steps, a voice, and providers
    // that are actually usable (not coming-soon, with an API key configured).
    if (!title.trim()) {
      toast.error("Please enter a tutorial title.");
      return;
    }
    if (!steps.trim()) {
      toast.error("Please enter the tutorial steps / outline.");
      return;
    }
    if (!ttsVoice.trim()) {
      toast.error("Please enter a Voice ID / Name in the sidebar.");
      return;
    }
    if (selectedLlm?.comingSoon) {
      toast.error("That script provider is coming soon.");
      return;
    }
    if (selectedTts?.comingSoon) {
      toast.error("That voice provider is coming soon.");
      return;
    }
    if (!providerHasKey(selectedLlm, "LLM")) {
      toast.error(
        `No API key configured for ${selectedLlm?.label ?? "that script provider"}. Ask an admin to add one in Settings.`,
      );
      return;
    }
    if (!providerHasKey(selectedTts, "TTS")) {
      toast.error(
        `No API key configured for ${selectedTts?.label ?? "that voice provider"}. Ask an admin to add one in Settings.`,
      );
      return;
    }
    if (useCustomPrompt && !customPrompt.trim()) {
      toast.error("Enter your custom prompt, or switch back to a preset.");
      return;
    }
    if (!useCustomPrompt && presetId === "none") {
      toast.error("Select a prompt preset (or use a custom prompt).");
      return;
    }

    if (!batchIdRef.current) {
      // generate a local UUID for this browser session batch
      batchIdRef.current = crypto.randomUUID();
    }

    setLoading(true);
    try {
      // Collect voice settings — only include fields the user actually set
      const voiceSettings: Record<string, unknown> = {};
      if (vsModel.trim()) voiceSettings.model = vsModel.trim();
      if (vsSpeed !== "") voiceSettings.speed = vsSpeed;
      if (vsStability !== "") voiceSettings.stability = vsStability;
      if (vsSimilarity !== "") voiceSettings.similarity = vsSimilarity;
      if (vsPitch !== "") voiceSettings.pitch = vsPitch;
      if (vsVolume !== "") voiceSettings.volume = vsVolume;
      if (vsLanguage.trim()) voiceSettings.language = vsLanguage.trim();

      const body: Record<string, unknown> = {
        title: title.trim(),
        steps_input: steps.trim(),
        mode,
        script_provider: scriptProvider,
        tts_provider: ttsProvider,
        tts_voice: ttsVoice.trim(),
        batch_id: batchIdRef.current,
        voice_settings:
          Object.keys(voiceSettings).length > 0 ? voiceSettings : undefined,
      };
      if (mode === "SIX_MIN_STITCH") {
        if (targetMinutes !== "") body.target_minutes = targetMinutes;
        if (refVideoSeconds !== "") body.ref_video_seconds = refVideoSeconds;
      }
      if (presetId !== "none") body.prompt_preset_id = presetId;
      if (useCustomPrompt && customPrompt.trim())
        body.custom_prompt = customPrompt.trim();

      const res = await fetch("/api/production/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const { jobId } = (await res.json()) as { jobId: string };
      // Show it in the queue immediately (before the first poll).
      setOptimistic((prev) => [
        {
          id: jobId,
          title: title.trim(),
          status: "QUEUED",
          progress: 0,
          created_at: new Date().toISOString(),
          error_message: null,
        },
        ...prev,
      ]);
      toast.success("Job created — script generation started.");
      setTitle("");
      setSteps("");
      // Rotate to a different standard prompt for the next job (varies openers).
      if (!useCustomPrompt) setPresetId(pickStandardPreset(mode));
      onCreated();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // Reset clears this job's content only — the remembered sidebar selections
  // (providers / voice / settings) stay intact.
  function handleReset() {
    setTitle("");
    setSteps("");
    setMode("THREE_MIN");
    setTargetMinutes(20);
    setRefVideoSeconds("");
    batchIdRef.current = null;
    setOptimistic([]);
  }

  // Cancel a stuck/in-progress job (de-queues + marks CANCELLED, keeps the row).
  async function cancelJob(id: string) {
    try {
      const res = await fetch(`/api/production/jobs/${id}`, { method: "POST" });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      toast.success("Job cancelled.");
      onCreated();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Delete a job entirely (de-queue + remove files + delete row).
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
      setOptimistic((prev) => prev.filter((o) => o.id !== id));
      toast.success("Job deleted.");
      onCreated();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function copyError(j: QueueJob) {
    const text = `Tutorial job failed\nTitle: ${j.title}\nJob ID: ${j.id}\nStatus: ${j.status}\nError: ${j.error_message ?? ""}`;
    navigator.clipboard
      .writeText(text)
      .then(() =>
        toast.success("Full error copied — paste it to your manager."),
      )
      .catch(() => toast.error("Couldn't copy to clipboard."));
  }

  const smallBtn: CSSProperties = {
    background: "none",
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    padding: "3px 8px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        gap: 20,
        alignItems: "start",
      }}
    >
      {/* Left: main form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Title */}
        <GlassCard style={{ padding: 20 }}>
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
            Step 1 — Tutorial Details
          </div>
          <V2Input
            label="Tutorial Title"
            placeholder="e.g. How to reset a router in 3 minutes"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />

          {/* Steps + dropzone */}
          <div style={{ marginTop: 16 }}>
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
              Steps / Outline
            </div>
            <div
              {...getRootProps()}
              style={{
                position: "relative",
                border: isDragActive
                  ? "2px dashed var(--v2-accent)"
                  : "2px dashed rgba(255,255,255,0.1)",
                borderRadius: 8,
                transition: "border-color 150ms",
              }}
            >
              <input {...getInputProps()} />
              <textarea
                rows={8}
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                placeholder="Enter tutorial steps, one per line — or drag & drop a .md / .txt file here"
                style={{
                  width: "100%",
                  background: "var(--v2-surface-2)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "var(--v2-text-1)",
                  fontSize: 13,
                  resize: "vertical",
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {isDragActive && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(var(--v2-accent-rgb), 0.10)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--v2-accent)",
                    fontSize: 14,
                    fontWeight: 700,
                    pointerEvents: "none",
                  }}
                >
                  Drop .md or .txt file here
                </div>
              )}
            </div>
          </div>

          {/* Mode select */}
          <div style={{ marginTop: 16 }}>
            <V2Select
              label="Tutorial Mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as TutorialMode)}
              options={modeOptions}
              fullWidth
            />
          </div>

          {/* SIX_MIN_STITCH extra fields */}
          {mode === "SIX_MIN_STITCH" && (
            <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
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
                  Target minutes
                </div>
                <input
                  type="number"
                  min={6}
                  max={120}
                  step={1}
                  value={targetMinutes}
                  onChange={(e) =>
                    setTargetMinutes(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  placeholder="e.g. 20"
                  style={{
                    width: "100%",
                    background: "var(--v2-surface-2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
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
                  Ref video length (seconds, optional)
                </div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={refVideoSeconds}
                  onChange={(e) =>
                    setRefVideoSeconds(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  placeholder="e.g. 1200"
                  style={{
                    width: "100%",
                    background: "var(--v2-surface-2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          )}
        </GlassCard>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <V2Button
              variant="accent"
              size="lg"
              onClick={handleGenerate}
              disabled={loading || !canSubmit}
            >
              {loading ? "Submitting…" : "Generate Script & Audio"}
            </V2Button>
            <V2Button
              variant="outline"
              onClick={handleReset}
              disabled={loading}
            >
              Reset
            </V2Button>
          </div>
          {!canSubmit && (
            <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
              Still needed: {missing.join(", ")}.
            </div>
          )}
        </div>

        {/* Generation Queue — live status + progress for the VA */}
        <GlassCard style={{ padding: 20 }}>
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
            Generation Queue
          </div>
          {queueJobs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--v2-text-2)" }}>
              No jobs yet — fill in the details and click “Generate Script &
              Audio”. New jobs appear here instantly with live progress.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {queueJobs.map((j) => {
                const isActive = ACTIVE_STATUSES.has(j.status);
                const isFailed = FAILED_STATUSES.has(j.status);
                const isReady = j.status === "READY_TO_RECORD";
                const isTerminal =
                  isFailed ||
                  j.status === "COMPLETED" ||
                  j.status === "CANCELLED";
                const barColor = STATUS_COLORS[j.status] ?? "#6366f1";
                return (
                  <div
                    key={j.id}
                    style={{
                      padding: "10px 12px",
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
                          color: "var(--v2-text-1)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {j.title}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {isActive && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "var(--v2-text-2)",
                            }}
                          >
                            {j.progress}%
                          </span>
                        )}
                        {isReady && (
                          <button
                            onClick={onGoToStudio}
                            style={{
                              background: "none",
                              border: "1px solid rgba(34,197,94,0.4)",
                              color: "#22c55e",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              padding: "3px 8px",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Record now →
                          </button>
                        )}
                        <StatusBadge status={j.status} />
                      </div>
                    </div>
                    {isActive && (
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
                            width: `${Math.max(j.progress, 4)}%`,
                            background: barColor,
                            borderRadius: 9999,
                            transition: "width 400ms ease",
                          }}
                        />
                      </div>
                    )}
                    {isFailed && j.error_message && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "#ef4444",
                          background: "rgba(239,68,68,0.08)",
                          border: "1px solid rgba(239,68,68,0.25)",
                          borderRadius: 6,
                          padding: "6px 8px",
                          lineHeight: 1.4,
                          wordBreak: "break-word",
                        }}
                      >
                        ⚠ {j.error_message}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        justifyContent: "flex-end",
                      }}
                    >
                      {isFailed && (
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
                      )}
                      {!isTerminal && (
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
                      )}
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
      </div>

      {/* Right: provider / prompt config */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            Script Provider
          </div>
          <V2Select
            label="Script Engine"
            value={scriptProvider}
            onChange={(e) => setScriptProvider(e.target.value)}
            options={llmOptions}
            fullWidth
          />
          {selectedLlm &&
            !selectedLlm.comingSoon &&
            !providerHasKey(selectedLlm, "LLM") && (
              <div style={{ marginTop: 8, fontSize: 10, color: "#f59e0b" }}>
                No API key configured for this provider — ask an admin to add
                one in Settings, or pick another.
              </div>
            )}
        </GlassCard>

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
            Voice / TTS Provider
          </div>
          <V2Select
            label="TTS Provider"
            value={ttsProvider}
            onChange={(e) => setTtsProvider(e.target.value)}
            options={ttsOptions}
            fullWidth
          />
          {selectedTts &&
            !selectedTts.comingSoon &&
            !providerHasKey(selectedTts, "TTS") && (
              <div style={{ marginTop: 8, fontSize: 10, color: "#f59e0b" }}>
                No API key configured for this provider — ask an admin to add
                one in Settings, or pick another.
              </div>
            )}
          <div style={{ marginTop: 12 }}>
            <V2Select
              label="Voice (required)"
              value={
                voiceCustom || !isStandardVoice(ttsVoice)
                  ? CUSTOM_VOICE
                  : ttsVoice
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === CUSTOM_VOICE) {
                  setVoiceCustom(true);
                  setTtsVoice("");
                } else {
                  setVoiceCustom(false);
                  setTtsVoice(val);
                }
              }}
              options={[
                ...STANDARD_VOICES.map((v) => ({
                  value: v.id,
                  label: v.label,
                })),
                { value: CUSTOM_VOICE, label: "Custom voice ID…" },
              ]}
              fullWidth
            />
            {(voiceCustom || !isStandardVoice(ttsVoice)) && (
              <div style={{ marginTop: 10 }}>
                <V2Input
                  label="Custom Voice ID / Name"
                  placeholder="e.g. rachel, elevenlabs_xxxxx, en-US-Neural2-A"
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  fullWidth
                />
              </div>
            )}
          </div>
        </GlassCard>

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
            Voice Settings (optional)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <V2Input
              label="Model (e.g. eleven_turbo_v2)"
              placeholder="Leave blank for provider default"
              value={vsModel}
              onChange={(e) => setVsModel(e.target.value)}
              fullWidth
            />
            <VoiceSlider
              label="Speed"
              min={0.5}
              max={1.5}
              step={0.05}
              value={vsSpeed}
              onChange={setVsSpeed}
              hint="0.5 = slow · 0.7 = calm · 1.0 = normal (our standard) · 1.5 = fastest"
            />
            <VoiceSlider
              label="Stability (ElevenLabs)"
              min={0}
              max={1}
              step={0.05}
              value={vsStability}
              onChange={setVsStability}
              hint="0 = more expressive · 1 = very consistent"
            />
            <VoiceSlider
              label="Similarity (ElevenLabs)"
              min={0}
              max={1}
              step={0.05}
              value={vsSimilarity}
              onChange={setVsSimilarity}
              hint="0 = less similar to original · 1 = very similar"
            />
            <VoiceSlider
              label="Pitch (semitones)"
              min={-12}
              max={12}
              step={1}
              value={vsPitch}
              onChange={setVsPitch}
              hint="-12 = lowest · 0 = default · +12 = highest"
            />
            <VoiceSlider
              label="Volume"
              min={0}
              max={2}
              step={0.05}
              value={vsVolume}
              onChange={setVsVolume}
              hint="0 = silent · 1 = normal · 2 = loudest"
            />
            <V2Input
              label="Language / Boost (e.g. en, zh)"
              placeholder="Leave blank for auto-detect"
              value={vsLanguage}
              onChange={(e) => setVsLanguage(e.target.value)}
              fullWidth
            />
          </div>
        </GlassCard>

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
            Prompt Preset
          </div>
          <V2Select
            label="Preset"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            options={presetOptions}
            fullWidth
            disabled={useCustomPrompt}
          />

          <div style={{ marginTop: 12 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: 12,
                color: "var(--v2-text-2)",
              }}
            >
              <input
                type="checkbox"
                checked={useCustomPrompt}
                onChange={(e) => setUseCustomPrompt(e.target.checked)}
              />
              Use custom prompt instead
            </label>
          </div>

          {useCustomPrompt && (
            <div style={{ marginTop: 12 }}>
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
                Custom System Prompt
              </div>
              <textarea
                rows={5}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Enter your custom system prompt for the script generator…"
                style={{
                  width: "100%",
                  background: "var(--v2-surface-2)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "var(--v2-text-1)",
                  fontSize: 12,
                  resize: "vertical",
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}
        </GlassCard>

        {/* ── Intro Video — Coming Soon ── */}
        <GlassCard style={{ padding: 20, opacity: 0.7 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
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
              Intro Options
            </div>
            <span
              style={{
                display: "inline-block",
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
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "not-allowed",
              fontSize: 12,
              color: "var(--v2-text-2)",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              disabled
              style={{ cursor: "not-allowed", accentColor: "var(--v2-accent)" }}
            />
            <span style={{ fontWeight: 600, color: "var(--v2-text-1)" }}>
              Intro video — Coming Soon
            </span>
          </label>
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: "var(--v2-text-2)",
              lineHeight: 1.5,
              paddingLeft: 22,
            }}
          >
            Have a real person record the first two lines for a more authentic,
            higher-retention intro.
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
