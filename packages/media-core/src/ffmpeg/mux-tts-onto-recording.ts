import { spawn } from "node:child_process";

const FFMPEG_BIN = process.env["FFMPEG_PATH"] ?? "ffmpeg";

export interface MuxArgsParams {
  recordingPath: string;
  ttsAudioPath: string;
  outputPath: string;
  /** video time-scale factor = audioDurationSeconds / recordingDurationSeconds */
  factor: number;
  videoCodec: "h264_nvenc" | "libx264";
}

export function buildMuxArgs(p: MuxArgsParams): string[] {
  // setpts=<factor>*PTS rescales the VIDEO so its new duration ~= the 1x audio duration.
  // factor>1 lengthens (slows) the video; factor<1 shortens (speeds) it.
  return [
    // Keep stderr minimal — long encodes otherwise spew per-frame progress.
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    p.recordingPath,
    "-i",
    p.ttsAudioPath,
    "-filter:v",
    `setpts=${p.factor}*PTS`,
    "-map",
    "0:v", // video from the recording
    "-map",
    "1:a", // clean 1x TTS audio; original/mic audio dropped
    "-c:v",
    p.videoCodec,
    "-preset",
    "fast",
    "-crf",
    "20",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    "-y",
    p.outputPath,
  ];
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFmpeg mux failed (code ${code}):\n${stderr.slice(-2000)}`,
          ),
        );
    });
  });
}

export interface MuxTtsParams {
  recordingPath: string;
  ttsAudioPath: string;
  outputPath: string;
  factor: number;
}

/** Tries NVENC, falls back to libx264 — same strategy as ffmpegAudioMux. */
export async function muxTtsOntoRecording(p: MuxTtsParams): Promise<void> {
  try {
    await runFfmpeg(buildMuxArgs({ ...p, videoCodec: "h264_nvenc" }));
  } catch (err) {
    console.warn(
      `[mux-tts] NVENC failed, falling back to libx264: ${(err as Error).message}`,
    );
    await runFfmpeg(buildMuxArgs({ ...p, videoCodec: "libx264" }));
  }
}
