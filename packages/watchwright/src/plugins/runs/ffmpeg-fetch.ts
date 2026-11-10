import { downloadFfmpeg, downloadedFfmpeg, ffmpegBuild, removeDownloadedFfmpeg, type FfmpegBuild } from "../../jobs/ffmpeg-download.js";
import { EngineError } from "./engine.js";

// Get ffmpeg (Admin > Storage > Videos): fetches a full ffmpeg into the data folder in the
// background, then asks the video finisher again, so the graphics card is used without a restart.

export interface FfmpegFetchReport {
  /** Whether there is a build for this machine (Windows x64, Linux x64 and arm64). */
  supported: boolean;
  /** Roughly how big the download is. */
  bytes: number;
  /** Whether a fetched ffmpeg is there. */
  installed: boolean;
  state: "idle" | "downloading" | "failed";
  /** Bytes fetched so far and the whole, while downloading. */
  done: number;
  total: number | null;
  error: string | null;
}

export interface FfmpegFetcherOptions {
  dataDir: string;
  /** Called after ffmpeg was fetched or removed: who finishes videos is asked again. */
  changed: () => void;
  /** Whether videos are being finished (the fetched ffmpeg may be in use). */
  busy?: () => boolean;
  build?: FfmpegBuild | null;
  download?: typeof downloadFfmpeg;
}

export class FfmpegFetcher {
  private state: FfmpegFetchReport["state"] = "idle";
  private done = 0;
  private total: number | null = null;
  private error: string | null = null;
  private abort: AbortController | null = null;
  private job: Promise<void> | null = null;
  private readonly build: FfmpegBuild | null;

  constructor(private readonly o: FfmpegFetcherOptions) {
    this.build = o.build === undefined ? ffmpegBuild() : o.build;
  }

  report(): FfmpegFetchReport {
    return {
      supported: this.build !== null,
      bytes: this.build?.bytes ?? 0,
      installed: downloadedFfmpeg(this.o.dataDir) !== null,
      state: this.state,
      done: this.done,
      total: this.total,
      error: this.error,
    };
  }

  /** Starts the download in the background; answers at once. */
  start(): FfmpegFetchReport {
    const build = this.build;
    if (!build) throw new EngineError("conflict", "There is no ffmpeg build to fetch for this machine; install ffmpeg yourself.", 409);
    if (this.state === "downloading") return this.report();
    this.state = "downloading";
    this.done = 0;
    this.total = null;
    this.error = null;
    const abort = new AbortController();
    this.abort = abort;
    this.job = (this.o.download ?? downloadFfmpeg)({
      dataDir: this.o.dataDir,
      build,
      signal: abort.signal,
      onProgress: (done, total) => {
        this.done = done;
        this.total = total;
      },
    }).then(
      () => {
        this.state = "idle";
        this.o.changed();
      },
      (err: unknown) => {
        if (abort.signal.aborted) {
          this.state = "idle";
          return;
        }
        this.state = "failed";
        this.error = err instanceof Error ? err.message : String(err);
      },
    );
    return this.report();
  }

  /** Stops a download that is going. */
  async stop(): Promise<FfmpegFetchReport> {
    this.abort?.abort();
    await this.job;
    return this.report();
  }

  /** Removes the fetched ffmpeg (Watchwright goes back to what else it finds). */
  async remove(): Promise<FfmpegFetchReport> {
    if (this.o.busy?.()) throw new EngineError("conflict", "Videos are being finished; remove ffmpeg once they're done.", 409);
    if (this.state === "downloading") await this.stop();
    try {
      removeDownloadedFfmpeg(this.o.dataDir);
    } catch (err) {
      throw new EngineError("conflict", `Couldn't remove ffmpeg: ${err instanceof Error ? err.message : String(err)}`, 409);
    }
    this.state = "idle";
    this.error = null;
    this.o.changed();
    return this.report();
  }

  /** Waits for a download that is going (tests, shutdown). */
  async idle(): Promise<void> {
    await this.job;
  }
}
