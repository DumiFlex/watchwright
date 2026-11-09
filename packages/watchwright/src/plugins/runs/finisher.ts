import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chooseFinisher, finishArgs, finisherLabel, runFfmpeg, type EncoderMode, type Finisher, type FinisherChoice } from "../../jobs/video-finish.js";
import type { VideoQuality } from "../../jobs/run-video.js";
import { replaceFile } from "../../jobs/video-compress.js";

// The videos attempts recorded, finished one at a time after their attempts (see
// docs/research/smooth-videos.md): each capture goes into a WebM on the graphics card when there is
// one, else on the CPU at the lowest priority. A capture waits beside a small `.capture.json` with
// what its video row needs, so a server stopped before it got to one finishes it when it starts.

export interface FinishJob {
  /** The capture (`….capture.mkv`) and the WebM it becomes, absolute. */
  capture: string;
  output: string;
  width: number;
  height: number;
  quality: VideoQuality;
  runId: string;
  attemptId: string;
}

export interface FinishStatus {
  /** Who finishes videos now, as the Videos section says it. */
  encoder: string;
  gpu: boolean;
  /** Why the graphics card isn't used, when it isn't and could be. */
  note: string | null;
  /** Videos waiting or being finished. */
  pending: number;
}

export interface FinishQueueOptions {
  dataDir: string;
  mode: () => EncoderMode;
  /** A video is done: its size, or null and why when it couldn't be made (its capture is gone either way). */
  onDone: (job: FinishJob, size: number | null, error: string | null) => void;
  choose?: (mode: EncoderMode) => Promise<FinisherChoice>;
  run?: typeof runFfmpeg;
  threads?: number;
}

const CAPTURE = ".capture.mkv";
const SIDECAR = ".capture.json";
/** The file being written; no `.webm` ending, so nothing lists it as a video. */
const PART = ".finishing";

export const captureFileFor = (output: string) => output.replace(/\.webm$/, CAPTURE);
const sidecarOf = (capture: string) => capture.slice(0, -CAPTURE.length) + SIDECAR;
const remove = (file: string) => {
  try {
    unlinkSync(file);
  } catch {
    // gone already
  }
};

export class VideoFinishQueue {
  private readonly queue: FinishJob[] = [];
  private current: { job: FinishJob; abort: AbortController; done: Promise<void> } | null = null;
  private working: Promise<void> | null = null;
  private choice: { mode: EncoderMode; at: Promise<FinisherChoice> } | null = null;
  private closed = false;

  constructor(private readonly o: FinishQueueOptions) {}

  /** Who finishes videos at the current setting; asked once per setting while the server runs. */
  finisher(): Promise<FinisherChoice> {
    const mode = this.o.mode();
    if (!this.choice || this.choice.mode !== mode) this.choice = { mode, at: (this.o.choose ?? chooseFinisher)(mode) };
    return this.choice.at;
  }

  async status(): Promise<FinishStatus> {
    const c = await this.finisher();
    return { encoder: finisherLabel(c.finisher), gpu: c.finisher?.kind === "gpu", note: c.note, pending: this.pending() };
  }

  /** Captures waiting or being finished. */
  pending(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  /** Captures of a run waiting or being finished (but `except`, the one just done). */
  pendingFor(runId: string, except?: FinishJob): number {
    const cur = this.current?.job;
    return this.queue.filter((j) => j.runId === runId).length + (cur && cur !== except && cur.runId === runId ? 1 : 0);
  }

  /** Queues a capture; its `.capture.json` is written first, so a stop doesn't lose it. */
  add(job: FinishJob): void {
    if (this.closed) return;
    try {
      writeFileSync(sidecarOf(job.capture), JSON.stringify(job));
    } catch {
      // The folder went away; the capture goes with it.
    }
    this.queue.push(job);
    this.kick();
  }

  /**
   * On start: the captures a stopped server left. Those with a `.capture.json` are finished; a capture
   * without one (the attempt was cut off as it recorded) can't become a video row, so it goes.
   */
  recover(): number {
    const runs = path.join(this.o.dataDir, "runs");
    let names: string[];
    try {
      names = readdirSync(runs, { recursive: true, encoding: "utf8" });
    } catch {
      return 0;
    }
    let n = 0;
    for (const name of names.sort()) {
      const file = path.join(runs, name);
      if (name.endsWith(PART)) remove(file);
      if (!name.endsWith(CAPTURE)) continue;
      const sidecar = sidecarOf(file);
      let job: FinishJob | null;
      try {
        job = JSON.parse(readFileSync(sidecar, "utf8")) as FinishJob;
      } catch {
        job = null;
      }
      if (!job) {
        remove(file);
        continue;
      }
      // Paths as they are now: the data folder may have moved.
      job = { ...job, capture: file, output: path.join(path.dirname(file), path.basename(job.output)) };
      this.queue.push(job);
      n++;
    }
    // A sidecar whose capture is gone.
    for (const name of names) if (name.endsWith(SIDECAR) && !existsSync(path.join(runs, name.slice(0, -SIDECAR.length) + CAPTURE))) remove(path.join(runs, name));
    this.kick();
    return n;
  }

  /** Drops a run's waiting captures and stops the one being finished (its folder is about to go; Windows can't delete a file ffmpeg has open). */
  async cancelRun(runId: string): Promise<void> {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]!.runId === runId) this.queue.splice(i, 1);
    const cur = this.current;
    if (cur?.job.runId === runId) {
      cur.abort.abort("cancelled");
      await cur.done;
    }
  }

  /** Stops for shutdown: the video being finished stops, and every capture waits for the next start. */
  async close(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    this.current?.abort.abort("closing");
    await this.working;
  }

  /** Resolves once the queue is empty (tests). */
  async idle(): Promise<void> {
    while (this.working) await this.working;
  }

  private kick(): void {
    if (this.working || this.closed) return;
    this.working = this.work().finally(() => {
      this.working = null;
      if (this.queue.length && !this.closed) this.kick();
    });
  }

  private async work(): Promise<void> {
    while (this.queue.length && !this.closed) {
      const job = this.queue.shift()!;
      const abort = new AbortController();
      const done = this.finish(job, abort.signal).catch(() => undefined);
      this.current = { job, abort, done };
      try {
        await done;
      } finally {
        this.current = null;
      }
    }
  }

  private async finish(job: FinishJob, signal: AbortSignal): Promise<void> {
    if (!existsSync(job.capture)) {
      remove(sidecarOf(job.capture));
      this.o.onDone(job, null, "its recording was gone");
      return;
    }
    const { finisher } = await this.finisher();
    if (signal.aborted) return;
    let error = finisher ? null : "no ffmpeg can encode it (npx playwright install ffmpeg)";
    const tries: Finisher[] = [];
    if (finisher) tries.push(finisher);
    // The graphics card refusing one video (busy, a driver hiccup): the CPU does it instead.
    if (finisher?.kind === "gpu") {
      const cpu = (await (this.o.choose ?? chooseFinisher)("cpu")).finisher;
      if (cpu) tries.push(cpu);
    }
    const part = job.output.replace(/\.webm$/, "") + PART;
    for (const f of tries) {
      const r = await (this.o.run ?? runFfmpeg)(f.ffmpeg, finishArgs(job.capture, part, job.width, job.height, job.quality, f, this.o.threads), { lowPriority: true, signal });
      if (signal.aborted) {
        remove(part);
        // Cancelled with its run: the files go with the folder. Closing: it waits for the next start.
        return;
      }
      if (r.code === 0 && existsSync(part) && statSync(part).size > 0) {
        try {
          await replaceFile(part, job.output);
          const size = statSync(job.output).size;
          remove(job.capture);
          remove(sidecarOf(job.capture));
          this.o.onDone(job, size, null);
          return;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      } else error = r.stderr.split("\n").at(-1) || `ffmpeg exited with code ${r.code}`;
      remove(part);
    }
    remove(job.capture);
    remove(sidecarOf(job.capture));
    this.o.onDone(job, null, error);
  }
}
