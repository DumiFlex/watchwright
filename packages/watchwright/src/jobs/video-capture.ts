import { createWriteStream, existsSync, statSync, type WriteStream } from "node:fs";
import { matroskaFrame, matroskaHeader } from "./run-video.js";

// An attempt's video while the attempt records: the screencast's JPEG frames written as they
// arrive, each with the time it came, into a small Matroska file. Nothing is encoded while the
// test runs (no ffmpeg, no CPU beside the browser); the finisher encodes the file into the WebM
// after the attempt (see docs/research/smooth-videos.md). Every frame the browser sent is in it,
// at its real time, instead of the newest frame a timer found.

/** What a capture holds once it stopped: its file and the video's size (even numbers). */
export interface CaptureResult {
  file: string;
  width: number;
  height: number;
  frames: number;
}

export interface CaptureFrame {
  data: Buffer;
  width: number;
  height: number;
  /**
   * When the session got the frame from the browser, on the capture's clock. Firefox frames go
   * through the flash filter, which holds each one until the next comes (to drop one-frame
   * flashes), so the time a frame reaches the capture is one frame late; this is its real time.
   */
  receivedAt?: number | undefined;
}

export interface VideoCaptureOptions {
  file: string;
  /** The video's size; frames of another size are centered, cropped or padded when it's finished (default: the first frame's size). */
  size?: { width: number; height: number } | undefined;
  /** Said once when the file can't be written; the run goes on without the video. */
  onError?: (message: string) => void;
  /** The clock, in milliseconds (tests). */
  now?: () => number;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export class VideoCapture {
  private out: WriteStream | null = null;
  private startedAt = 0;
  private last: Buffer | null = null;
  private lastMs = 0;
  private frames = 0;
  private width = 0;
  private height = 0;
  private failed = false;
  private stopped = false;

  constructor(private readonly o: VideoCaptureOptions) {}

  private now(): number {
    return this.o.now ? this.o.now() : performance.now();
  }

  /**
   * Writes a frame, stamped with the time it came (`receivedAt`, else now). The same frame twice
   * (a page that didn't change, or the page the video follows switching back) is written once.
   */
  push(frame: CaptureFrame): void {
    if (this.failed || this.stopped || frame.data === this.last) return;
    if (!this.out) {
      this.open(this.o.size?.width ?? frame.width, this.o.size?.height ?? frame.height);
      if (!this.out) return;
    }
    // Times only go forward, a millisecond at least, or the encoder would drop the frame.
    const at = frame.receivedAt ?? this.now();
    if (this.frames === 0) this.startedAt = at;
    const ms = this.frames === 0 ? 0 : Math.max(this.lastMs + 1, Math.round(at - this.startedAt));
    this.write(frame.data, ms);
  }

  private open(width: number, height: number): void {
    try {
      const out = createWriteStream(this.o.file);
      out.on("error", (err) => this.fail(err.message));
      out.write(matroskaHeader());
      this.out = out;
      this.width = even(width);
      this.height = even(height);
      this.startedAt = this.now();
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private write(data: Buffer, ms: number): void {
    if (!this.out) return;
    this.last = data;
    this.lastMs = ms;
    this.frames++;
    this.out.write(matroskaFrame(ms, data.length));
    this.out.write(data);
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    this.o.onError?.(message);
  }

  /**
   * Ends the capture. The last frame is written again at the end, so a still page before the stop
   * keeps its length (and once more a moment later, which gives that frame a known length).
   * Null when nothing was written.
   */
  async stop(): Promise<CaptureResult | null> {
    if (this.stopped) return null;
    this.stopped = true;
    const out = this.out;
    this.out = null;
    if (!out) return null;
    if (this.last && !this.failed) {
      this.out = out;
      const end = Math.max(this.lastMs + 1, Math.round(this.now() - this.startedAt));
      this.write(this.last, end);
      this.write(this.last, end + 40);
      this.out = null;
    }
    await new Promise<void>((resolve) => out.end(() => resolve()));
    if (this.failed || !existsSync(this.o.file) || statSync(this.o.file).size === 0) return null;
    return { file: this.o.file, width: this.width, height: this.height, frames: this.frames };
  }
}
