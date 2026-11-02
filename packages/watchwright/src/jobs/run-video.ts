import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// One video of a whole run: the newest live frame of the page the live view follows, written
// FPS times a second into Playwright's own ffmpeg (JPEG frames in, a VP8 WebM out, the encoder
// Playwright uses for its per-attempt videos). Writing the newest frame on a timer, not each
// frame as it comes, keeps pauses and still pages at their real length.

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

/** The ffmpeg arguments for a run video of `width`×`height` (even numbers). Frames of another size are cropped or padded to it. */
export function ffmpegArgs(file: string, width: number, height: number, fps = RUN_VIDEO_FPS): string[] {
  // Crop a bigger frame and pad a smaller one, both centered: Playwright's ffmpeg is built with
  // only the filters its own videos use (crop and pad, no scale).
  const fit = `crop=w=min(iw\\,${width}):h=min(ih\\,${height}),pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  return [
    "-loglevel", "error",
    "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "pipe:0",
    "-vf", fit,
    "-c:v", "vp8", "-qmin", "0", "-qmax", "50", "-crf", "10", "-b:v", BIT_RATE, "-deadline", "realtime", "-speed", "8", "-threads", "1",
    "-y", "-an", file,
  ];
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
}

export class RunVideo {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: Buffer | null = null;
  private busy = false;
  private failed = false;
  private exited: Promise<void> = Promise.resolve();
  private stderr = "";

  constructor(private readonly o: RunVideoOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / (this.o.fps ?? RUN_VIDEO_FPS));
  }

  private tick(): void {
    if (this.failed) return;
    const f = this.o.frame();
    if (f) this.last = f.data;
    if (!this.last) return;
    if (!this.proc) {
      if (!f) return;
      this.spawn(f.width, f.height);
      if (!this.proc) return;
    }
    // A slow disk or a busy machine: drop frames rather than queue them up.
    if (this.busy) return;
    if (!this.proc.stdin.write(this.last)) {
      this.busy = true;
      this.proc.stdin.once("drain", () => (this.busy = false));
    }
  }

  private spawn(width: number, height: number): void {
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
    try {
      const proc = spawn(this.o.ffmpeg, ffmpegArgs(this.o.file, even(width), even(height), this.o.fps), { stdio: "pipe", windowsHide: true });
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

  /** Ends the video: the frames written so far are kept. True when a file was written. */
  async stop(): Promise<boolean> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
