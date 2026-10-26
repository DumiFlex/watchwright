import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type LaunchOptions, type Page } from "playwright";

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
}

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
    const browser = await BROWSERS[opts.browser].launch({ headless: opts.headless, ...opts.launch });
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
    const onFrame = (f: { data: Buffer; timestamp: number; viewportWidth: number; viewportHeight: number }) =>
      this.hooks.onFrame?.({ pageId: entry.id, timestamp: f.timestamp, width: f.viewportWidth, height: f.viewportHeight, data: f.data });
    await entry.page.screencast.start({ onFrame, size, quality: this.opts.quality, ...(videoPath ? { path: videoPath } : {}) });
    entry.videoPath = videoPath;
    entry.capturing = true;
  }

  private async stopPage(entry: PageEntry): Promise<string | null> {
    if (!entry.capturing) return null;
    entry.capturing = false;
    const videoPath = entry.videoPath;
    entry.videoPath = null;
    try {
      await entry.page.screencast.stop();
      return videoPath;
    } catch (err) {
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
