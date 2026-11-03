import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type LaunchOptions, type Page } from "playwright";
import { findFfmpeg, qualityFps, RunVideo, videoEncoder, type VideoQuality } from "../jobs/run-video.js";
import { FlashFilter } from "./flash-filter.js";

// A browser session: one browser, one context, every page in it, and their screencasts and trace.
// It knows nothing about runs or tests (docs/plan.md, section 3, layer 1).

export interface SessionOptions {
  browser: "chromium" | "firefox" | "webkit";
  headless: boolean;
  viewport: { width: number; height: number };
  launch?: LaunchOptions | undefined;
  context?: BrowserContextOptions | undefined;
  /** Screencast size; defaults to the viewport. */
  size?: { width: number; height: number } | undefined;
  /** JPEG quality of frames, 1–100. */
  quality: number;
  showActions: boolean;
  /** Keep a Playwright trace that chunks can be saved from (default true). */
  trace?: boolean;
  /**
   * Drop the one-frame flashes Firefox's screencast sends (tiles not painted yet) from the live
   * frames and the videos (default: on for Firefox). The videos are then written by Watchwright
   * from the kept frames, with Playwright's ffmpeg, instead of by Playwright.
   */
  filterFlashes?: boolean;
  /**
   * How much room attempt videos take (default `full`, Playwright's own). Below `full`, Watchwright
   * writes every page's video itself from the screencast frames, at that quality.
   */
  videoQuality?: VideoQuality;
}

export interface SessionFrame {
  pageId: string;
  timestamp: number;
  width: number;
  height: number;
  data: Buffer;
}

export interface SessionHooks {
  onFrame?(frame: SessionFrame): void;
  onPageOpened?(pageId: string, url: string): void;
  onPageClosed?(pageId: string): void;
  onPageNavigated?(pageId: string, url: string): void;
  onActivePage?(pageId: string): void;
  /** Video recording failed (usually Playwright's ffmpeg is missing); frames keep flowing. */
  onVideoUnavailable?(message: string): void;
}

interface PageEntry {
  id: string;
  page: Page;
  /** Where this page's video goes for the current capture, if any. */
  videoPath: string | null;
  capturing: boolean;
  /** With flash filtering: the filter, the newest kept frame, and the video written from those. */
  filter?: FlashFilter<SessionFrame> | null;
  latest?: { data: Buffer; width: number; height: number } | null;
  video?: RunVideo | null;
}

/** Attempt videos written from filtered frames: the screencast's own rate and a bit rate close to Playwright's. */
const VIDEO_FPS = 25;
const VIDEO_BIT_RATE = "1M";

const BROWSERS = { chromium, firefox, webkit };

export class BrowserSession {
  private readonly pages = new Map<Page, PageEntry>();
  private nextPage = 1;
  private videoDir: string | null = null;
  private captureOn = false;
  private videoBroken = false;
  private activeId: string | null = null;
  private inflight = 0;
  private lastNetwork = Date.now();
  private tracing = false;
  private closed = false;

  private constructor(
    readonly browser: Browser,
    public context: BrowserContext,
    private readonly opts: SessionOptions,
    private readonly hooks: SessionHooks,
  ) {}

  static async launch(opts: SessionOptions, hooks: SessionHooks = {}): Promise<BrowserSession> {
    const browser = await BROWSERS[opts.browser].launch({ headless: opts.headless, ...opts.launch }).catch((err: unknown) => {
      throw missingBrowser(opts.browser, err) ?? err;
    });
    try {
      const context = await browser.newContext({ viewport: opts.viewport, ...opts.context });
      const session = new BrowserSession(browser, context, opts, hooks);
      await session.adoptContext();
      return session;
    } catch (err) {
      await browser.close().catch(() => undefined);
      throw err;
    }
  }

  private async adoptContext(): Promise<void> {
    const ctx = this.context;
    ctx.on("page", (page) => void this.adopt(page));
    ctx.on("request", () => {
      this.inflight++;
      this.lastNetwork = Date.now();
    });
    const done = () => {
      this.inflight = Math.max(0, this.inflight - 1);
      this.lastNetwork = Date.now();
    };
    ctx.on("requestfinished", done);
    ctx.on("requestfailed", done);
    if (this.opts.trace === false) return;
    await ctx.tracing.start({ snapshots: true, screenshots: false, sources: false });
    this.tracing = true;
  }

  private async adopt(page: Page): Promise<PageEntry> {
    const existing = this.pages.get(page);
    if (existing) return existing;
    const entry: PageEntry = { id: `p${this.nextPage++}`, page, videoPath: null, capturing: false };
    this.pages.set(page, entry);
    this.hooks.onPageOpened?.(entry.id, page.url());
    page.on("close", () => {
      this.pages.delete(page);
      this.hooks.onPageClosed?.(entry.id);
      if (this.activeId === entry.id) {
        const last = [...this.pages.values()].pop();
        this.activeId = null;
        if (last) this.setActive(last.page);
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.hooks.onPageNavigated?.(entry.id, frame.url());
    });
    if (this.opts.showActions) await page.screencast.showActions({ position: "top-right" }).catch(() => undefined);
    // A newly opened page (popup, new tab) becomes the one the live view follows.
    this.setActive(page);
    if (this.captureOn) await this.startPage(entry).catch(() => undefined);
    return entry;
  }

  /** The page tests run on: the first open page, or a new one. */
  async mainPage(): Promise<Page> {
    const first = [...this.pages.values()][0];
    if (first) return first.page;
    const page = await this.context.newPage();
    await this.adopt(page);
    return page;
  }

  /** Closes every page but the main one (tabs and popups the last test left open). Returns how many closed. */
  async closeExtraPages(): Promise<number> {
    const extra = [...this.pages.values()].slice(1);
    await Promise.all(extra.map((e) => e.page.close().catch(() => undefined)));
    return extra.length;
  }

  pageId(page: Page): string | null {
    return this.pages.get(page)?.id ?? null;
  }

  openPages(): { id: string; url: string }[] {
    return [...this.pages.values()].map((e) => ({ id: e.id, url: e.page.url() }));
  }

  get activePage(): string | null {
    return this.activeId;
  }

  /** Marks the page that just had an action as the one the live view follows. */
  setActive(page: Page): void {
    const entry = this.pages.get(page);
    if (!entry || entry.id === this.activeId) return;
    this.activeId = entry.id;
    this.hooks.onActivePage?.(entry.id);
  }

  /** Requests in flight and the time the network last changed, for `h.idle()`. */
  network(): { inflight: number; quietForMs: number } {
    return { inflight: this.inflight, quietForMs: this.inflight > 0 ? 0 : Date.now() - this.lastNetwork };
  }

  private async startPage(entry: PageEntry): Promise<void> {
    if (this.closed) return;
    const videoPath = this.videoDir && !this.videoBroken ? path.join(this.videoDir, `video-${entry.id}.webm`) : null;
    const size = this.opts.size ?? this.opts.viewport;
    const deliver = (f: SessionFrame) => {
      entry.latest = { data: f.data, width: f.width, height: f.height };
      this.hooks.onFrame?.(f);
    };
    const filtering = this.opts.filterFlashes ?? this.opts.browser === "firefox";
    entry.filter = filtering ? new FlashFilter<SessionFrame>(deliver) : null;
    entry.latest = null;
    // With the filter on, or a quality below Playwright's, the video is written from the (kept)
    // frames; without ffmpeg, Playwright writes it as it is.
    const quality = this.opts.videoQuality ?? "full";
    const ffmpeg = (filtering || quality !== "full") && videoPath ? findFfmpeg() : null;
    const ownVideo = !!(ffmpeg && videoPath && videoEncoder(ffmpeg));
    entry.video =
      ownVideo && videoPath && ffmpeg
        ? new RunVideo({
            file: videoPath,
            ffmpeg,
            fps: qualityFps(quality, VIDEO_FPS),
            bitRate: VIDEO_BIT_RATE,
            quality,
            frame: () => entry.latest ?? null,
            onError: (message) => {
              if (this.videoBroken) return;
              this.videoBroken = true;
              this.hooks.onVideoUnavailable?.(message);
            },
          })
        : null;
    const onFrame = (f: { data: Buffer; timestamp: number; viewportWidth: number; viewportHeight: number }) => {
      const frame: SessionFrame = { pageId: entry.id, timestamp: f.timestamp, width: f.viewportWidth, height: f.viewportHeight, data: f.data };
      if (entry.filter) entry.filter.push(frame);
      else deliver(frame);
    };
    await entry.page.screencast.start({ onFrame, size, quality: this.opts.quality, ...(videoPath && !ownVideo ? { path: videoPath } : {}) });
    entry.video?.start();
    entry.videoPath = videoPath;
    entry.capturing = true;
  }

  private async stopPage(entry: PageEntry): Promise<string | null> {
    if (!entry.capturing) return null;
    entry.capturing = false;
    const videoPath = entry.videoPath;
    entry.videoPath = null;
    const video = entry.video ?? null;
    entry.video = null;
    try {
      await entry.page.screencast.stop();
      entry.filter?.flush();
      if (video) return (await video.stop()) ? videoPath : null;
      return videoPath;
    } catch (err) {
      entry.filter?.flush();
      if (video) await video.stop().catch(() => false);
      if (entry.page.isClosed()) return null;
      if (videoPath && !this.videoBroken) {
        this.videoBroken = true;
        this.hooks.onVideoUnavailable?.(err instanceof Error ? err.message.split("\n")[0]! : String(err));
      }
      return null;
    }
  }

  /**
   * (Re)starts the screencast on every page. With `videoDir`, each page also records a video there
   * until the next restart or `stopCapture`. Frames flow either way.
   */
  async restartCapture(videoDir: string | null): Promise<{ pageId: string; path: string }[]> {
    const saved = await this.stopCapture();
    if (videoDir) mkdirSync(videoDir, { recursive: true });
    this.videoDir = videoDir;
    this.captureOn = true;
    for (const entry of this.pages.values()) await this.startPage(entry).catch(() => undefined);
    return saved;
  }

  /** Stops every screencast; returns the videos that were saved. */
  async stopCapture(): Promise<{ pageId: string; path: string }[]> {
    const saved: { pageId: string; path: string }[] = [];
    for (const entry of this.pages.values()) {
      const p = await this.stopPage(entry);
      if (p) saved.push({ pageId: entry.id, path: p });
    }
    return saved;
  }

  async startTraceChunk(): Promise<void> {
    if (this.tracing) await this.context.tracing.startChunk().catch(() => undefined);
  }

  /** Ends the trace chunk; it is written to `file` when given, otherwise dropped. */
  async stopTraceChunk(file: string | null): Promise<boolean> {
    if (!this.tracing) return false;
    try {
      if (file) mkdirSync(path.dirname(file), { recursive: true });
      await this.context.tracing.stopChunk(file ? { path: file } : {});
      return file !== null;
    } catch {
      return false;
    }
  }

  /**
   * Ends whatever the pages are doing, then closes the context. Used by "stop now".
   * Pending navigations are interrupted first: closing a context while a `goto` is about to
   * resolve can leave that call hanging in Playwright (its result names a disposed response).
   */
  async closeContext(): Promise<void> {
    await Promise.all(
      [...this.pages.keys()].map((page) => page.goto("about:blank", { timeout: 3000 }).catch(() => undefined)),
    );
    await this.context.close().catch(() => undefined);
  }

  /** Replaces the context with a fresh one, after an attempt that wouldn't end. */
  async resetContext(): Promise<void> {
    await this.context.close().catch(() => undefined);
    this.pages.clear();
    this.inflight = 0;
    this.context = await this.browser.newContext({ viewport: this.opts.viewport, ...this.opts.context });
    await this.adoptContext();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.browser.close().catch(() => undefined);
  }
}

/** Playwright's error for a browser that was never downloaded, as one line that says what to run. */
export function missingBrowser(name: string, err: unknown): Error | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!/Executable doesn't exist|playwright install/i.test(message)) return null;
  return new Error(`Playwright's ${name} isn't installed on this machine. Install it with: npx playwright install ${name}`, { cause: err });
}

