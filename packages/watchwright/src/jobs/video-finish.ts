import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodeArgs, findFfmpeg, fitFilter, qualityFps, videoEncoder, videoTitle, type VideoEncoder, type VideoQuality } from "./run-video.js";

// Turning an attempt's capture (see video-capture.ts) into its WebM, after the attempt. On the
// graphics card when a full ffmpeg on the machine can use one (AV1, which a WebM holds), else on the
// CPU with Playwright's ffmpeg (VP9, or VP8 on old builds). See docs/research/smooth-videos.md.

/** The hardware AV1 encoders tried, in order: NVIDIA (RTX 40 and up), Intel (Arc, Core Ultra), AMD (RX 7000 and up). */
export const HARDWARE_CODECS = ["av1_nvenc", "av1_qsv", "av1_amf"] as const;
export type HardwareCodec = (typeof HARDWARE_CODECS)[number];

/** Who finishes videos: the `runs.videoEncoder` setting. `auto` uses the graphics card when it can. */
export type EncoderMode = "auto" | "cpu";
export const ENCODER_MODES: readonly EncoderMode[] = ["auto", "cpu"];

export type Finisher = { kind: "cpu"; ffmpeg: string; codec: VideoEncoder } | { kind: "gpu"; ffmpeg: string; codec: HardwareCodec };

const VENDOR: Record<HardwareCodec, string> = { av1_nvenc: "NVIDIA", av1_qsv: "Intel", av1_amf: "AMD" };

/** How the Videos section names a finisher: "Graphics card (NVIDIA, AV1)", "CPU (VP9)". */
export function finisherLabel(f: Finisher | null): string {
  if (!f) return "None (no ffmpeg)";
  if (f.kind === "gpu") return `Graphics card (${VENDOR[f.codec]}, AV1)`;
  return `CPU (${f.codec === "libvpx-vp9" ? "VP9" : "VP8"})`;
}

/**
 * The constant-quality level each quality gets on the graphics card, on the encoders' 0–51 scale
 * (lower is sharper). They follow the VP9 CRFs: High sharp, Small soft.
 */
export const GPU_LEVEL: Record<VideoQuality, number> = { high: 26, full: 30, compact: 36, small: 40 };

/** The encoder arguments for a hardware codec at `quality`. */
export function gpuArgs(codec: HardwareCodec, quality: VideoQuality): string[] {
  const level = GPU_LEVEL[quality];
  const title = ["-metadata", `title=${videoTitle(quality)}`];
  if (codec === "av1_nvenc") return ["-c:v", codec, "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", String(level), "-b:v", "0", "-pix_fmt", "yuv420p", ...title];
  if (codec === "av1_qsv") return ["-c:v", codec, "-preset", "medium", "-global_quality", String(level), "-pix_fmt", "nv12", ...title];
  // AMF's AV1 levels go to 255.
  const qp = String(Math.round((level / 51) * 255));
  return ["-c:v", codec, "-usage", "transcoding", "-quality", "quality", "-rc", "cqp", "-qp_i", qp, "-qp_p", qp, "-pix_fmt", "nv12", ...title];
}

/** CPU threads a CPU finish takes: half the cores (it runs at the lowest priority, so a test still comes first). */
export function finishThreads(cores = os.availableParallelism?.() ?? os.cpus().length): number {
  return Math.max(1, Math.min(8, Math.floor(cores / 2)));
}

/** The bit rate a `full` video gets on the CPU, as attempt videos always had. */
const FULL_BIT_RATE = "1M";

/** The ffmpeg arguments that finish `capture` into `output` (a WebM of `width`×`height`) at `quality`. */
export function finishArgs(capture: string, output: string, width: number, height: number, quality: VideoQuality, f: Finisher, threads = finishThreads()): string[] {
  const fps = qualityFps(quality, 0);
  // Frames keep their real times; Small takes 10 a second (ffmpeg won't take both at once).
  const timing = quality === "small" && fps > 0 ? ["-r", String(fps)] : ["-fps_mode", "vfr"];
  const codec = f.kind === "gpu" ? gpuArgs(f.codec, quality) : encodeArgs(f.codec, quality, FULL_BIT_RATE, { threads, cpuUsed: 6 });
  return ["-loglevel", "error", "-y", "-f", "matroska", "-i", capture, "-an", ...timing, "-vf", fitFilter(quality, width, height), ...codec, "-f", "webm", output];
}

/** `ffmpeg` on the PATH, if there is one. */
export function ffmpegOnPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const name = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Runs ffmpeg with `args`; resolves with its exit code and the end of what it said. */
export function runFfmpeg(ffmpeg: string, args: string[], o: { timeoutMs?: number; lowPriority?: boolean; signal?: AbortSignal } = {}): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    let proc;
    try {
      proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stderr: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (o.lowPriority && proc.pid !== undefined) {
      try {
        os.setPriority(proc.pid, os.constants.priority.PRIORITY_LOW);
      } catch {
        // Not allowed here: it runs at the normal priority.
      }
    }
    const kill = () => proc.kill();
    const timer = o.timeoutMs ? setTimeout(kill, o.timeoutMs) : null;
    o.signal?.addEventListener("abort", kill, { once: true });
    proc.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    const done = (code: number | null) => {
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener("abort", kill);
      resolve({ code, stderr: stderr.trim() });
    };
    proc.on("error", (err) => {
      stderr += err.message;
      done(-1);
    });
    proc.on("exit", (code) => done(code));
  });
}

/** The hardware AV1 encoders an ffmpeg was built with (not yet whether the machine has the card). */
export async function hardwareCodecs(ffmpeg: string): Promise<HardwareCodec[]> {
  const list = await new Promise<string>((resolve) => {
    let out = "";
    try {
      const p = spawn(ffmpeg, ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      p.stdout.on("data", (d: Buffer) => (out += d.toString()));
      p.on("error", () => resolve(""));
      p.on("exit", () => resolve(out));
    } catch {
      resolve("");
    }
  });
  return HARDWARE_CODECS.filter((c) => new RegExp(`\\s${c}\\s`).test(list));
}

/** Encodes a tiny clip with `codec` at the settings real videos use: true when the card is there and takes them. */
export async function probeHardware(ffmpeg: string, codec: HardwareCodec): Promise<boolean> {
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x240:r=30:d=0.3", "-an", ...gpuArgs(codec, "full"), "-f", "null", "-"];
  const r = await runFfmpeg(ffmpeg, args, { timeoutMs: 20_000 });
  return r.code === 0;
}

export interface FinisherChoice {
  finisher: Finisher | null;
  /** Why the graphics card isn't used, when it isn't (shown in the Videos section). */
  note: string | null;
}

/**
 * Who finishes videos. With `auto`: the first hardware AV1 encoder that encodes a test clip, in a
 * full ffmpeg (`WATCHWRIGHT_FFMPEG`, else `ffmpeg` on the PATH); else Playwright's ffmpeg on the CPU.
 */
export async function chooseFinisher(
  mode: EncoderMode,
  o: { env?: NodeJS.ProcessEnv; cpu?: () => string | null; system?: () => string | null; codecs?: typeof hardwareCodecs; probe?: typeof probeHardware; encoder?: (ffmpeg: string) => VideoEncoder | null } = {},
): Promise<FinisherChoice> {
  const env = o.env ?? process.env;
  const cpuFfmpeg = (o.cpu ?? (() => findFfmpeg(env)))();
  const encoder = cpuFfmpeg ? (o.encoder ?? videoEncoder)(cpuFfmpeg) : null;
  const cpu: Finisher | null = cpuFfmpeg && encoder ? { kind: "cpu", ffmpeg: cpuFfmpeg, codec: encoder } : null;
  if (mode === "cpu") return { finisher: cpu, note: null };
  const systems = [...new Set([env.WATCHWRIGHT_FFMPEG && existsSync(env.WATCHWRIGHT_FFMPEG) ? env.WATCHWRIGHT_FFMPEG : null, (o.system ?? (() => ffmpegOnPath(env)))()].filter((f): f is string => !!f))];
  if (systems.length === 0) return { finisher: cpu, note: "Install ffmpeg (winget install ffmpeg, brew install ffmpeg or apt install ffmpeg) and restart Watchwright to finish videos on the graphics card." };
  const tried: string[] = [];
  for (const ffmpeg of systems) {
    for (const codec of await (o.codecs ?? hardwareCodecs)(ffmpeg)) {
      if (await (o.probe ?? probeHardware)(ffmpeg, codec)) return { finisher: { kind: "gpu", ffmpeg, codec }, note: null };
      tried.push(codec);
    }
  }
  return {
    finisher: cpu,
    note: tried.length
      ? `The graphics card didn't take a test clip (${[...new Set(tried)].join(", ")}): it may be too old for AV1, or its driver is missing.`
      : "The ffmpeg found has no hardware AV1 encoder (av1_nvenc, av1_qsv or av1_amf). A full build, such as winget install ffmpeg, has them.",
  };
}

/** Whether a WebM holds AV1 (Playwright's ffmpeg can't read those, so Compress leaves them alone). */
export async function isAv1Video(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes("V_AV1");
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}
