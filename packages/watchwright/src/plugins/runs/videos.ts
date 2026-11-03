import path from "node:path";
import { findFfmpeg, videoEncoder, type VideoQuality } from "../../jobs/run-video.js";
import { compressVideo, runVideos, videoQualityOf, wantsCompress } from "../../jobs/video-compress.js";
import { EngineError } from "./engine.js";

// Compress kept videos (Admin > Storage): the videos ended runs kept, encoded again at the
// `runs.videoQuality` setting, one at a time on one core, oldest run first. It never touches a run
// that is going, and stops by itself when one starts, so tests never share the CPU with it.

export interface CompressJob {
  state: "running" | "done" | "stopped" | "failed";
  quality: VideoQuality;
  /** Videos to encode when it started, and how many are done (replaced, kept or failed). */
  total: number;
  done: number;
  /** Encoded but not smaller, so the old file stays. */
  kept: number;
  failed: number;
  /** Bytes the done videos took before, and take now. */
  beforeBytes: number;
  afterBytes: number;
  startedAt: string;
  finishedAt: string | null;
  /** Why it stopped early, or the last error. */
  reason: string | null;
  by: string;
}

export interface VideoReport {
  /** The quality runs record at now, and the one Compress kept videos encodes to. */
  quality: VideoQuality;
  /** Whether Playwright's ffmpeg is there (both recording and compressing need it). */
  ffmpeg: boolean;
  /** Videos ended runs kept, and the room they take. */
  videos: number;
  bytes: number;
  /** Of those, the ones bigger than `quality` would make them. */
  toCompress: number;
  toCompressBytes: number;
  /** The compress job that is going, or the last one. */
  job: CompressJob | null;
}

export interface VideoCompressorOptions {
  dataDir: string;
  repo: { endedRunIds(): string[]; updateArtifactSize(relPath: string, size: number): void };
  events: { append(type: string, data?: Record<string, unknown>, ref?: { runId?: string }): unknown };
  quality: () => VideoQuality;
  /** True while a run is going (or about to): the job doesn't start, and stops. */
  busy: () => boolean;
  /** Measures an ended run's folder again. */
  measure: (runId: string) => Promise<unknown>;
  /** How often a going job checks for a run that started (default every 2 s). */
  checkMs?: number;
  findFfmpeg?: () => string | null;
}

interface Candidate {
  runId: string;
  file: string;
  size: number;
}

export class VideoCompressor {
  private job: CompressJob | null = null;
  private abort: AbortController | null = null;
  private running: Promise<void> | null = null;
  /** Files encoded again that didn't get smaller: not tried again while the server runs. */
  private readonly keep = new Set<string>();

  constructor(private readonly o: VideoCompressorOptions) {}

  private ffmpeg(): string | null {
    return (this.o.findFfmpeg ?? findFfmpeg)();
  }

  private async candidates(quality: VideoQuality, clean = false): Promise<{ all: Candidate[]; todo: Candidate[] }> {
    const all: Candidate[] = [];
    const todo: Candidate[] = [];
    for (const runId of this.o.repo.endedRunIds()) {
      for (const v of await runVideos(path.join(this.o.dataDir, "runs", runId), { clean })) {
        const c = { runId, ...v };
        all.push(c);
        if (!this.keep.has(v.file) && wantsCompress(await videoQualityOf(v.file), quality)) todo.push(c);
      }
    }
    return { all, todo };
  }

  async report(): Promise<VideoReport> {
    const quality = this.o.quality();
    const { all, todo } = await this.candidates(quality);
    return {
      quality,
      ffmpeg: this.ffmpeg() !== null,
      videos: all.length,
      bytes: all.reduce((n, c) => n + c.size, 0),
      toCompress: todo.length,
      toCompressBytes: todo.reduce((n, c) => n + c.size, 0),
      job: this.job && { ...this.job },
    };
  }

  /** Starts compressing in the background; the answer is the job as it starts. */
  async start(by: string): Promise<CompressJob> {
    if (this.job?.state === "running") throw new EngineError("compress_going", "Videos are already being compressed.", 409);
    if (this.o.busy()) throw new EngineError("run_going", "A run is going. Compress kept videos once no run is going, so the run keeps the whole CPU.", 409);
    const quality = this.o.quality();
    if (quality === "full") throw new EngineError("quality_full", "Video quality is Full. Choose Compact or Small first: kept videos are compressed to that quality.", 400);
    const ffmpeg = this.ffmpeg();
    const encoder = ffmpeg ? videoEncoder(ffmpeg) : null;
    if (!ffmpeg || !encoder) throw new EngineError("no_ffmpeg", "Playwright's ffmpeg isn't installed (npx playwright install ffmpeg), so videos can't be compressed.", 400);
    // No job goes, so partial files are a stopped server's leftovers.
    const { todo } = await this.candidates(quality, true);
    const job: CompressJob = { state: "running", quality, total: todo.length, done: 0, kept: 0, failed: 0, beforeBytes: 0, afterBytes: 0, startedAt: new Date().toISOString(), finishedAt: null, reason: null, by };
    this.job = job;
    const abort = new AbortController();
    this.abort = abort;
    this.o.events.append("videos.compress.started", { by, quality, videos: todo.length, bytes: todo.reduce((n, c) => n + c.size, 0) });
    this.running = this.work(job, todo, ffmpeg, encoder, abort).finally(() => {
      this.running = null;
      if (this.abort === abort) this.abort = null;
    });
    return { ...job };
  }

  private async work(job: CompressJob, todo: Candidate[], ffmpeg: string, encoder: NonNullable<ReturnType<typeof videoEncoder>>, abort: AbortController): Promise<void> {
    const watch = setInterval(() => {
      if (this.o.busy()) abort.abort("A run started, so compressing stopped. Press Compress again once no run is going.");
    }, this.o.checkMs ?? 2000);
    const touched = new Set<string>();
    try {
      for (const c of todo) {
        if (this.o.busy()) abort.abort("A run started, so compressing stopped. Press Compress again once no run is going.");
        if (abort.signal.aborted) break;
        if (job.quality === "full") break;
        try {
          const r = await compressVideo(ffmpeg, encoder, c.file, job.quality, abort.signal);
          job.beforeBytes += r.before;
          job.afterBytes += r.after;
          if (r.replaced) {
            touched.add(c.runId);
            this.o.repo.updateArtifactSize(path.relative(this.o.dataDir, c.file).split(path.sep).join("/"), r.after);
          } else {
            job.kept++;
            this.keep.add(c.file);
          }
          job.done++;
        } catch (err) {
          if (abort.signal.aborted) break;
          job.failed++;
          job.done++;
          job.reason = `${path.basename(c.file)}: ${err instanceof Error ? err.message : String(err)}`;
          this.keep.add(c.file);
        }
      }
    } finally {
      clearInterval(watch);
      for (const id of touched) await this.o.measure(id).catch(() => undefined);
      job.finishedAt = new Date().toISOString();
      if (abort.signal.aborted) {
        job.state = "stopped";
        job.reason = typeof abort.signal.reason === "string" ? abort.signal.reason : "Stopped.";
      } else job.state = job.failed > 0 && job.failed === job.done ? "failed" : "done";
      this.o.events.append("videos.compressed", {
        by: job.by,
        state: job.state,
        quality: job.quality,
        videos: job.done - job.kept - job.failed,
        savedBytes: job.beforeBytes - job.afterBytes,
      });
    }
  }

  /** Stops a going job after killing the ffmpeg it runs; the video it was on stays as it was. */
  async stop(reason = "Stopped."): Promise<CompressJob | null> {
    this.abort?.abort(reason);
    await this.running;
    return this.job && { ...this.job };
  }
}
