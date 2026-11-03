import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// One video of a whole run: the live frames of the page the live view follows, fed to Playwright's
// own ffmpeg the way Playwright feeds its per-attempt videos: JPEG frames with their times in a
// small Matroska stream in, a WebM out. Each frame carries its time, so pauses and still pages keep
// their real length. Playwright's ffmpeg is built with only what Playwright needs, and that
// changed between releases (VP8 before, VP9 since), so the encoder is whichever one it has.

export const RUN_VIDEO_FPS = 10;
/** Target bit rate: a run video is a record to skim, so it takes less than an attempt's video. */
const BIT_RATE = "600k";

/** Where Playwright keeps its browsers (and ffmpeg) on this machine. */
export function browsersPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  const given = env.PLAYWRIGHT_BROWSERS_PATH;
  if (given && given !== "0") return given;
  if (platform === "win32") return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ms-playwright");
  if (platform === "darwin") return path.join(home, "Library", "Caches", "ms-playwright");
  return path.join(env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "ms-playwright");
}

const BINARIES = ["ffmpeg-win64.exe", "ffmpeg-mac", "ffmpeg-linux"];

/** Playwright's ffmpeg (the newest one installed), WATCHWRIGHT_FFMPEG when set, else null. */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env, root = browsersPath(env)): string | null {
  if (env.WATCHWRIGHT_FFMPEG) return existsSync(env.WATCHWRIGHT_FFMPEG) ? env.WATCHWRIGHT_FFMPEG : null;
  let dirs: string[];
  try {
    dirs = readdirSync(root).filter((d) => /^ffmpeg-\d+$/.test(d));
  } catch {
    return null;
  }
  dirs.sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)));
  for (const d of dirs) {
    for (const b of BINARIES) {
      const file = path.join(root, d, b);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

/** The WebM encoder this ffmpeg has: VP9 (newer Playwright builds) or VP8 (older), else null. */
export type VideoEncoder = "libvpx-vp9" | "libvpx";
const encoders = new Map<string, VideoEncoder | null>();
export function videoEncoder(ffmpeg: string): VideoEncoder | null {
  let found = encoders.get(ffmpeg);
  if (found !== undefined) return found;
  const out = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const list = `${out.stdout ?? ""}`;
  found = /\slibvpx-vp9\s/.test(list) ? "libvpx-vp9" : /\slibvpx\s/.test(list) ? "libvpx" : null;
  encoders.set(ffmpeg, found);
  return found;
}

/**
 * How much room videos take (the `runs.videoQuality` setting). `full` is what Playwright records
 * (a bit rate that keeps the picture whatever happens); `compact` keeps the size and frame rate at
 * a constant quality, which spends bits only when the page changes (about 80% smaller on real
 * runs); `small` also takes 3/4 of the size and 10 frames a second (about 94% smaller). See
 * docs/research/video-size.md.
 */
export type VideoQuality = "full" | "compact" | "small";
export const VIDEO_QUALITIES: readonly VideoQuality[] = ["full", "compact", "small"];
/** The CRF (lower is sharper) and the share of the size each quality below `full` keeps. */
const QUALITY: Record<Exclude<VideoQuality, "full">, { crf: number; scale: number; fps: number | null }> = {
  compact: { crf: 40, scale: 1, fps: null },
  small: { crf: 42, scale: 0.75, fps: 10 },
};
/** Frames a second an attempt video of `quality` is written at (`fallback` keeps the recorder's own). */
export function qualityFps(quality: VideoQuality, fallback: number): number {
  return quality === "full" ? fallback : (QUALITY[quality].fps ?? fallback);
}

/** How much smaller a quality is than another: higher is smaller. */
const RANK: Record<VideoQuality, number> = { full: 0, compact: 1, small: 2 };
export function smallerThan(a: VideoQuality, b: VideoQuality): boolean {
  return RANK[a] > RANK[b];
}

/** The title every video Watchwright writes carries, so a later pass knows its quality. */
export const videoTitle = (quality: VideoQuality) => `watchwright-video:${quality}`;

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** The encoder arguments for `quality`: a bit rate for `full`, a constant quality otherwise. */
export function encodeArgs(encoder: VideoEncoder, quality: VideoQuality, bitRate = BIT_RATE): string[] {
  const speed = encoder === "libvpx-vp9" ? ["-cpu-used", "8", "-lag-in-frames", "0", "-row-mt", "1"] : ["-speed", "8"];
  const rate = quality === "full" ? ["-qmax", "50", "-crf", "10", "-b:v", bitRate] : ["-qmax", "63", "-crf", String(QUALITY[quality].crf), "-b:v", "0"];
  return ["-c:v", encoder, "-qmin", "0", ...rate, "-deadline", "realtime", ...speed, "-threads", "1", "-metadata", `title=${videoTitle(quality)}`];
}

/** The scale filter for `quality` on a `width`×`height` picture, or null when it keeps the size. */
export function scaleFilter(quality: VideoQuality, width: number, height: number): string | null {
  if (quality === "full" || QUALITY[quality].scale === 1) return null;
  const s = QUALITY[quality].scale;
  return `scale=${even(width * s)}:${even(height * s)}`;
}

/** The ffmpeg arguments for a run video of `width`×`height` (even numbers). Frames of another size are cropped or padded to it. */
export function ffmpegArgs(file: string, width: number, height: number, encoder: VideoEncoder, bitRate = BIT_RATE, quality: VideoQuality = "full"): string[] {
  // Crop a bigger frame and pad a smaller one, both centered; then scale for the smaller qualities.
  const fit = `crop=w=min(iw\\,${width}):h=min(ih\\,${height}),pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  const scale = scaleFilter(quality, width, height);
  return [
    "-loglevel", "error",
    "-f", "matroska", "-fpsprobesize", "0", "-probesize", "32", "-analyzeduration", "0", "-i", "pipe:0",
    // Each frame keeps its own time: a still page is one frame however long it stays.
    "-y", "-an", "-fps_mode", "vfr",
    ...encodeArgs(encoder, quality, bitRate),
    "-vf", scale ? `${fit},${scale}` : fit,
    file,
  ];
}

// The Matroska stream: a header with one MJPEG video track, then one cluster per frame whose
// timestamp is in milliseconds. Element ids are Matroska's (matroska.org, EBML).
const ID = (hex: string) => Buffer.from(hex, "hex");

/** An EBML variable-size integer. */
function vint(n: number): Buffer {
  let length = 1;
  while (n >= 2 ** (7 * length) - 1) length++;
  const b = Buffer.alloc(length);
  for (let i = length - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 255;
  b[0]! |= 1 << (8 - length);
  return b;
}
function uint(n: number): Buffer {
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 255);
  return Buffer.from(bytes.length ? bytes : [0]);
}
const el = (id: string, payload: Buffer) => Buffer.concat([ID(id), vint(payload.length), payload]);

export function matroskaHeader(): Buffer {
  const ebml = el("1A45DFA3", Buffer.concat([el("4286", uint(1)), el("42F7", uint(1)), el("42F2", uint(4)), el("42F3", uint(8)), el("4282", Buffer.from("matroska")), el("4287", uint(4)), el("4285", uint(2))]));
  // Timestamps in milliseconds (1,000,000 ns a tick).
  const info = el("1549A966", Buffer.concat([el("2AD7B1", uint(1e6)), el("4D80", Buffer.from("watchwright")), el("5741", Buffer.from("watchwright"))]));
  // The MJPEG decoder reads each frame's real size, so the track says 1×1.
  const track = el("AE", Buffer.concat([el("D7", uint(1)), el("73C5", uint(1)), el("83", uint(1)), el("9C", uint(0)), el("86", Buffer.from("V_MJPEG")), el("E0", Buffer.concat([el("B0", uint(1)), el("BA", uint(1))]))]));
  // The segment's size is unknown: the stream ends when the pipe closes.
  return Buffer.concat([ebml, ID("18538067"), Buffer.from([1, 255, 255, 255, 255, 255, 255, 255]), info, el("1654AE6B", track)]);
}

/** The bytes before a frame: a cluster at `ms` holding one key-frame block of `length` bytes on track 1. */
export function matroskaFrame(ms: number, length: number): Buffer {
  const block = Buffer.concat([ID("A3"), vint(4 + length), vint(1), Buffer.from([0, 0]), Buffer.from([128])]);
  const time = el("E7", uint(ms));
  return Buffer.concat([ID("1F43B675"), vint(time.length + block.length + length), time, block]);
}

/** The next free run video file in a run's folder: `run-video.webm`, then `run-video-2.webm`, … */
export function nextRunVideoFile(runDir: string): string {
  for (let n = 1; ; n++) {
    const file = path.join(runDir, n === 1 ? "run-video.webm" : `run-video-${n}.webm`);
    if (!existsSync(file)) return file;
  }
}

/** A run's videos, in order. */
export function runVideoFiles(runDir: string): { name: string; size: number }[] {
  let names: string[];
  try {
    names = readdirSync(runDir).filter((n) => /^run-video(-\d+)?\.webm$/.test(n));
  } catch {
    return [];
  }
  const part = (n: string) => Number(/-(\d+)\.webm$/.exec(n)?.[1] ?? 1);
  return names.sort((a, b) => part(a) - part(b)).map((name) => ({ name, size: statSync(path.join(runDir, name)).size }));
}

export interface RunVideoOptions {
  file: string;
  ffmpeg: string;
  /** The newest frame to write (JPEG), or null when there is none yet. */
  frame: () => { data: Buffer; width: number; height: number } | null;
  /** Said once, when the video can't be written; the run goes on without it. */
  onError: (message: string) => void;
  fps?: number;
  /** ffmpeg's target bit rate at `full` quality (default 600k). */
  bitRate?: string;
  /** How much room the video may take (default `full`). */
  quality?: VideoQuality;
}

export class RunVideo {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The frame written last, and when (ms since the first one). */
  private last: Buffer | null = null;
  private lastMs = 0;
  private startedAt = 0;
  private busy = false;
  private failed = false;
  private exited: Promise<void> = Promise.resolve();
  private stderr = "";

  constructor(private readonly o: RunVideoOptions) {}

  /** Looks for a new frame FPS times a second; a frame that didn't change isn't written again. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / (this.o.fps ?? RUN_VIDEO_FPS));
  }

  private tick(): void {
    if (this.failed) return;
    const f = this.o.frame();
    if (!f || f.data === this.last) return;
    if (!this.proc) {
      this.spawn(f.width, f.height);
      if (!this.proc) return;
      this.startedAt = performance.now();
    }
    // A slow disk or a busy machine: skip frames rather than queue them up.
    if (this.busy) return;
    this.write(f.data, Math.round(performance.now() - this.startedAt));
  }

  private write(data: Buffer, ms: number): void {
    if (!this.proc) return;
    this.last = data;
    this.lastMs = ms;
    this.proc.stdin.write(matroskaFrame(ms, data.length));
    if (!this.proc.stdin.write(data)) {
      this.busy = true;
      this.proc.stdin.once("drain", () => (this.busy = false));
    }
  }

  private spawn(width: number, height: number): void {
    try {
      const encoder = videoEncoder(this.o.ffmpeg);
      if (!encoder) return this.fail(`${this.o.ffmpeg} has no VP8 or VP9 encoder`);
      const proc = spawn(this.o.ffmpeg, ffmpegArgs(this.o.file, even(width), even(height), encoder, this.o.bitRate, this.o.quality), { stdio: "pipe", windowsHide: true });
      proc.stderr.on("data", (d: Buffer) => (this.stderr = (this.stderr + d.toString()).slice(-2000)));
      proc.stdin.on("error", () => undefined);
      this.exited = new Promise((resolve) => {
        proc.on("error", (err) => {
          this.fail(err.message);
          resolve();
        });
        proc.on("exit", (code) => {
          if (code !== 0 && code !== null) this.fail(this.stderr.trim().split("\n").at(-1) || `ffmpeg exited with code ${code}`);
          resolve();
        });
      });
      proc.stdin.write(matroskaHeader());
      this.proc = proc;
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.o.onError(message);
  }

  /** Ends the video: the frames written so far are kept, the last one until now. True when a file was written. */
  async stop(): Promise<boolean> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // The last frame again at the end, so a still page before the stop keeps its length, and once
    // more a frame later, which gives that last frame a known length.
    if (this.last && !this.failed) {
      const end = Math.max(this.lastMs + 1, Math.round(performance.now() - this.startedAt));
      this.write(this.last, end);
      this.write(this.last, end + Math.round(1000 / (this.o.fps ?? RUN_VIDEO_FPS)));
    }
    const proc = this.proc;
    this.proc = null;
    if (!proc) return false;
    proc.stdin.end();
    const killer = setTimeout(() => proc.kill(), 10_000);
    await this.exited;
    clearTimeout(killer);
    return existsSync(this.o.file) && statSync(this.o.file).size > 0;
  }
}
