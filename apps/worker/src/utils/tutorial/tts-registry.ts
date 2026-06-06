import { createTTSProvider, type TTSProvider } from "../tts-provider.js";
import type { VoiceSettings } from "@repo/contracts";

class GoogleTTSProvider implements TTSProvider {
  name = "google_tts";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const langCode = voiceId.split("-").slice(0, 2).join("-") || "en-US";
    const audioConfig: Record<string, unknown> = { audioEncoding: "MP3" };
    if (this.settings.speed !== undefined)
      audioConfig.speakingRate = this.settings.speed;
    if (this.settings.pitch !== undefined)
      audioConfig.pitch = this.settings.pitch;
    if (this.settings.volume !== undefined) {
      // Map 0–2 range: volume=1 → 0dB, volume<1 → up to -20dB, volume>1 → up to +6dB
      audioConfig.volumeGainDb =
        this.settings.volume <= 1
          ? (this.settings.volume - 1) * 20
          : (this.settings.volume - 1) * 6;
    }
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: langCode, name: voiceId },
          audioConfig,
        }),
      },
    );
    if (!res.ok)
      throw new Error(`Google TTS error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { audioContent: string };
    return Buffer.from(json.audioContent, "base64");
  }
}

class ElevenLabsOfficialProvider implements TTSProvider {
  name = "elevenlabs_official";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const body: Record<string, unknown> = {
      text,
      model_id: this.settings.model ?? "eleven_multilingual_v2",
    };
    const voiceSettings: Record<string, unknown> = {};
    if (this.settings.stability !== undefined)
      voiceSettings.stability = this.settings.stability;
    if (this.settings.similarity !== undefined)
      voiceSettings.similarity_boost = this.settings.similarity;
    if (Object.keys(voiceSettings).length > 0)
      body.voice_settings = voiceSettings;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok)
      throw new Error(`ElevenLabs error ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

class TutorialElevenLabsAI33Provider implements TTSProvider {
  name = "ai33_elevenlabs_tutorial";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const { generateElevenLabsTTS } = await import("../elevenlabs-client.js");
    // Map VoiceSettings → ElevenLabsTTSSettings
    // stability/similarity 0–1 → similarity param 0–4 (scale by 4)
    const rawSim = this.settings.similarity ?? this.settings.stability;
    return generateElevenLabsTTS(this.apiKey, voiceId, text, {
      speed:
        this.settings.speed !== undefined
          ? Math.min(1.5, Math.max(0.5, this.settings.speed))
          : undefined,
      similarity: rawSim !== undefined ? rawSim * 4 : undefined,
    });
  }
}

export function createTutorialTTSProvider(
  providerId: string,
  apiKey: string,
  options?: { voice?: string; settings?: VoiceSettings },
): TTSProvider {
  const settings = options?.settings ?? {};
  switch (providerId) {
    case "ai33_elevenlabs":
    case "ai33_v3":
      // ai33_v3 is the generic AI33 V3 client: ElevenLabs, Minimax, Kokoro and
      // Edge are all reachable through /v3/text-to-speech, selected by the
      // voice_id prefix (elevenlabs_/minimax_/kokoro_/edge_). The client omits
      // similarity for the text-only backends. Used by the outage fallback
      // chain. (Distinct from "ai33_minimax" below, which is the older /v1m/
      // Minimax endpoint kept for the existing selectable provider.)
      return new TutorialElevenLabsAI33Provider(apiKey, settings);
    case "ai33_minimax":
      return createTTSProvider(apiKey, "Minimax", {
        model: settings.model,
        speed: settings.speed,
        pitch: settings.pitch,
        volume: settings.volume,
        languageBoost: settings.language,
      });
    case "google_tts":
      return new GoogleTTSProvider(apiKey, settings);
    case "elevenlabs_official":
      return new ElevenLabsOfficialProvider(apiKey, settings);
    case "minimax_official":
      return createTTSProvider(apiKey, "Minimax", {
        model: settings.model,
        speed: settings.speed,
        pitch: settings.pitch,
        volume: settings.volume,
        languageBoost: settings.language,
      });
    case "qwen3_local":
      throw new Error("qwen3_local is coming soon");
    default:
      throw new Error(`Unknown TTS provider: ${providerId}`);
  }
}
