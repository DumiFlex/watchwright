import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { encodeArgs, smallerThan, VIDEO_QUALITIES, type CompressQuality, type VideoEncoder, type VideoQuality } from "./run-video.js";

// Videos runs already kept, encoded again at a smaller quality with Playwright's own ffmpeg (it
// decodes the WebM it wrote and has the scale filter). A video is replaced only when the new file
// is smaller. See docs/research/video-size.md.

/** The ending of a file being written; a stale one (the server stopped mid-way) is removed. */
const PART = ".compressing.webm";

/**
 * Renames `from` over `to`, trying again for a while when Windows refuses it (EPERM, EBUSY,
 * EACCES): it does while anything has `to` open, such as a report reading its quality or the
 * web page playing it. Other systems rename over open files, so they succeed the first time.
 */
export async function replaceFile(from: string, to: string, o: { tries?: number; waitMs?: number; rename?: (a: string, b: string) => Promise<void> } = {}): Promise<void> {
  const tries = o.tries ?? 20;
  const move = o.rename ?? rename;
  for (let i = 1; ; i++) {
    try {
      return await move(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= tries || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, (o.waitMs ?? 100) * Math.min(i, 5)));
    }
  }
}

/**
 * The quality a video was written at: Watchwright writes it in the file's title, near the start.
 * A video without one was written by Playwright, which is `full`.
 */
export async function videoQualityOf(file: string): Promise<VideoQuality> {
  let handle;
  try {
    handle = await open(file, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const found = /watchwright-video:([a-z]+)/.exec(buf.subarray(0, bytesRead).toString("latin1"))?.[1];
    return VIDEO_QUALITIES.find((q) => q === found) ?? "full";
  } catch {
    return "full";
  } finally {
    await handle?.close();
  }
}

/**
 * Every `.webm` in a run's folder (attempt videos and run videos), with sizes; files a compress
 * is writing are left out. With `clean` (only while no compress goes), partial files a stopped
 * server left are removed.
 */
export async function runVideos(runDir: string, o: { clean?: boolean } = {}): Promise<{ file: string; size: number }[]> {
  const out: { file: string; size: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(PART)) {
        if (o.clean) await unlink(p).catch(() => undefined);
      }
      else if (e.isFile() && e.name.endsWith(".webm")) out.push({ file: p, size: await stat(p).then((s) => s.size, () => 0) });
    }
  };
  await walk(runDir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Whether a video at `has` would get smaller at `target`. A `high` video is never compressed: it was
 * recorded to be watched, and shrinking it later would undo that.
 */
export function wantsCompress(has: VideoQuality, target: VideoQuality): boolean {
  return has !== "high" && smallerThan(target, has);
}

/** The ffmpeg arguments that encode `input` again at `quality` into `output`. */
export function compressArgs(input: string, output: string, encoder: VideoEncoder, quality: CompressQuality): string[] {
  const small = quality === "small";
  return [
    "-loglevel", "error", "-y",
    "-i", input,
    "-an",
    // Frames keep their own times; small takes 10 a second (ffmpeg won't take both at once).
    ...(small ? ["-r", "10", "-vf", "scale=trunc(iw*3/8)*2:trunc(ih*3/8)*2"] : ["-fps_mode", "vfr"]),
    ...encodeArgs(encoder, quality),
    "-f", "webm",
    output,
  ];
}

export interface CompressResult {
  before: number;
  after: number;
  /** False when the new file wasn't smaller, so the old one stays. */
  replaced: boolean;
}

/** Encodes `file` again at `quality` and puts it in place when smaller. Rejects on an ffmpeg failure or an abort (the old file stays). */
export async function compressVideo(ffmpeg: string, encoder: VideoEncoder, file: string, quality: CompressQuality, signal?: AbortSignal): Promise<CompressResult> {
  const before = (await stat(file)).size;
  const part = file.slice(0, -".webm".length) + PART;
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("stopped"));
      const proc = spawn(ffmpeg, compressArgs(file, part, encoder, quality), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
      const abort = () => proc.kill();
      signal?.addEventListener("abort", abort, { once: true });
      proc.on("error", (err) => {
        signal?.removeEventListener("abort", abort);
        reject(err);
      });
      proc.on("exit", (code) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(new Error("stopped"));
        else if (code === 0) resolve();
        else reject(new Error(stderr.trim().split("\n").at(-1) || `ffmpeg exited with code ${code}`));
      });
    });
    const after = (await stat(part)).size;
    if (after > 0 && after < before) {
      await replaceFile(part, file);
      return { before, after, replaced: true };
    }
    await unlink(part);
    return { before, after: before, replaced: false };
  } catch (err) {
    if (existsSync(part)) await unlink(part).catch(() => undefined);
    throw err;
  }
}
