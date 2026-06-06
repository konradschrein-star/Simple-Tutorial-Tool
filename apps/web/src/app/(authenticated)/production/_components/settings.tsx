"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { V2Button, V2Input, GlassCard } from "../../_components";
import {
  saveTutorialProviderKey,
  createTutorialPrompt,
  updateTutorialPrompt,
  updateTutorialSettingsAction,
} from "@/app/actions/tutorial";
import type { TutorialPromptPreset, TutorialSettingsRow } from "@repo/db";
import type { ProviderMeta } from "@repo/contracts";

type PromptCategory = "THREE_MIN" | "SIX_MIN" | "SIX_MIN_STITCH";

interface SettingsProps {
  presets: TutorialPromptPreset[];
  keyMasks: Array<{ capability: string; provider: string; last4: string }>;
  providers: { llm: ProviderMeta[]; tts: ProviderMeta[] };
  settings: TutorialSettingsRow;
  canManage: boolean;
}

function ProviderKeyField({
  capability,
  provider,
  label,
  last4,
}: {
  capability: "LLM" | "TTS";
  provider: string;
  label: string;
  last4: string | undefined;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const result = await saveTutorialProviderKey({
        capability,
        provider,
        apiKey: apiKey.trim(),
      });
      if (result.success) {
        toast.success(`${label} key saved.`);
        setApiKey("");
      } else {
        toast.error(result.error ?? "Failed to save key.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        padding: "12px 16px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 160 }}>
        <div
          style={{ fontSize: 12, fontWeight: 600, color: "var(--v2-text-1)" }}
        >
          {label}
        </div>
        <div style={{ fontSize: 10, color: "var(--v2-text-2)", marginTop: 2 }}>
          {last4 ? `Current key: ••••${last4}` : "No key saved"}
        </div>
      </div>
      <input
        type="password"
        placeholder="Paste new API key…"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        style={{
          flex: 2,
          minWidth: 200,
          background: "var(--v2-surface-2)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "8px 12px",
          color: "var(--v2-text-1)",
          fontSize: 12,
          outline: "none",
        }}
      />
      <V2Button
        size="sm"
        variant="accent"
        onClick={handleSave}
        disabled={saving || !apiKey.trim()}
      >
        {saving ? "Saving…" : "Save"}
      </V2Button>
    </div>
  );
}

function PromptLibrary({ presets }: { presets: TutorialPromptPreset[] }) {
  const [activeCategory, setActiveCategory] =
    useState<PromptCategory>("THREE_MIN");
  const [editing, setEditing] = useState<TutorialPromptPreset | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = presets.filter((p) => p.category === activeCategory);
  const seeded = filtered.filter((p) => p.is_seeded);
  const custom = filtered.filter((p) => !p.is_seeded);

  const CATS: Array<{ id: PromptCategory; label: string }> = [
    { id: "THREE_MIN", label: "3-Min" },
    { id: "SIX_MIN", label: "6-Min" },
    { id: "SIX_MIN_STITCH", label: "6-Min Stitch" },
  ];

  async function handleCreate() {
    if (!newName.trim() || !newPrompt.trim()) return;
    setSaving(true);
    try {
      const result = await createTutorialPrompt({
        category: activeCategory,
        name: newName.trim(),
        system_prompt: newPrompt.trim(),
      });
      if (result.success) {
        toast.success("Prompt created.");
        setCreating(false);
        setNewName("");
        setNewPrompt("");
      } else {
        toast.error(result.error ?? "Failed to create prompt.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, name: string, system_prompt: string) {
    setSaving(true);
    try {
      const result = await updateTutorialPrompt({ id, name, system_prompt });
      if (result.success) {
        toast.success("Prompt updated.");
        setEditing(null);
      } else {
        toast.error(result.error ?? "Failed to update.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Category tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {CATS.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategory(c.id)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              border: "1px solid",
              cursor: "pointer",
              background:
                activeCategory === c.id
                  ? "rgba(var(--v2-accent-rgb), 0.15)"
                  : "transparent",
              borderColor:
                activeCategory === c.id
                  ? "rgba(var(--v2-accent-rgb), 0.4)"
                  : "rgba(255,255,255,0.1)",
              color:
                activeCategory === c.id
                  ? "var(--v2-accent)"
                  : "var(--v2-text-2)",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Seeded presets (read-only) */}
      {seeded.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            Default Presets (read-only)
          </div>
          {seeded.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "10px 14px",
                background: "rgba(255,255,255,0.02)",
                borderRadius: 8,
                marginBottom: 6,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--v2-text-1)",
                  marginBottom: 4,
                }}
              >
                {p.name}
                {p.is_default && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 9,
                      color: "var(--v2-accent)",
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    Default
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--v2-text-2)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 80,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.system_prompt.slice(0, 200)}
                {p.system_prompt.length > 200 ? "…" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom presets (editable) */}
      {custom.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            Your Custom Presets
          </div>
          {custom.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "10px 14px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 8,
                marginBottom: 6,
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {editing?.id === p.id ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    style={{
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                    }}
                  />
                  <textarea
                    rows={4}
                    value={editing.system_prompt}
                    onChange={(e) =>
                      setEditing({ ...editing, system_prompt: e.target.value })
                    }
                    style={{
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <V2Button
                      size="sm"
                      variant="accent"
                      disabled={saving}
                      onClick={() =>
                        handleUpdate(
                          editing.id,
                          editing.name,
                          editing.system_prompt,
                        )
                      }
                    >
                      {saving ? "Saving…" : "Save"}
                    </V2Button>
                    <V2Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </V2Button>
                  </div>
                </div>
              ) : (
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--v2-text-1)",
                        marginBottom: 4,
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
                      {p.system_prompt.slice(0, 100)}
                      {p.system_prompt.length > 100 ? "…" : ""}
                    </div>
                  </div>
                  <V2Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </V2Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create new */}
      {creating ? (
        <div
          style={{
            padding: 16,
            background: "rgba(255,255,255,0.03)",
            borderRadius: 8,
            border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
          }}
        >
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
            New Prompt for {activeCategory.replace(/_/g, "-")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <V2Input
              label="Name"
              placeholder="e.g. Friendly Step-by-Step"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              fullWidth
            />
            <div>
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
                System Prompt
              </div>
              <textarea
                rows={5}
                placeholder="Write a clear, friendly tutorial script…"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                style={{
                  width: "100%",
                  background: "var(--v2-surface-2)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: "var(--v2-text-1)",
                  fontSize: 12,
                  fontFamily: "inherit",
                  resize: "vertical",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <V2Button
                size="sm"
                variant="accent"
                onClick={handleCreate}
                disabled={saving || !newName.trim() || !newPrompt.trim()}
              >
                {saving ? "Creating…" : "Create Prompt"}
              </V2Button>
              <V2Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                  setNewPrompt("");
                }}
              >
                Cancel
              </V2Button>
            </div>
          </div>
        </div>
      ) : (
        <V2Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          + New Custom Prompt
        </V2Button>
      )}
    </div>
  );
}

function RecordingDefaults({ settings }: { settings: TutorialSettingsRow }) {
  const [hotkey, setHotkey] = useState(settings.record_hotkey ?? "Space");
  const [speed, setSpeed] = useState(
    Number(settings.default_playback_speed ?? 1),
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateTutorialSettingsAction({
        record_hotkey: hotkey,
        default_playback_speed: speed,
      });
      if (result.success) {
        toast.success("Recording defaults saved.");
      } else {
        toast.error(result.error ?? "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <V2Input
        label="Record Hotkey"
        placeholder="e.g. Space, r, F1"
        value={hotkey}
        onChange={(e) => setHotkey(e.target.value)}
        helperText="Key code to toggle audio play/pause in Studio (default: Space)"
        fullWidth
      />

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--v2-text-2)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 8,
          }}
        >
          Default Playback Speed — {speed.toFixed(1)}×
        </div>
        <input
          type="range"
          min="0.5"
          max="2.5"
          step="0.1"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{
            width: "100%",
            accentColor: "var(--v2-accent)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "var(--v2-text-2)",
            marginTop: 4,
          }}
        >
          <span>0.5×</span>
          <span>1.0×</span>
          <span>1.5×</span>
          <span>2.0×</span>
          <span>2.5×</span>
        </div>
      </div>

      <div>
        <V2Button variant="accent" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Defaults"}
        </V2Button>
      </div>
    </div>
  );
}

function DefaultVoiceSettings({ settings }: { settings: TutorialSettingsRow }) {
  const raw = (settings.default_voice_settings ?? {}) as Record<
    string,
    unknown
  >;
  const [model, setModel] = useState(String(raw.model ?? ""));
  const [speed, setSpeed] = useState<number | "">(
    typeof raw.speed === "number" ? raw.speed : "",
  );
  const [stability, setStability] = useState<number | "">(
    typeof raw.stability === "number" ? raw.stability : "",
  );
  const [similarity, setSimilarity] = useState<number | "">(
    typeof raw.similarity === "number" ? raw.similarity : "",
  );
  const [pitch, setPitch] = useState<number | "">(
    typeof raw.pitch === "number" ? raw.pitch : "",
  );
  const [volume, setVolume] = useState<number | "">(
    typeof raw.volume === "number" ? raw.volume : "",
  );
  const [language, setLanguage] = useState(String(raw.language ?? ""));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const vs: Record<string, unknown> = {};
    if (model.trim()) vs.model = model.trim();
    if (speed !== "") vs.speed = speed;
    if (stability !== "") vs.stability = stability;
    if (similarity !== "") vs.similarity = similarity;
    if (pitch !== "") vs.pitch = pitch;
    if (volume !== "") vs.volume = volume;
    if (language.trim()) vs.language = language.trim();

    try {
      const result = await updateTutorialSettingsAction({
        default_voice_settings: Object.keys(vs).length > 0 ? vs : undefined,
      });
      if (result.success) {
        toast.success("Default voice settings saved.");
      } else {
        toast.error(result.error ?? "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  }

  function SliderRow({
    label,
    min,
    max,
    step,
    value,
    onChange,
    hint,
  }: {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number | "";
    onChange: (v: number | "") => void;
    hint?: string;
  }) {
    const displayValue =
      value === "" ? "—" : (value as number).toFixed(step < 1 ? 2 : 0);
    return (
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
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
              style={{
                fontSize: 12,
                color: "var(--v2-text-1)",
                fontWeight: 600,
              }}
            >
              {displayValue}
            </span>
            {value !== "" && (
              <button
                onClick={() => onChange("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--v2-text-2)",
                  fontSize: 10,
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 11, color: "var(--v2-text-2)" }}>
        These apply to all new jobs. Job-level settings override these defaults.
      </div>
      <V2Input
        label="Default Model"
        placeholder="Leave blank for provider default"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        fullWidth
      />
      <SliderRow
        label="Speed"
        min={0.5}
        max={2.5}
        step={0.05}
        value={speed}
        onChange={setSpeed}
        hint="0.5–2.5; blank = provider default"
      />
      <SliderRow
        label="Stability (ElevenLabs)"
        min={0}
        max={1}
        step={0.05}
        value={stability}
        onChange={setStability}
        hint="0–1; blank = provider default"
      />
      <SliderRow
        label="Similarity (ElevenLabs)"
        min={0}
        max={1}
        step={0.05}
        value={similarity}
        onChange={setSimilarity}
        hint="0–1; blank = provider default"
      />
      <SliderRow
        label="Pitch (semitones)"
        min={-12}
        max={12}
        step={1}
        value={pitch}
        onChange={setPitch}
        hint="-12 to +12; blank = provider default"
      />
      <SliderRow
        label="Volume"
        min={0}
        max={2}
        step={0.05}
        value={volume}
        onChange={setVolume}
        hint="0–2; blank = provider default"
      />
      <V2Input
        label="Language / Boost (e.g. en, zh)"
        placeholder="Leave blank for auto-detect"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        fullWidth
      />
      <V2Button variant="accent" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Default Voice Settings"}
      </V2Button>
    </div>
  );
}

function SilenceCap({ settings }: { settings: TutorialSettingsRow }) {
  const [enabled, setEnabled] = useState<boolean>(
    settings.silence_cap_enabled ?? true,
  );
  const [maxMs, setMaxMs] = useState<number>(
    settings.silence_cap_max_ms ?? 250,
  );
  const [thresholdDb, setThresholdDb] = useState<number>(
    settings.silence_cap_threshold_db ?? -40,
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateTutorialSettingsAction({
        silence_cap_enabled: enabled,
        silence_cap_max_ms: maxMs,
        silence_cap_threshold_db: thresholdDb,
      });
      if (result.success) {
        toast.success("Silence cap settings saved.");
      } else {
        toast.error(result.error ?? "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "var(--v2-text-2)", lineHeight: 1.6 }}>
        After a video&apos;s narration is generated, any silent pause longer
        than the limit below is shortened — so the AI voice doesn&apos;t leave
        long dead-air gaps that sound like edits/cuts. Only silence is trimmed;
        spoken words are never touched. The video is automatically re-timed to
        match. Turn this off to keep the raw AI audio exactly as generated.
      </div>

      {/* Enable toggle */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: "var(--v2-accent)" }}
        />
        <span
          style={{ fontSize: 13, fontWeight: 600, color: "var(--v2-text-1)" }}
        >
          Enable silence cap{" "}
          <span style={{ color: "var(--v2-text-2)", fontWeight: 400 }}>
            (optional — off by default)
          </span>
        </span>
      </label>

      <div style={{ opacity: enabled ? 1 : 0.45 }}>
        {/* Max pause length */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Maximum pause length
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--v2-text-1)",
              }}
            >
              {maxMs} ms
            </span>
          </div>
          <input
            type="range"
            min={100}
            max={800}
            step={10}
            value={maxMs}
            disabled={!enabled}
            onChange={(e) => setMaxMs(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--v2-accent)" }}
          />
          <div
            style={{ fontSize: 11, color: "var(--v2-text-2)", marginTop: 4 }}
          >
            Any silence longer than this is shortened down to it. Lower =
            tighter, snappier delivery; higher = more breathing room.{" "}
            <strong>~250&nbsp;ms is natural</strong> — a real pause without dead
            air. (Pauses already shorter than this are left alone.)
          </div>
        </div>

        {/* Silence sensitivity / threshold */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Silence sensitivity
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--v2-text-1)",
              }}
            >
              {thresholdDb} dB
            </span>
          </div>
          <input
            type="range"
            min={-55}
            max={-25}
            step={1}
            value={thresholdDb}
            disabled={!enabled}
            onChange={(e) => setThresholdDb(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--v2-accent)" }}
          />
          <div
            style={{ fontSize: 11, color: "var(--v2-text-2)", marginTop: 4 }}
          >
            How quiet a moment must be to count as a pause. Toward{" "}
            <strong>−55&nbsp;dB</strong> only true dead air is trimmed (safest —
            never clips speech); toward <strong>−25&nbsp;dB</strong> also trims
            very quiet word tails (more aggressive, can sound clipped). Leave at{" "}
            <strong>−40&nbsp;dB</strong> if unsure.
          </div>
        </div>
      </div>

      <div>
        <V2Button variant="accent" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Silence Cap Settings"}
        </V2Button>
      </div>
    </div>
  );
}

interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  folderName: string | null;
  autouploadEnabled: boolean;
}

/**
 * Per-user "Connect your Google Drive" panel — visible to every user (incl.
 * VAs), unlike the admin-only settings below. Drives the OAuth connect flow and
 * shows the connected account + auto-upload toggle.
 */
function GoogleDriveConnect() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/production/drive/status");
      if (res.ok) setStatus((await res.json()) as DriveStatus);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void load();
    // Show the OAuth round-trip result, then strip it from the URL.
    const p = new URLSearchParams(window.location.search);
    const r = p.get("drive");
    if (r) {
      if (r === "connected") toast.success("Google Drive connected.");
      else if (r === "denied") toast.error("Drive connection was cancelled.");
      else if (r === "norefresh")
        toast.error(
          "Couldn't get offline access. Remove this app at myaccount.google.com/permissions, then reconnect.",
        );
      else if (r === "unconfigured")
        toast.error("Google Drive isn't configured on the server yet.");
      else toast.error("Drive connection failed — please try again.");
      p.delete("drive");
      p.delete("tab");
      const qs = p.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
  }, []);

  async function setAutoupload(enabled: boolean) {
    setBusy(true);
    try {
      await fetch("/api/production/drive/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect your Google Drive? Finished videos will stop uploading automatically.",
      )
    )
      return;
    setBusy(true);
    try {
      await fetch("/api/production/drive/disconnect", { method: "POST" });
      toast.success("Google Drive disconnected.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const muted = { fontSize: 12, color: "var(--v2-text-2)", lineHeight: 1.6 };

  if (!status) return <div style={muted}>Loading…</div>;

  if (!status.configured) {
    return (
      <div style={muted}>
        Automatic Google Drive upload isn&apos;t enabled on this server yet. An
        admin needs to add the Google OAuth credentials first — once that&apos;s
        done, a “Connect Google Drive” button appears here for everyone.
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={muted}>
          Connect your own Google Drive and your finished tutorial videos upload
          automatically into a “Tutorial Videos” folder in <em>your</em> Drive.
          We only ever get access to the files this app creates — never the rest
          of your Drive. One click, sign in with Google, approve.
        </div>
        <div>
          <a
            href="/api/production/drive/connect"
            style={{ textDecoration: "none" }}
          >
            <V2Button variant="accent">Connect Google Drive</V2Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={muted}>
        Connected as <strong>{status.email}</strong>. Finished videos upload to
        your “<strong>{status.folderName}</strong>” folder in Google Drive.
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={status.autouploadEnabled}
          disabled={busy}
          onChange={(e) => setAutoupload(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: "var(--v2-accent)" }}
        />
        <span style={{ fontSize: 13, color: "var(--v2-text-1)" }}>
          Automatically upload finished videos to my Drive
        </span>
      </label>
      <div>
        <V2Button
          variant="outline"
          size="sm"
          onClick={disconnect}
          disabled={busy}
        >
          Disconnect
        </V2Button>
      </div>
    </div>
  );
}

export function ProductionSettings({
  presets,
  keyMasks,
  providers,
  settings,
  canManage,
}: SettingsProps) {
  // One row per unique secret slot (capability + secretProvider). Several
  // provider ids share a slot (e.g. ai33_elevenlabs + ai33_minimax -> "ai33"),
  // so dedupe to avoid duplicate React keys and confusing repeated rows.
  const allProviders = [
    ...providers.llm
      .filter((p) => p.secretProvider)
      .map((p) => ({
        capability: "LLM" as const,
        secretProvider: p.secretProvider as string,
        label: p.label,
      })),
    ...providers.tts
      .filter((p) => p.secretProvider)
      .map((p) => ({
        capability: "TTS" as const,
        secretProvider: p.secretProvider as string,
        label: p.label,
      })),
  ].filter(
    (p, i, arr) =>
      arr.findIndex(
        (q) =>
          q.capability === p.capability &&
          q.secretProvider === p.secretProvider,
      ) === i,
  );

  function getMask(capability: string, secretProvider: string | null) {
    if (!secretProvider) return undefined;
    return keyMasks.find(
      (m) => m.capability === capability && m.provider === secretProvider,
    )?.last4;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Google Drive — per-user connect, visible to EVERYONE (incl. VAs). */}
      <GlassCard style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--v2-text-1)",
            marginBottom: 4,
          }}
        >
          Google Drive (Auto-Upload)
        </div>
        <div
          style={{ fontSize: 11, color: "var(--v2-text-2)", marginBottom: 16 }}
        >
          Connect your own Google Drive to have your finished tutorial videos
          uploaded there automatically.
        </div>
        <GoogleDriveConnect />
      </GlassCard>

      {!canManage && (
        <GlassCard style={{ padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
            The other tutorial settings are managed by your Admin or Manager.
          </p>
        </GlassCard>
      )}

      {canManage && (
        <>
          {/* Provider Keys */}
          <GlassCard style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--v2-text-1)",
                marginBottom: 16,
              }}
            >
              Provider API Keys
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--v2-text-2)",
                marginBottom: 16,
              }}
            >
              The secret keys used to call each AI provider. A provider with no
              key shows as “no API key” in the Create form and can&apos;t be
              used. Keys are stored encrypted; only the last 4 characters are
              ever shown back.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {allProviders.map((p) => (
                <ProviderKeyField
                  key={`${p.capability}-${p.secretProvider}`}
                  capability={p.capability}
                  provider={p.secretProvider!}
                  label={`${p.label} (${p.capability})`}
                  last4={getMask(p.capability, p.secretProvider)}
                />
              ))}
            </div>
          </GlassCard>

          {/* Prompt Library */}
          <GlassCard style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--v2-text-1)",
                marginBottom: 16,
              }}
            >
              Prompt Library
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--v2-text-2)",
                marginBottom: 16,
              }}
            >
              The instructions that tell the AI how to write each script.
              Default presets are read-only; add your own for different styles.
              The Create form rotates through the default presets so consecutive
              videos don&apos;t open identically.
            </div>
            <PromptLibrary presets={presets} />
          </GlassCard>

          {/* Recording Defaults */}
          <GlassCard style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--v2-text-1)",
                marginBottom: 16,
              }}
            >
              Recording Defaults
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--v2-text-2)",
                marginBottom: 16,
              }}
            >
              Defaults for the Studio recording step: the key that plays/pauses
              the audio while the VA records, and the starting playback speed.
              These are just defaults — each job can still be adjusted before
              recording.
            </div>
            <RecordingDefaults settings={settings} />
          </GlassCard>

          {/* Default Voice Settings */}
          <GlassCard style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--v2-text-1)",
                marginBottom: 16,
              }}
            >
              Default Voice Settings
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--v2-text-2)",
                marginBottom: 16,
              }}
            >
              The default voice tuning applied to every new job (model, speed,
              stability, etc.). Leave a field blank to use the provider&apos;s
              own default. Anything set per-job in the Create form overrides
              these.
            </div>
            <DefaultVoiceSettings settings={settings} />
          </GlassCard>

          {/* Silence Cap */}
          <GlassCard style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--v2-text-1)",
                marginBottom: 4,
              }}
            >
              Silence Cap (Audio Cleanup)
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--v2-text-2)",
                marginBottom: 16,
              }}
            >
              Removes the dead-air pauses the AI voice leaves between sentences
              — without cutting any words.
            </div>
            <SilenceCap settings={settings} />
          </GlassCard>

          {/* ── Voice Cloning — Coming Soon ── */}
          <GlassCard style={{ padding: 24, opacity: 0.7 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--v2-text-1)",
                }}
              >
                Voice Cloning (AI33)
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
            <div
              style={{
                fontSize: 12,
                color: "var(--v2-text-2)",
                lineHeight: 1.6,
                marginBottom: 16,
              }}
            >
              Upload a 1–5 min voice sample to create a custom cloned voice
              (AI33 Minimax /v1m/voice/clone) and select it like any other
              voice.
            </div>
            <button
              disabled
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "var(--v2-text-2)",
                cursor: "not-allowed",
                opacity: 0.6,
              }}
            >
              Upload voice sample
            </button>
          </GlassCard>
        </>
      )}
    </div>
  );
}
