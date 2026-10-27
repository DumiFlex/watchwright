import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { EventLog } from "../../events/log.js";
import { RunControl } from "../../jobs/control.js";
import { AttemptRecorder } from "../../jobs/recorder.js";
import { BrowserSession } from "../../session/session.js";
import type { FrameHub } from "../live/hub.js";
import type { LoadedPack } from "../packs/loader.js";
import { runSteps } from "../packs/yaml/run.js";
import type { StepArgs } from "../packs/yaml/steps.js";
import type { Target } from "../packs/yaml/targets.js";
import type { ParamValues } from "../packs/api.js";
import { createHelpers } from "../testing/helpers.js";
import { stepOfAction, type RecorderAction } from "./actions.js";
import { sameTarget, snapshotAt, withAlternatives, type ElementInfo, type Snapshot } from "./candidates.js";

// One recording: a browser with the pack's options, its pages streamed to the live view, input
// from the web page sent to the active page, and Playwright's recorder turning what happens into
// YAML steps. Nothing is written to the pack; the web app puts the steps into the file at Done.

export type RecordStatus = "waiting" | "starting" | "replaying" | "recording" | "ended";

export interface RecordEntry {
  id: string;
  name: string;
  args: StepArgs;
  /**
   * Targets that also pick out the element, the one in `args.target` first: the recorder's, then
   * test id, role, label, … (each checked on the page when the step was made).
   */
  targets: Target[];
  /** Where the click landed, from the element's top-left corner: "Click at this spot". */
  spot: { x: number; y: number } | null;
}

export type RecordInput =
  | { type: "click" | "dblclick"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "down" | "up"; x: number; y: number; button?: "left" | "right" | "middle"; clickCount?: number }
  | { type: "move"; x: number; y: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string }
  | { type: "goto"; url: string }
  | { type: "back" | "reload" };

export interface RecordOptions {
  pack: LoadedPack;
  packId: string;
  siteKey: string;
  /** The test being recorded into, for "Record from here". */
  testId: string | null;
  /** How many of the test's top-level steps run first (Record from here); 0 starts at `url`. */
  replay: number;
  /** Where to open: the site's base URL by default. */
  url: string | null;
  params: ParamValues;
  /** Open a browser window on the machine instead of recording on the live view. */
  window: boolean;
  dataDir: string;
}

export interface RecordHost {
  events: EventLog;
  frames: FrameHub;
  siteBusy(siteKey: string): boolean;
  holdSite(siteKey: string): () => void;
}

/** Closes a recording nobody has touched for this long. */
export const IDLE_LIMIT_MS = 30 * 60_000;

interface Pending {
  snapshot: Snapshot;
  at: number;
  /** The selector of the first recorded step that used it; later steps on the same element share it. */
  selector: string | null;
}

/** Playwright's internal recorder seam (docs/research/step-4-authoring.md, section 2). */
interface RecordingContext {
  _startRecording(params: { language: string }, sink: { actionAdded(page: Page, action: unknown, code: string): void; actionUpdated(page: Page, action: unknown, code: string): void; signalAdded(page: Page, signal: unknown, code: string): void }): Promise<void>;
  _stopRecording(): Promise<void>;
}

export class RecordSession {
  readonly id = randomBytes(4).toString("hex");
  status: RecordStatus = "waiting";
  /** What the recording is doing or what went wrong, in a sentence. */
  message: string | null = null;
  readonly steps: RecordEntry[] = [];
  readonly startedAt = new Date().toISOString();
  private session: BrowserSession | null = null;
  private release: (() => void) | null = null;
  private pending: Pending | null = null;
  private lastStepFromRecorder = false;
  private nextStep = 1;
  private touched = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private tmpDir: string;

  constructor(
    readonly opts: RecordOptions,
    private readonly host: RecordHost,
  ) {
    this.tmpDir = path.join(opts.dataDir, "recordings", this.id);
  }

  get viewport(): { width: number; height: number } {
    return this.opts.pack.options.browser?.viewport ?? { width: 1280, height: 800 };
  }

  state() {
    return {
      id: this.id,
      packId: this.opts.packId,
      testId: this.opts.testId,
      status: this.status,
      message: this.message,
      window: this.opts.window,
      viewport: this.viewport,
      startedAt: this.startedAt,
      pages: this.session?.openPages() ?? [],
      activePage: this.session?.activePage ?? null,
      steps: this.steps,
    };
  }

  /** Read through a method so checks after an await aren't narrowed away. */
  ended(): boolean {
    return this.status === "ended";
  }

  private emit(type: string, data: Record<string, unknown>) {
    this.host.events.append(type, data, { runId: this.id });
  }

  private setStatus(status: RecordStatus, message: string | null = null) {
    this.status = status;
    this.message = message;
    this.emit("record.status", { status, message });
  }

  /** Starts once no run of the site is going; until then the status is `waiting`. */
  start(): void {
    this.idleTimer = setInterval(() => {
      if (Date.now() - this.touched > IDLE_LIMIT_MS) void this.stop("Closed after 30 minutes without input.");
    }, 60_000);
    const tryStart = () => {
      if (this.status === "ended") return;
      if (this.host.siteBusy(this.opts.siteKey)) {
        if (this.message === null) this.setStatus("waiting", "A run of this site is going. Recording starts when it ends.");
        this.waitTimer = setTimeout(tryStart, 1000);
        return;
      }
      this.release = this.host.holdSite(this.opts.siteKey);
      void this.launch().catch((err: unknown) => void this.stop(`Couldn't start the browser: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`));
    };
    tryStart();
  }

  private async launch(): Promise<void> {
    this.setStatus("starting");
    const o = this.opts.pack.options;
    const id = this.id;
    this.session = await BrowserSession.launch(
      {
        browser: o.browser?.name ?? "chromium",
        headless: !this.opts.window,
        viewport: this.viewport,
        launch: o.browser?.launch,
        context: o.browser?.context,
        size: o.run?.screencastSize,
        quality: o.run?.frameQuality ?? 70,
        showActions: false,
        trace: false,
      },
      {
        onFrame: (f) => this.host.frames.publish({ runId: id, ...f }),
        onPageOpened: (pageId, url) => this.emit("page.opened", { pageId, url }),
        onPageClosed: (pageId) => {
          this.host.frames.forget(id, pageId);
          this.emit("page.closed", { pageId });
        },
        onPageNavigated: (pageId, url) => this.emit("page.navigated", { pageId, url }),
        onActivePage: (pageId) => this.emit("page.active", { pageId }),
      },
    );
    if (this.ended()) return void (await this.session.close());
    const page = await this.session.mainPage();
    await this.session.restartCapture(null);
    if (this.opts.testId) await this.replay(page);
    if (this.ended()) return;
    if (page.url() === "about:blank") {
      const url = this.opts.url ?? o.site.baseURL;
      if (url) await page.goto(new URL(url, o.site.baseURL ?? url).href).catch((err: unknown) => (this.message = `Couldn't open ${url}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`));
    }
    await hideRecorderToolbar(page);
    await (this.session.context as unknown as RecordingContext)._startRecording(
      { language: "jsonl" },
      {
        actionAdded: (_page, _action, code) => this.onAction(code, false),
        actionUpdated: (_page, _action, code) => this.onAction(code, true),
        signalAdded: () => undefined,
      },
    );
    this.setStatus("recording", this.message);
  }

  /**
   * Record into a test: the pack's `beforeAttempt` (beforeEach) runs first, as before every
   * attempt, then for Record from here the test's steps above the cursor, live. Then the page is
   * handed over in the state the test would be in there.
   */
  private async replay(page: Page): Promise<void> {
    const test = this.opts.pack.tests.find((t) => t.id === this.opts.testId);
    const steps = test?.yaml?.steps.slice(0, this.opts.replay) ?? [];
    const hook = this.opts.pack.options.beforeAttempt;
    if (!test || (steps.length === 0 && !hook)) return;
    this.setStatus("replaying", steps.length === 0 ? "Running the pack's steps before each test…" : `Running the ${steps.length === 1 ? "step" : `${steps.length} steps`} above the cursor…`);
    const session = this.session!;
    const saves = new Map<string, unknown>();
    const control = new RunControl({ onState: () => undefined });
    const recorder = new AttemptRecorder(this.tmpDir, this.opts.dataDir);
    const o = this.opts.pack.options;
    const h = createHelpers(
      {
        page,
        context: session.context as BrowserContext,
        baseURL: o.site.baseURL,
        control,
        recorder,
        session,
        flagKinds: { ...(o.flags ?? {}) },
        idleCheck: o.idle,
        chapters: false,
        save: (k, v) => saves.set(k, v),
        load: (k) => saves.get(k),
        info: () => undefined,
        onStep: (title) => title && this.emit("record.replay-step", { title }),
        onFlag: () => undefined,
      },
      o.helpers,
    );
    try {
      const meta = test.meta;
      await hook?.({ page, h, params: this.opts.params, packDir: this.opts.pack.dir, test: { id: test.id, title: meta.title ?? test.id, section: meta.section ?? null, tags: [...(meta.tags ?? [])] }, attempt: 1, attempts: 1, last: true });
      await runSteps(steps, { page, h, params: this.opts.params, packDir: this.opts.pack.dir, file: path.join(this.opts.pack.dir, test.file), attempt: 1, attempts: 1, last: true });
      this.message = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      this.message = `A step before the cursor didn't work, so recording starts from where it stopped: ${msg}`;
    }
  }

  private onAction(code: string, updated: boolean): void {
    let action: RecorderAction;
    try {
      action = JSON.parse(code) as RecorderAction;
    } catch {
      return;
    }
    const step = stepOfAction(action, this.opts.pack.options.site.baseURL ?? null);
    if (!step) return;
    const last = this.steps.at(-1);
    if (updated && last && this.lastStepFromRecorder && last.name === step.name) {
      const target = last.args.target;
      last.args = { ...step.args, ...(target !== undefined ? { target } : {}) };
      this.emit("record.step-updated", { step: last });
      return;
    }
    const target = step.args.target as Target | undefined;
    let targets: Target[] = target === undefined ? [] : [target];
    let spot: { x: number; y: number } | null = null;
    const p = this.pending;
    if (target !== undefined && p && Date.now() - p.at < 60_000 && (p.selector === null || p.selector === action.selector)) {
      p.selector = action.selector ?? null;
      targets = withAlternatives(target, p.snapshot.targets);
      if ((step.name === "click" || step.name === "dblclick") && step.args.position === undefined) spot = p.snapshot.spot;
    }
    this.add(step.name, step.args, targets, spot, true);
  }

  private add(name: string, args: StepArgs, targets: Target[], spot: { x: number; y: number } | null, fromRecorder: boolean, index?: number): RecordEntry {
    const entry: RecordEntry = { id: `s${this.nextStep++}`, name, args, targets, spot };
    const at = index === undefined ? this.steps.length : Math.max(0, Math.min(index, this.steps.length));
    this.steps.splice(at, 0, entry);
    this.lastStepFromRecorder = fromRecorder && at === this.steps.length - 1;
    this.emit("record.step", { step: entry, index: at });
    return entry;
  }

  /** A step from the tools (Check, Shot, Note, Wait for), at the end or at `index`. */
  addStep(name: string, args: StepArgs, targets: Target[] = [], index?: number): RecordEntry {
    this.touched = Date.now();
    return this.add(name, args, targets, null, false, index);
  }

  updateStep(id: string, change: { name?: string; args?: StepArgs }): RecordEntry | null {
    const entry = this.steps.find((s) => s.id === id);
    if (!entry) return null;
    if (change.name !== undefined) entry.name = change.name;
    if (change.args !== undefined) {
      entry.args = change.args;
      const t = change.args.target as Target | undefined;
      if (t !== undefined && !entry.targets.some((o) => sameTarget(o, t))) entry.targets = [t, ...entry.targets];
    }
    if (this.steps.at(-1) === entry) this.lastStepFromRecorder = false;
    this.emit("record.step-updated", { step: entry });
    return entry;
  }

  removeStep(id: string): boolean {
    const at = this.steps.findIndex((s) => s.id === id);
    if (at < 0) return false;
    this.steps.splice(at, 1);
    if (at === this.steps.length) this.lastStepFromRecorder = false;
    this.emit("record.step-removed", { id });
    return true;
  }

  private page(): Page {
    if (this.status !== "recording" || !this.session) throw new RecordNotReady(this.status);
    const id = this.session.activePage;
    const entry = this.session.openPages().find((p) => p.id === id);
    const page = entry ? this.findPage(entry.id) : null;
    if (!page) throw new RecordNotReady(this.status);
    return page;
  }

  private findPage(pageId: string): Page | null {
    for (const page of this.session?.context.pages() ?? []) if (this.session?.pageId(page) === pageId) return page;
    return null;
  }

  /** Sends one input from the live view to the active page. */
  async input(i: RecordInput): Promise<void> {
    this.touched = Date.now();
    const page = this.page();
    const m = page.mouse;
    switch (i.type) {
      case "click":
      case "dblclick":
      case "down":
        await this.remember(page, i.x, i.y);
        if (i.type === "click") await m.click(i.x, i.y, { button: i.button ?? "left" });
        else if (i.type === "dblclick") await m.dblclick(i.x, i.y, { button: i.button ?? "left" });
        else {
          await m.move(i.x, i.y);
          await m.down({ button: i.button ?? "left", clickCount: ("clickCount" in i && i.clickCount) || 1 });
        }
        return;
      case "move":
        return m.move(i.x, i.y);
      case "up":
        await m.move(i.x, i.y);
        return m.up({ button: i.button ?? "left", clickCount: i.clickCount ?? 1 });
      case "wheel":
        await m.move(i.x, i.y);
        return m.wheel(i.deltaX, i.deltaY);
      case "key":
        return page.keyboard.press(i.key);
      case "text":
        return page.keyboard.insertText(i.text);
      case "goto":
        await page.goto(new URL(i.url, this.opts.pack.options.site.baseURL ?? page.url()).href);
        return;
      case "back":
        await page.goBack();
        return;
      case "reload":
        await page.reload();
        return;
    }
  }

  /** Reads the element under a pointer press before the press lands, for the step it makes. */
  private async remember(page: Page, x: number, y: number): Promise<void> {
    const snap = await withTimeout(snapshotAt(page, x, y), 1500).catch(() => null);
    if (snap) {
      await snap.element.dispose().catch(() => undefined);
      this.pending = { snapshot: { info: snap.info, targets: snap.targets, groups: snap.groups, spot: snap.spot }, at: Date.now(), selector: null };
    } else this.pending = null;
  }

  /** The element under a point and its targets, for Check, Wait for and Shot. */
  async pick(x: number, y: number): Promise<(Omit<Snapshot, "spot"> & { info: ElementInfo }) | null> {
    this.touched = Date.now();
    const snap = await snapshotAt(this.page(), x, y);
    if (!snap) return null;
    await snap.element.dispose().catch(() => undefined);
    return { info: snap.info, targets: snap.targets, groups: snap.groups };
  }

  setActivePage(pageId: string): boolean {
    const page = this.findPage(pageId);
    if (!page || !this.session) return false;
    this.session.setActive(page);
    void page.bringToFront().catch(() => undefined);
    return true;
  }

  /** Ends the recording and closes its browser. The steps stay readable. */
  async stop(message: string | null = null): Promise<void> {
    if (this.status === "ended") return;
    const wasRecording = this.status === "recording";
    this.status = "ended";
    this.message = message;
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.waitTimer) clearTimeout(this.waitTimer);
    const session = this.session;
    if (session) {
      if (wasRecording) await (session.context as unknown as RecordingContext)._stopRecording().catch(() => undefined);
      await session.stopCapture().catch(() => undefined);
      await session.close();
    }
    this.release?.();
    this.release = null;
    this.host.frames.forget(this.id);
    rmSync(this.tmpDir, { recursive: true, force: true });
    this.emit("record.ended", { message, steps: this.steps.length });
  }
}

export class RecordNotReady extends Error {
  constructor(readonly status: RecordStatus) {
    super(status === "ended" ? "This recording has ended." : "The recording browser isn't ready yet.");
  }
}

/**
 * Playwright's recorder draws its own toolbar on the page (record, pick, assert), which would show
 * on the live view and take clicks. The live view has its own tools. A context has one recorder,
 * made by whichever call needs it first, and the one `pickLocator` makes has no toolbar: so start
 * a pick and cancel it before recording starts.
 */
async function hideRecorderToolbar(page: Page): Promise<void> {
  let settled = false;
  const pick = page.pickLocator().then(
    () => undefined,
    () => undefined,
  );
  void pick.then(() => (settled = true));
  for (let i = 0; i < 40 && !settled; i++) {
    await page.cancelPickLocator().catch(() => undefined);
    await Promise.race([pick, new Promise((r) => setTimeout(r, 50))]);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
