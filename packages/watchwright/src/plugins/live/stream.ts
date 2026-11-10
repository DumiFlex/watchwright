import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import { findFfmpeg, matroskaFrame, matroskaHeader } from "../../jobs/run-video.js";
import { ffmpegOnPath } from "../../jobs/video-finish.js";
import type { Frame, FrameHub } from "./hub.js";
import { isVp8Key, WebmReader } from "./webm.js";

// The live view as a video stream, for viewers on another machine: a page's screencast frames go
// into ffmpeg as they come and come out as VP8, which is a tenth of the JPEG frames' size or less.
// The browser decodes it with WebCodecs. ffmpeg runs only while someone watches a page this way,
// and stops when the page has sent nothing for a while. See docs/research/smooth-videos.md.

/** One encoded frame of a page's stream. */
export interface VideoChunk {
  runId: string;
  pageId: string;
  /** When the browser painted the frame it came from (ms since the epoch). */
  timestamp: number;
  width: number;
  height: number;
  /** A key frame: a viewer can start here. */
  key: boolean;
  data: Buffer;
}

/**
 * ffmpeg (its Matroska reader and WebM writer) gives a frame out only once the next one or two
 * came in. So when a page stops changing, its last frame is sent again this often, a few times,
 * which pushes the real one out: a still page shows its newest picture within about 150 ms.
 */
const NUDGE_MS = 50;
const NUDGES = 3;
/** A key frame at least this often (frames), so a viewer that joins or falls behind can start again soon. */
const KEY_EVERY = 60;
/** A page that sent no frame for this long has its encoder stopped (the next frame starts a new one). */
export const STREAM_IDLE_MS = 30_000;
/** When ffmpeg hasn't taken this much yet, new frames are skipped until it has. */
const INPUT_BACKLOG_BYTES = 4 * 1024 * 1024;

/** Bits a second for a page this size: about 2.5 Mbit/s for a megapixel, 1 to 6 Mbit/s. */
export function streamBitRate(width: number, height: number): number {
  return Math.round(Math.min(6_000_000, Math.max(1_000_000, width * height * 2.5)));
}

export function streamArgs(width: number, height: number): string[] {
  const rate = streamBitRate(width, height);
  return [
    "-loglevel", "error",
    "-copyts", "-fflags", "nobuffer", "-probesize", "32", "-analyzeduration", "0", "-f", "matroska", "-threads", "1", "-i", "pipe:0",
    "-an", "-fps_mode", "passthrough", "-enc_time_base", "1:1000", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-lag-in-frames", "0", "-auto-alt-ref", "0",
    "-error-resilient", "1", "-g", String(KEY_EVERY), "-b:v", String(rate), "-maxrate", String(rate), "-bufsize", String(rate),
    "-threads", "2",
    "-flush_packets", "1", "-live", "1", "-cluster_size_limit", "1", "-cluster_time_limit", "0",
    "-f", "webm", "pipe:1",
  ];
}

const vp8 = new Map<string, boolean>();
/** An ffmpeg that can encode VP8 (Playwright's can), or null. */
export function streamFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const ffmpeg of [findFfmpeg(env), ffmpegOnPath(env)]) {
    if (!ffmpeg) continue;
    let ok = vp8.get(ffmpeg);
    if (ok === undefined) {
      const out = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
      ok = /\slibvpx\s/.test(`${out.stdout ?? ""}`);
      vp8.set(ffmpeg, ok);
    }
    if (ok) return ffmpeg;
  }
  return null;
}

/** One page's encoder. Frames go in with `push`; chunks come out through `onChunk`. */
export class PageStream {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private size: { width: number; height: number } | null = null;
  private startedAt = 0;
  private lastMs = -1;
  /** Each frame's time in the stream (ms) → when the browser painted it. */
  private readonly stamps = new Map<number, number>();
  private lastTimestamp = 0;
  private last: Frame | null = null;
  private lastAt = 0;
  private nudge: ReturnType<typeof setTimeout> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** The end of what ffmpeg said on its error output (for tests and troubleshooting). */
  error = "";
  /** Chunks since the newest key frame, for a viewer that joins. */
  gop: VideoChunk[] = [];

  constructor(
    private readonly ffmpeg: string,
    readonly runId: string,
    readonly pageId: string,
    private readonly onChunk: (chunk: VideoChunk) => void,
    private readonly o: { idleMs?: number; spawn?: typeof spawn; now?: () => number } = {},
  ) {}

  push(frame: Frame): void {
    if (this.closed) return;
    if (this.size && (this.size.width !== frame.width || this.size.height !== frame.height)) this.stop();
    if (!this.proc) this.start(frame.width, frame.height);
    if (!this.proc) return;
    // ffmpeg reads the first frame to learn the picture's size and may drop it, so it goes in twice.
    if (this.lastMs < 0) this.write(frame);
    if (!this.write(frame)) return;
    this.last = frame;
    this.lastAt = Date.now();
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), this.o.idleMs ?? STREAM_IDLE_MS);
    this.idle.unref?.();
    this.nudgeLater(NUDGES);
  }

  /** Writes a frame into ffmpeg at the time it comes; false when ffmpeg is behind and it was skipped. */
  private write(frame: Frame, timestamp = frame.timestamp): boolean {
    const proc = this.proc;
    if (!proc || proc.stdin.writableLength > INPUT_BACKLOG_BYTES) return false;
    const now = this.o.now?.() ?? Date.now();
    if (this.lastMs < 0) this.startedAt = now;
    const ms = Math.max(this.lastMs + 1, Math.round(now - this.startedAt));
    this.lastMs = ms;
    this.stamps.set(ms, timestamp);
    proc.stdin.write(Buffer.concat([matroskaFrame(ms, frame.data.length), frame.data]));
    return true;
  }

  private nudgeLater(left: number): void {
    if (this.nudge) clearTimeout(this.nudge);
    this.nudge = null;
    if (left <= 0) return;
    this.nudge = setTimeout(() => {
      this.nudge = null;
      const f = this.last;
      if (!f || !this.proc) return;
      // The same picture, a little later than the frame it repeats.
      this.write(f, f.timestamp + (Date.now() - this.lastAt));
      this.nudgeLater(left - 1);
    }, NUDGE_MS);
    this.nudge.unref?.();
  }

  private start(width: number, height: number): void {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = (this.o.spawn ?? spawn)(this.ffmpeg, streamArgs(width, height), { windowsHide: true });
    } catch {
      return;
    }
    if (proc.pid !== undefined) {
      try {
        os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // Not allowed here: it runs at the normal priority.
      }
    }
    this.proc = proc;
    this.size = { width, height };
    this.lastMs = -1;
    this.stamps.clear();
    this.gop = [];
    proc.stdin.write(matroskaHeader());
    const reader = new WebmReader(({ ms, data }) => {
      // Every chunk goes out, even one whose frame isn't known: the ones after it need it.
      const timestamp = this.stamps.get(ms) ?? this.lastTimestamp;
      for (const k of this.stamps.keys()) if (k <= ms) this.stamps.delete(k);
      this.lastTimestamp = timestamp;
      const chunk: VideoChunk = { runId: this.runId, pageId: this.pageId, timestamp, width, height, key: isVp8Key(data), data };
      if (chunk.key) this.gop = [];
      this.gop.push(chunk);
      this.onChunk(chunk);
    });
    proc.stdout.on("data", (d: Buffer) => {
      if (this.proc !== proc) return;
      try {
        reader.push(d);
      } catch {
        this.stop();
      }
    });
    proc.stdin.on("error", () => undefined); // ffmpeg ended: the exit handler cleans up
    proc.stderr.on("data", (d: Buffer) => (this.error = (this.error + d.toString()).slice(-2000)));
    proc.on("error", () => undefined);
    proc.on("exit", () => {
      if (this.proc === proc) {
        this.proc = null;
        this.size = null;
        this.gop = [];
      }
    });
  }

  /** Stops the encoder (the next frame starts a new one, beginning with a key frame). */
  stop(): void {
    if (this.idle) clearTimeout(this.idle);
    if (this.nudge) clearTimeout(this.nudge);
    this.idle = this.nudge = null;
    const proc = this.proc;
    this.proc = null;
    this.size = null;
    this.gop = [];
    if (proc) {
      proc.stdin.end();
      setTimeout(() => proc.kill(), 1000).unref();
    }
  }

  close(): void {
    this.closed = true;
    this.stop();
  }

  get running(): boolean {
    return this.proc !== null;
  }
}

/** Binary video message: 4-byte big-endian header length, the JSON header (`video: "vp8"`, `key`), then the VP8 frame. */
export function encodeChunk(c: VideoChunk): Buffer {
  const header = Buffer.from(JSON.stringify({ runId: c.runId, pageId: c.pageId, timestamp: c.timestamp, width: c.width, height: c.height, video: "vp8", key: c.key }), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length, 0);
  return Buffer.concat([len, header, c.data]);
}

/**
 * The video streams of every watched run: a run's pages are encoded while at least one viewer
 * watches it as video, and stop when the last one leaves.
 */
export class StreamHub {
  private readonly runs = new Map<string, { pages: Map<string, PageStream>; viewers: Set<(c: VideoChunk) => void>; stop: () => void }>();

  constructor(
    private readonly frames: FrameHub,
    private readonly ffmpeg: string,
    private readonly o: { idleMs?: number; spawn?: typeof spawn } = {},
  ) {}

  /** Sends a run's chunks to `fn`, starting with each page's chunks since its newest key frame. */
  watch(runId: string, fn: (c: VideoChunk) => void): () => void {
    let run = this.runs.get(runId);
    if (!run) {
      const pages = new Map<string, PageStream>();
      const viewers = new Set<(c: VideoChunk) => void>();
      const page = (id: string) => {
        let p = pages.get(id);
        if (!p) pages.set(id, (p = new PageStream(this.ffmpeg, runId, id, (c) => viewers.forEach((v) => v(c)), this.o)));
        return p;
      };
      const stop = this.frames.subscribe(runId, (f) => page(f.pageId).push(f));
      run = { pages, viewers, stop };
      this.runs.set(runId, run);
      // Start from the picture each page shows now, so a still page isn't blank.
      for (const f of this.frames.latestFrames(runId)) page(f.pageId).push(f);
    } else {
      for (const p of run.pages.values()) for (const c of p.gop) fn(c);
    }
    run.viewers.add(fn);
    const r = run;
    return () => {
      r.viewers.delete(fn);
      if (r.viewers.size > 0 || this.runs.get(runId) !== r) return;
      r.stop();
      for (const p of r.pages.values()) p.close();
      this.runs.delete(runId);
    };
  }

  /** Stops every encoder (the server is closing). */
  close(): void {
    for (const r of this.runs.values()) {
      r.stop();
      for (const p of r.pages.values()) p.close();
    }
    this.runs.clear();
  }
}
