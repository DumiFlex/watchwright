import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hasDesktop } from "../../host.js";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { EventLog } from "../../events/log.js";
import { AttemptAborted, RunControl, type BrokenDecision } from "../../jobs/control.js";
import type { AttemptEnv, JobKind, KindPlan, PlanItem } from "../../jobs/kind.js";
import type { JobKinds } from "../../jobs/kinds.js";
import type { AttemptRuntime } from "../../jobs/runtime.js";
import { AttemptRecorder, MAX_LOG_LINES, safeRelative, slug, type ArtifactInfo } from "../../jobs/recorder.js";
import { findFfmpeg, nextRunVideoFile, RunVideo, runVideoFiles } from "../../jobs/run-video.js";
import { dirSize, driveSpace, GB, sizeText } from "../../jobs/storage.js";
import { unzip, zip } from "../../jobs/zip.js";
import { BrowserSession } from "../../session/session.js";
import type { FrameHub } from "../live/hub.js";
import { StepError, type Collector, type CollectorAttempt, type CollectorRecord, type Outcome, type ParamValues, videoMode, type VideoMode, type VideoSetting } from "../packs/api.js";
import type { LoadedPack } from "../packs/loader.js";
import { parentsOf, resolveParams } from "../packs/order.js";
import type { PackRegistry } from "../packs/registry.js";
import {
  attemptSummary,
  DECIDED,
  newId,
  runSummary,
  type AttemptStatus,
  type AttemptSummary,
  type HistoryEntry,
  type PlanEntry,
  type RunMode,
  type RunOptions,
  type RunFilter,
  type RunRow,
  type RunsRepo,
  type RunSummary,
} from "./repo.js";
import { QueueError, RunQueue } from "./queue.js";
import { dayList, dayOf, dayStart, runStats, type RunStats } from "./stats.js";
import { fileUrl, resultDocument, type ResultDocument } from "./results.js";

// The job runner: queue and site locks, one browser session per run, attempts with pause, retry,
// skip, stop and hot reload, resume after a crash, redo of broken attempts (docs/plan.md, section 6).

export const DEFAULT_TEST_TIMEOUT = 30 * 60_000;
/** Most items a job kind can add to one run (`AttemptEnv.addItem`). */
export const MAX_ADDED_ITEMS = 10_000;
/** Added items are written to the store and announced in batches, at most this often. */
const ADDED_FLUSH_MS = 250;
export const DEFAULT_PAUSE_LIMIT_MINUTES = 20;
/** How long a timed-out attempt gets to reach its next pause point before the context is replaced. */
const ABORT_GRACE_MS = 10_000;
/** After "stop now", how long the attempt's body gets to notice before it is filed as stopped anyway. */
const STOP_GRACE_MS = 5_000;
/** How long a pack or collector hook may take before the attempt goes on without it. */
const HOOK_LIMIT_MS = 120_000;

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface StartInput {
  packId: string;
  tests?: string[] | undefined;
  params?: Record<string, unknown> | undefined;
  startedBy: string;
  options?: RunOptions | undefined;
  label?: string | undefined;
  /** The job kind (default `test`). */
  kind?: string | undefined;
}

export interface RunPreview {
  /** The parameter values with defaults filled in. */
  params: ParamValues;
  /** Number of attempts (children not counted). */
  attempts: number;
  plan: PlanEntry[];
  /** Tests that run although they weren't chosen: needed by a chosen test, the parent of one, or run inside one. */
  joined: { testId: string; reason: "needed" | "parent" | "inside"; of: string[] }[];
}

export interface LiveSnapshot {
  state: "running" | "pausing" | "paused";
  pauseReason: "manual" | "broken" | null;
  /** Who asked for a manual pause (`web`, an agent's name, …). */
  pausedBy: string | null;
  /** When a broken pause skips by itself. */
  deadline: string | null;
  stopping: "after" | "now" | null;
  attemptId: string | null;
  testId: string | null;
  step: string | null;
  pages: { id: string; url: string }[];
  activePageId: string | null;
  /** The settings in effect, which `runs.settings` changes; null while the run sets up. */
  settings: RunSettings | null;
  /** Set once the drive ran low during the run: its free bytes, and whether videos stopped. */
  storageLow: { freeBytes: number; videosOff: boolean } | null;
}

export interface StorageReport {
  /** The data folder; runs are in its `runs/`. */
  dataDir: string;
  /** Free and total bytes of its drive; null when the system can't say. */
  freeBytes: number | null;
  totalBytes: number | null;
  runs: number;
  /** Bytes every measured run takes. */
  runsBytes: number;
  /** Runs not measured yet (they are measured in the background after a start). */
  unmeasured: number;
  largest: RunSummary[];
  limits: StorageLimits;
}

/** Which ended runs cleanup keeps. 0 turns a rule off; a run is kept when any rule keeps it, and a labeled run always is. */
export interface CleanupRules {
  keepDays: number;
  keepPerPack: number;
}

/** What a cleanup deletes (or deleted): the runs, oldest first, and the room they take. */
export interface CleanupPlan {
  rules: CleanupRules;
  runs: RunSummary[];
  bytes: number;
  /** Of `runs`, how many aren't measured yet, so `bytes` leaves them out. */
  unmeasured: number;
}

/** What can change while a run goes (`runs.settings`), as in effect. */
export interface RunSettings {
  pauseOnBroken: boolean;
  pauseLimitMinutes: number;
  /** The run's time limit for every attempt; null when each test's (or the pack's) limit holds. */
  testTimeoutMinutes: number | null;
  trace: "problems" | "always" | "never";
  video: VideoMode;
  runVideo: boolean;
}

/** A change to a run's settings; fields left out stay. `testTimeoutMinutes: null` goes back to each test's own limit. */
export type SettingsChange = Partial<Omit<RunSettings, "testTimeoutMinutes" | "video">> & { testTimeoutMinutes?: number | null; video?: VideoSetting };

export interface RunDetail extends RunSummary {
  plan: (PlanEntry & { status: AttemptStatus | "pending"; attemptId: string | null })[];
  attempts: AttemptSummary[];
  live: LiveSnapshot | null;
  /** Videos of the whole run (`runVideo`), in order: a resumed run, or one switched off and on, adds a part. */
  runVideos: { path: string; url: string; size: number }[];
}

interface ActiveRun {
  id: string;
  siteKey: string;
  control: RunControl;
  session: BrowserSession | null;
  attemptId: string | null;
  testId: string | null;
  step: string | null;
  /** Who asked for the manual pause going on now. */
  pausedBy: string | null;
  state: Record<string, unknown>;
  /** Facts the run saved with `info(key, value)`. */
  info: Record<string, string | number | boolean>;
  collected: Map<string, CollectorRecord[]>;
  shutdown: boolean;
  done: Promise<void>;
  videoWarned: boolean;
  /** The video of the whole run while one is recorded. */
  runVideo: RunVideo | null;
  runVideoWarned: boolean;
  /** Set once the run is planned and set up. */
  ctx: RunCtx | null;
  /** The recorder of the top-level attempt that is running, for marks. */
  recorder: AttemptRecorder | null;
  /** Bytes the run's folder takes, measured every so often while it goes. */
  sizeBytes: number | null;
  /** Set once the drive ran low during the run: free bytes then, and whether videos stopped. */
  storageLow: { freeBytes: number; videosOff: boolean } | null;
  storageTimer: ReturnType<typeof setInterval> | null;
}

interface RunCtx {
  row: RunRow;
  run: ActiveRun;
  kind: JobKind;
  pack: LoadedPack;
  params: ParamValues;
  plan: KindPlan;
  mode: RunMode;
  options: RunOptions;
  queue: RunQueue;
  pauseOnBroken: boolean;
  pauseLimitMs: number;
  /** For children with several parents: which parent test ran each `child#number`. */
  childRanIn: Map<string, { parent: string; outcome: Outcome }>;
  /** Top-level attempts this run goes through (by mode), as `test#number`. */
  todo: Set<string>;
  /** Set once the run has gone through its queue, so it takes no more edits. */
  ended: boolean;
  /** Items added since the last write to the store, and the timer that writes them. */
  addedBatch: string[];
  addedFlush: ReturnType<typeof setTimeout> | null;
  addedLimitHit: boolean;
}

/** A kind's plan plus the items it added while the run went, as each run (and resume) sees it. */
function withAdded(plan: KindPlan, added: RunOptions["added"]): KindPlan {
  const have = new Set(plan.items.map((i) => i.itemId));
  const extra = (added ?? []).filter((a) => !have.has(a.itemId)).flatMap((a) => Array.from({ length: a.of }, (_, n) => ({ itemId: a.itemId, number: n + 1, of: a.of })));
  return extra.length === 0 ? plan : { ...plan, items: [...plan.items, ...extra] };
}

export interface StorageLimits {
  warnBelowGB: number;
  stopBelowGB: number;
}

export const DEFAULT_STORAGE_LIMITS: StorageLimits = { warnBelowGB: 5, stopBelowGB: 1 };
const STORAGE_CHECK_MS = 60_000;

export interface EngineOptions {
  repo: RunsRepo;
  events: EventLog;
  packs: PackRegistry;
  frames: FrameHub;
  /** Folder that holds `runs/`; artifact paths are relative to it. */
  dataDir: string;
  kinds: JobKinds;
  /** Secrets for `h.secret` and `${secret.…}`; every value is masked in what runs record and announce. */
  secrets?: { get(name: string): string | undefined; mask(text: string): string; maskBytes?(data: Buffer): Buffer | null } | undefined;
  /** Saved sign-ins: runs that start signed in get the site's storage state, and `h.saveSignIn` saves one. */
  signIns?: { get(siteKey: string): StorageState | undefined; save(siteKey: string, state: StorageState, source: string): unknown } | undefined;
  /** Runners: runs whose `network` names one send their browser's connections through it (a proxy per run). */
  runners?: { proxy(name: string, onRefused: (message: string) => void): Promise<{ server: string; close(): Promise<void> }> } | undefined;
  /** Free space on the drive below which a run warns, and below which it stops recording videos (the settings; 5 and 1 GB by default). */
  storageLimits?: (() => StorageLimits) | undefined;
  /** How long ended runs are kept (Settings > Storage); both 0, the default, keeps every run. */
  cleanupRules?: (() => CleanupRules) | undefined;
  /** How often a going run measures its folder and the drive's free space (default once a minute). */
  storageCheckMs?: number | undefined;
}

/** A copy of `value` with `mask` applied to every string in it (event data, attempt results). */
export function maskDeep<T>(value: T, mask: (s: string) => string): T {
  if (typeof value === "string") return mask(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => maskDeep(v, mask)) as T;
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, mask)])) as T;
  return value;
}

/** A browser context's cookies and local storage, as Playwright saves them. */
export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export class Engine {
  private readonly active = new Map<string, ActiveRun>();
  private closing = false;

  constructor(private readonly o: EngineOptions) {}

  /** On boot: runs a crash left running become interrupted, ready for resume. */
  recover(): void {
    for (const id of this.o.repo.interruptLeftovers()) this.o.events.append("run.interrupted", { reason: "server_stopped" }, { runId: id });
  }

  /**
   * Once the server is up again: the runs its last stop (or a crash) interrupted. With `resume`
   * (the `runs.resumeOnStart` setting) they continue where they were. Either way one
   * `runs.restarted` event lists them, for alerts. Each run is handled once.
   */
  afterRestart(resume: boolean): { interrupted: string[]; resumed: string[] } {
    if (this.closing) return { interrupted: [], resumed: [] };
    const interrupted = this.o.repo.takeStoppedByServer();
    const resumed: string[] = [];
    for (const id of interrupted) {
      if (!resume) continue;
      try {
        this.resume(id);
        resumed.push(id);
        this.o.events.append("run.log", { level: "info", message: "Watchwright started again: the run goes on where it was (Settings > New run > Resume interrupted runs)." }, { runId: id });
      } catch (err) {
        this.o.events.append("run.log", { level: "warn", message: `Watchwright started again but couldn't resume the run: ${err instanceof Error ? err.message : String(err)}` }, { runId: id });
      }
    }
    if (interrupted.length) this.o.events.append("runs.restarted", { interrupted, resumed });
    return { interrupted, resumed };
  }

  /** Runs and outcomes per day for the `days` days ending today, in a time zone `offset` minutes behind UTC. */
  stats(o: { days: number; offset: number; packId?: string | undefined; until?: string | undefined }): RunStats {
    const until = o.until ?? dayOf(new Date().toISOString(), o.offset);
    const from = dayStart(dayList(until, o.days * 2)[0]!, o.offset);
    return runStats(this.o.repo.statsRows(from, o.packId), { until, days: o.days, offset: o.offset });
  }

  testHistory(packId: string, limit: number): Record<string, HistoryEntry[]> {
    return this.o.repo.history(packId, limit);
  }

  list(filter: RunFilter = {}): RunSummary[] {
    return this.o.repo.runs(filter).map((r) => this.summary(r));
  }

  /** A run's summary; a going run's size is the one measured last. */
  private summary(r: RunRow): RunSummary {
    const s = runSummary(r, this.o.repo.counts(r.id));
    const run = this.active.get(r.id);
    return run && run.sizeBytes !== null ? { ...s, sizeBytes: run.sizeBytes } : s;
  }

  /** Measures a run's folder and keeps the size with the run, unless it is going (then it changes). */
  async measure(id: string): Promise<number | null> {
    if (this.active.has(id)) return null;
    return this.keepSize(id, () => !this.active.has(id));
  }

  private async keepSize(id: string, still: () => boolean = () => true): Promise<number | null> {
    try {
      const bytes = await dirSize(path.join(this.o.dataDir, "runs", id));
      // Deleted or started again while measuring, or the server is closing.
      if (!still() || !this.o.repo.run(id)) return null;
      this.o.repo.updateRun(id, { size_bytes: bytes });
      this.o.events.append("run.measured", { sizeBytes: bytes }, { runId: id });
      return bytes;
    } catch {
      return null;
    }
  }

  /** Measures every ended run whose size isn't known yet (runs from before sizes were kept), one at a time. */
  async measureMissing(): Promise<number> {
    let n = 0;
    for (const id of this.o.repo.unmeasured()) {
      if (this.closing) break;
      if ((await this.measure(id)) !== null) n++;
    }
    return n;
  }

  /** What runs take on the drive, and how much room the drive has left. */
  async storage(top = 10): Promise<StorageReport> {
    for (const run of this.active.values()) if (run.sizeBytes === null) run.sizeBytes = await dirSize(path.join(this.o.dataDir, "runs", run.id));
    const totals = this.o.repo.sizeTotals();
    const going = [...this.active.values()].reduce((s, r) => s + (r.sizeBytes ?? 0), 0);
    const drive = await driveSpace(this.o.dataDir);
    return {
      dataDir: this.o.dataDir,
      freeBytes: drive?.freeBytes ?? null,
      totalBytes: drive?.totalBytes ?? null,
      runs: totals.runs,
      runsBytes: totals.bytes + going,
      unmeasured: Math.max(0, totals.unmeasured - this.active.size),
      largest: this.o.repo.largest(top).map((r) => this.summary(r)),
      limits: this.limits(),
    };
  }

  /** The ended runs the cleanup rules don't keep, oldest first. */
  cleanupPlan(rules: CleanupRules = this.cleanupRules()): CleanupPlan {
    const runs = this.o.repo
      .cleanupCandidates(rules)
      .filter((r) => !this.active.has(r.id))
      .map((r) => this.summary(r));
    return { rules, runs, bytes: runs.reduce((n, r) => n + (r.sizeBytes ?? 0), 0), unmeasured: runs.filter((r) => r.sizeBytes == null).length };
  }

  /** Deletes the runs `cleanupPlan` lists, the same way `delete` does. `by` says who asked (`schedule` for the daily sweep). */
  async cleanup(by: string): Promise<CleanupPlan> {
    const plan = this.cleanupPlan();
    const done: RunSummary[] = [];
    for (const r of plan.runs) {
      if (this.closing) break;
      try {
        await this.delete(r.id);
        done.push(r);
      } catch {
        // Started again (redo, resume) since the plan: keep it.
      }
    }
    const result = { ...plan, runs: done, bytes: done.reduce((n, r) => n + (r.sizeBytes ?? 0), 0), unmeasured: done.filter((r) => r.sizeBytes == null).length };
    if (done.length) this.o.events.append("runs.cleaned", { by, count: done.length, bytes: result.bytes, rules: plan.rules });
    return result;
  }

  private cleanupRules(): CleanupRules {
    return this.o.cleanupRules?.() ?? { keepDays: 0, keepPerPack: 0 };
  }

  private limits(): StorageLimits {
    return this.o.storageLimits?.() ?? DEFAULT_STORAGE_LIMITS;
  }

  /**
   * Measures a going run's folder and checks the drive. Below the warning line it says so once
   * (a log line, `storage.low` for alerts, a banner); below the floor it stops recording videos
   * for the rest of the run so the run can finish without filling the drive. It never stops a run.
   */
  private async checkStorage(run: ActiveRun): Promise<void> {
    const size = await dirSize(path.join(this.o.dataDir, "runs", run.id));
    if (size !== run.sizeBytes && this.active.has(run.id)) this.o.events.append("run.measured", { sizeBytes: size }, { runId: run.id });
    run.sizeBytes = size;
    const drive = await driveSpace(this.o.dataDir);
    if (!drive || !this.active.has(run.id)) return;
    const { warnBelowGB, stopBelowGB } = this.limits();
    const free = drive.freeBytes;
    if (free < stopBelowGB * GB && !run.storageLow?.videosOff) {
      run.storageLow = { freeBytes: free, videosOff: true };
      await this.stopRunVideo(run);
      this.emit("run.log", { level: "warn", message: `Only ${sizeText(free)} free on the drive with the data folder (under ${stopBelowGB} GB): this run records no more videos. Free some room, or delete old runs in Settings > Storage.` }, run.id);
      this.emit("storage.low", { freeBytes: free, warnBelowGB, stopBelowGB, videosOff: true }, run.id);
    } else if (free < warnBelowGB * GB && !run.storageLow) {
      run.storageLow = { freeBytes: free, videosOff: false };
      this.emit("run.log", { level: "warn", message: `Only ${sizeText(free)} free on the drive with the data folder (under ${warnBelowGB} GB). Below ${stopBelowGB} GB, runs stop recording videos.` }, run.id);
      this.emit("storage.low", { freeBytes: free, warnBelowGB, stopBelowGB, videosOff: false }, run.id);
    } else if (run.storageLow) run.storageLow = { ...run.storageLow, freeBytes: free };
  }

  private planEntries(kind: JobKind, pack: LoadedPack, plan: KindPlan, queue: RunQueue): PlanEntry[] {
    return queue.items.map((i) => {
      const children = plan.children.get(i.itemId);
      return {
        testId: i.itemId,
        title: kind.describe(pack, i.itemId).title,
        number: i.number,
        of: i.of,
        ...(children && children.length > 0 ? { children } : {}),
        ...(queue.isSkipped(i) ? { skip: true } : {}),
      };
    });
  }

  /** Applies a queue edit to a run that is going, keeps it with the run and tells viewers. */
  private editQueue(id: string, edit: (q: RunQueue) => void): RunDetail {
    const run = this.requireActive(id);
    const ctx = run.ctx;
    if (!ctx) throw new EngineError("not_running", "The run is still setting up; try again in a moment.", 409);
    if (ctx.ended) throw new EngineError("not_running", "The run has gone through its queue.", 409);
    try {
      edit(ctx.queue);
    } catch (err) {
      if (err instanceof QueueError) throw new EngineError("bad_input", err.message);
      throw err;
    }
    ctx.options = { ...ctx.options, queue: ctx.queue.edits() };
    const entries = this.planEntries(ctx.kind, ctx.pack, ctx.plan, ctx.queue);
    this.o.repo.updateRun(id, { plan: JSON.stringify(entries), options: JSON.stringify(ctx.options) });
    this.emit("run.planned", { plan: entries }, id);
    return this.get(id)!;
  }

  private settingsOf(ctx: RunCtx): RunSettings {
    const o = ctx.pack.options.run ?? {};
    return {
      pauseOnBroken: ctx.pauseOnBroken,
      pauseLimitMinutes: ctx.pauseLimitMs / 60_000,
      testTimeoutMinutes: ctx.options.testTimeout === undefined ? null : ctx.options.testTimeout / 60_000,
      trace: ctx.options.trace ?? o.trace ?? "problems",
      video: videoMode(ctx.options.video ?? o.video ?? "always"),
      runVideo: ctx.run.runVideo !== null,
    };
  }

  /**
   * Changes the settings of a run that is going or queued. They are kept with the run (a resume
   * keeps them) and take effect at the next attempt; a new pause limit applies at once to a broken
   * pause that is going, counted from when it began.
   */
  async changeSettings(id: string, change: SettingsChange, by = "api"): Promise<RunDetail> {
    const r = this.requireRun(id);
    const keys = (Object.keys(change) as (keyof SettingsChange)[]).filter((k) => change[k] !== undefined);
    if (keys.length === 0) throw new EngineError("bad_input", "Name at least one setting to change.");
    const apply = (options: RunOptions): RunOptions => {
      const next: RunOptions = { ...options };
      if (change.pauseOnBroken !== undefined) next.pauseOnBroken = change.pauseOnBroken;
      if (change.pauseLimitMinutes !== undefined) next.pauseLimitMinutes = change.pauseLimitMinutes;
      if (change.trace !== undefined) next.trace = change.trace;
      if (change.video !== undefined) next.video = change.video;
      if (change.runVideo !== undefined) next.runVideo = change.runVideo;
      if (change.testTimeoutMinutes === null) delete next.testTimeout;
      else if (change.testTimeoutMinutes !== undefined) next.testTimeout = Math.round(change.testTimeoutMinutes * 60_000);
      return next;
    };
    const changed = Object.fromEntries(keys.map((k) => [k, change[k]]));
    if (r.status === "queued") {
      this.o.repo.updateRun(id, { options: JSON.stringify(apply(JSON.parse(r.options) as RunOptions)) });
      this.emit("run.settings", { changed, by }, id);
      return this.get(id)!;
    }
    const run = this.active.get(id);
    if (!run) throw new EngineError("not_running", "Only a run that is going or queued takes new settings.", 409);
    const ctx = run.ctx;
    if (!ctx) throw new EngineError("not_running", "The run is still setting up; try again in a moment.", 409);
    ctx.options = apply(ctx.options);
    if (change.pauseOnBroken !== undefined) ctx.pauseOnBroken = change.pauseOnBroken;
    let deadline: string | null = null;
    if (change.pauseLimitMinutes !== undefined) {
      ctx.pauseLimitMs = change.pauseLimitMinutes * 60_000;
      deadline = run.control.setBrokenLimit(ctx.pauseLimitMs);
    }
    if (change.runVideo === true) this.startRunVideo(run);
    if (change.runVideo === false) await this.stopRunVideo(run);
    this.o.repo.updateRun(id, { options: JSON.stringify(ctx.options) });
    this.emit("run.settings", { changed, by, settings: this.settingsOf(ctx), ...(deadline ? { deadline } : {}) }, id);
    return this.get(id)!;
  }

  /** Skips an attempt that hasn't started (or takes the skip back with `on` false). */
  queueSkip(id: string, testId: string, number: number, on: boolean): RunDetail {
    return this.editQueue(id, (q) => q.skip(testId, number, on));
  }

  /** Moves a test that hasn't started one place up or down. */
  queueMove(id: string, testId: string, direction: "up" | "down"): RunDetail {
    return this.editQueue(id, (q) => q.move(testId, direction));
  }

  /** A kind adds an item to its running run (`AttemptEnv.addItem`). */
  private addItem(ctx: RunCtx, itemId: string, attempts: number): boolean {
    if (ctx.ended || ctx.plan.items.some((i) => i.itemId === itemId)) return false;
    const added = ctx.options.added ?? [];
    if (added.length >= MAX_ADDED_ITEMS) {
      if (!ctx.addedLimitHit) {
        ctx.addedLimitHit = true;
        this.setInfo(ctx.run, "added items limit", MAX_ADDED_ITEMS);
        this.emit("run.log", { level: "warn", message: `The run has added ${MAX_ADDED_ITEMS} items, its limit; it adds no more.` }, ctx.row.id);
      }
      return false;
    }
    const of = Math.max(1, Math.min(100, Math.floor(attempts)));
    const items = Array.from({ length: of }, (_, n) => ({ itemId, number: n + 1, of }));
    ctx.plan = { ...ctx.plan, items: [...ctx.plan.items, ...items] };
    ctx.queue.extend(ctx.plan);
    for (const i of items) ctx.todo.add(`${i.itemId}#${i.number}`);
    ctx.options = { ...ctx.options, added: [...added, { itemId, of }] };
    ctx.addedBatch.push(itemId);
    ctx.addedFlush ??= setTimeout(() => this.flushAdded(ctx), ADDED_FLUSH_MS);
    return true;
  }

  /** Writes items added since the last flush to the store and tells viewers, in one event. */
  private flushAdded(ctx: RunCtx): void {
    if (ctx.addedFlush) clearTimeout(ctx.addedFlush);
    ctx.addedFlush = null;
    if (ctx.addedBatch.length === 0) return;
    const items = ctx.addedBatch.splice(0);
    ctx.options = { ...ctx.options, queue: ctx.queue.edits() };
    const entries = this.planEntries(ctx.kind, ctx.pack, ctx.plan, ctx.queue);
    this.o.repo.updateRun(ctx.row.id, { plan: JSON.stringify(entries), options: JSON.stringify(ctx.options) });
    this.emit("run.items-added", { items, total: ctx.options.added?.length ?? 0 }, ctx.row.id);
  }

  /** Adds tests to a run that is going: they (and what they need that the run doesn't have) go at the end of the queue. */
  async addTests(id: string, tests: string[]): Promise<RunDetail> {
    const run = this.requireActive(id);
    const ctx = run.ctx;
    if (!ctx) throw new EngineError("not_running", "The run is still setting up; try again in a moment.", 409);
    if (ctx.ended) throw new EngineError("not_running", "The run has gone through its queue.", 409);
    // A test written since the run started can be added, so take the pack as it is now.
    const r = await this.o.packs.refresh(ctx.row.pack_id, ctx.pack);
    if (r.reloaded) {
      ctx.pack = r.pack;
      this.emit("pack.reloaded", { packId: ctx.row.pack_id }, id);
    }
    const top = [...new Set(ctx.plan.items.map((i) => i.itemId))];
    const inRun = new Set([...top, ...top.flatMap((t) => ctx.plan.children.get(t) ?? [])]);
    const fresh = [...new Set(tests)].filter((t) => !inRun.has(t));
    if (fresh.length === 0) throw new EngineError("bad_input", tests.length === 1 ? `${tests[0]} is already in the run.` : "Those tests are already in the run.");
    const chosen = JSON.parse(ctx.row.tests) as string[];
    const all = [...(chosen.length > 0 ? chosen : top), ...fresh];
    let plan: KindPlan;
    try {
      plan = withAdded(ctx.kind.plan(ctx.pack, ctx.params, all, { attempts: ctx.options.attempts }), ctx.options.added);
    } catch (err) {
      throw new EngineError("bad_input", err instanceof Error ? err.message : String(err));
    }
    const added = ctx.queue.extend(plan);
    ctx.plan = plan;
    for (const i of added) ctx.todo.add(`${i.itemId}#${i.number}`);
    ctx.row.tests = JSON.stringify(all);
    ctx.options = { ...ctx.options, queue: ctx.queue.edits() };
    const entries = this.planEntries(ctx.kind, ctx.pack, ctx.plan, ctx.queue);
    this.o.repo.updateRun(id, { tests: ctx.row.tests, plan: JSON.stringify(entries), options: JSON.stringify(ctx.options) });
    this.emit("run.tests-added", { tests: fresh, attempts: added.length }, id);
    this.emit("run.planned", { plan: entries }, id);
    return this.get(id)!;
  }

  /**
   * Saves what the live view shows now (the newest frame of the followed page), or a frame of the
   * rewind buffer with `back`, with a note, on the attempt that is running.
   */
  mark(id: string, note: string, back?: { pageId?: string | undefined; at: number }): { attemptId: string; artifact: ArtifactInfo & { url: string } } {
    const run = this.requireActive(id);
    const recorder = run.recorder;
    if (!recorder || !run.attemptId) throw new EngineError("not_running", "No test is running right now, so there is nothing to mark.", 409);
    let frame;
    if (back) {
      const pageId = back.pageId ?? run.session?.activePage ?? "";
      frame = this.o.frames.frameAt(id, pageId, back.at);
      if (!frame) throw new EngineError("no_frame", "That moment is no longer in the rewind buffer.", 409);
    } else {
      const frames = this.o.frames.latestFrames(id);
      frame = frames.find((f) => f.pageId === run.session?.activePage) ?? frames[frames.length - 1];
      if (!frame) throw new EngineError("no_frame", "The live view has no picture yet.", 409);
    }
    const text = note.trim();
    const artifact = recorder.write("mark", text || "Mark", recorder.numberedName("mark", ".jpg"), frame.data, "image/jpeg");
    recorder.notes.push(text ? `Mark ${path.posix.basename(artifact.path)}: ${text}` : `Mark ${path.posix.basename(artifact.path)}`);
    recorder.addLog("info", text ? `Marked: ${text}` : "Marked");
    return { attemptId: run.attemptId, artifact: { ...artifact, url: fileUrl(artifact.path) } };
  }

  /** Deletes a run that isn't queued or going, with its rows and its folder. */
  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const r = this.requireRun(id);
    if (this.active.has(id) || r.status === "queued") throw new EngineError("conflict", "Stop the run before deleting it.", 409);
    this.o.repo.deleteRun(id);
    await rm(path.join(this.o.dataDir, "runs", id), { recursive: true, force: true });
    this.o.events.forgetRun(id);
    this.o.events.append("run.deleted", {}, { runId: id });
    return { id, deleted: true };
  }

  get(id: string): RunDetail | null {
    const r = this.o.repo.run(id);
    if (!r) return null;
    const attempts = this.o.repo.attempts(id).map(attemptSummary);
    const byKey = new Map(attempts.filter((a) => a.parentId === null).map((a) => [`${a.testId}#${a.number}`, a]));
    const plan = (JSON.parse(r.plan) as PlanEntry[]).map((p) => {
      const a = byKey.get(`${p.testId}#${p.number}`);
      return { ...p, status: a?.status ?? ("pending" as const), attemptId: a?.id ?? null };
    });
    const runVideos = runVideoFiles(path.join(this.o.dataDir, "runs", id)).map((v) => {
      const rel = `runs/${id}/${v.name}`;
      return { path: rel, url: fileUrl(rel), size: v.size };
    });
    return { ...this.summary(r), plan, attempts, live: this.snapshot(id), runVideos };
  }

  /** A run's status alone, from one row: cheap enough to check on every event. Null when there is no such run. */
  status(id: string): RunRow["status"] | null {
    return this.o.repo.run(id)?.status ?? null;
  }

  history(id: string): AttemptSummary[] {
    return this.o.repo.attempts(id, true).map(attemptSummary);
  }

  result(runId: string, attemptId: string): ResultDocument | null {
    const a = this.o.repo.attempt(attemptId);
    if (!a || a.run_id !== runId) return null;
    return resultDocument(a, this.o.repo.artifacts(attemptId));
  }

  private snapshot(id: string): LiveSnapshot | null {
    const run = this.active.get(id);
    if (!run) return null;
    return {
      state: run.control.state,
      pauseReason: run.control.reason,
      pausedBy: run.control.reason === "manual" ? run.pausedBy : null,
      deadline: run.control.deadline,
      stopping: run.control.stopMode,
      attemptId: run.attemptId,
      testId: run.testId,
      step: run.step,
      pages: run.session?.openPages() ?? [],
      activePageId: run.session?.activePage ?? null,
      settings: run.ctx ? this.settingsOf(run.ctx) : null,
      storageLow: run.storageLow,
    };
  }

  /** Checks a start request and plans it: the pack must load, the params and tests must fit. */
  private async prepare(input: Omit<StartInput, "startedBy">): Promise<{ pack: LoadedPack; kind: JobKind; params: ParamValues; plan: KindPlan }> {
    const info = this.o.packs.get(input.packId);
    if (!info) throw new EngineError("not_found", `No pack with id ${input.packId}.`, 404);
    let pack: LoadedPack;
    try {
      pack = await this.o.packs.current(input.packId);
    } catch (err) {
      throw new EngineError("bad_pack", `The pack doesn't load: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`, 409);
    }
    const fresh = this.o.packs.get(input.packId)!;
    if (fresh.problems.length > 0) throw new EngineError("bad_pack", `The pack has problems: ${fresh.problems.join(" ")}`, 409);
    const name = input.kind ?? "test";
    const kind = this.o.kinds.get(name);
    if (!kind) throw new EngineError("bad_input", `No job kind "${name}" is loaded. Loaded kinds: ${this.o.kinds.list().map((k) => k.name).join(", ") || "none"}.`);
    try {
      const params = resolveParams(pack.options.params ?? {}, input.params);
      const plan = kind.plan(pack, params, input.tests ?? [], { attempts: input.options?.attempts });
      return { pack, kind, params, plan };
    } catch (err) {
      throw new EngineError("bad_input", err instanceof Error ? err.message : String(err));
    }
  }

  /** What a start request would run, in order, without starting it: every attempt, and why tests that weren't chosen join. */
  async preview(input: Omit<StartInput, "startedBy">): Promise<RunPreview> {
    const { pack, kind, params, plan } = await this.prepare(input);
    const chosen = new Set(input.tests ?? []);
    const order = [...new Set(plan.items.map((i) => i.itemId))];
    const joined: RunPreview["joined"] = [];
    if (chosen.size > 0) {
      const all = [...order, ...order.flatMap((id) => plan.children.get(id) ?? [])];
      for (const id of all) {
        if (chosen.has(id)) continue;
        const neededBy = all.filter((t) => (plan.needs.get(t) ?? []).includes(id));
        const parent = order.find((p) => (plan.children.get(p) ?? []).includes(id));
        const kids = (plan.children.get(id) ?? []).filter((c) => chosen.has(c));
        if (parent) joined.push({ testId: id, reason: "inside", of: [parent] });
        else if (kids.length > 0) joined.push({ testId: id, reason: "parent", of: kids });
        else joined.push({ testId: id, reason: "needed", of: neededBy });
      }
    }
    return {
      params,
      attempts: plan.items.length,
      plan: plan.items.map((i) => {
        const children = plan.children.get(i.itemId);
        return { testId: i.itemId, title: kind.describe(pack, i.itemId).title, number: i.number, of: i.of, ...(children && children.length > 0 ? { children } : {}) };
      }),
      joined,
    };
  }

  async start(input: StartInput): Promise<RunSummary> {
    const { pack, kind, params } = await this.prepare(input);
    const id = newId(4);
    this.o.repo.insertRun({
      id,
      pack_id: input.packId,
      pack_name: pack.options.name,
      pack_path: path.join(pack.dir, pack.packFile),
      site_key: pack.options.site.key,
      job_kind: kind.name,
      tests: JSON.stringify(input.tests ?? []),
      params: JSON.stringify(params),
      options: JSON.stringify(input.options ?? {}),
      label: (input.label ?? "").trim(),
      status: "queued",
      started_by: input.startedBy,
      created_at: new Date().toISOString(),
    });
    this.o.events.append("run.queued", { packId: input.packId, tests: input.tests ?? [], params, startedBy: input.startedBy }, { runId: id });
    this.schedule();
    return runSummary(this.o.repo.run(id)!, this.o.repo.counts(id));
  }

  /** Starts a new run with another run's pack, tests, values, options and label. */
  async again(id: string, startedBy: string): Promise<RunSummary> {
    const r = this.requireRun(id);
    // Queue edits belong to the run they were made in.
    const options = JSON.parse(r.options) as RunOptions;
    delete options.queue;
    return this.start({ packId: r.pack_id, tests: JSON.parse(r.tests) as string[], params: JSON.parse(r.params) as Record<string, unknown>, options, label: r.label, kind: r.job_kind, startedBy });
  }

  /** Gives a run a label (empty takes it away). */
  setLabel(id: string, label: string): RunSummary {
    this.requireRun(id);
    this.o.repo.updateRun(id, { label: label.trim() });
    this.o.events.append("run.labeled", { label: label.trim() }, { runId: id });
    return runSummary(this.o.repo.run(id)!, this.o.repo.counts(id));
  }

  private requireRun(id: string): RunRow {
    const r = this.o.repo.run(id);
    if (!r) throw new EngineError("not_found", `No run with id ${id}.`, 404);
    return r;
  }

  private requireActive(id: string): ActiveRun {
    this.requireRun(id);
    const run = this.active.get(id);
    if (!run) throw new EngineError("not_running", "The run isn't running.", 409);
    return run;
  }

  pause(id: string, by = "api"): RunDetail {
    const run = this.requireActive(id);
    const before = run.pausedBy;
    run.pausedBy = by;
    if (!run.control.requestPause()) {
      run.pausedBy = before;
      throw new EngineError("conflict", "The run is already pausing, paused or stopping.", 409);
    }
    return this.get(id)!;
  }

  /** Resumes a manual pause; for an interrupted, stopped or failed run, queues it to continue where it was. */
  resume(id: string): RunDetail {
    const r = this.requireRun(id);
    const run = this.active.get(id);
    if (run) {
      if (!run.control.resume()) throw new EngineError("conflict", run.control.reason === "broken" ? "The run paused on a broken attempt: answer with retry or skip." : "The run isn't paused.", 409);
      return this.get(id)!;
    }
    if (!["interrupted", "stopped", "failed_to_start"].includes(r.status)) throw new EngineError("conflict", `A ${r.status} run can't be resumed.`, 409);
    this.requeue(r, "resume");
    return this.get(id)!;
  }

  retry(id: string): RunDetail {
    return this.decide(id, "retry");
  }

  skip(id: string): RunDetail {
    return this.decide(id, "skip");
  }

  private decide(id: string, d: BrokenDecision): RunDetail {
    const run = this.requireActive(id);
    if (!run.control.decide(d)) throw new EngineError("conflict", "The run isn't paused on a broken attempt.", 409);
    return this.get(id)!;
  }

  async stop(id: string, when: "after" | "now"): Promise<RunDetail> {
    const r = this.requireRun(id);
    if (r.status === "queued") {
      this.o.repo.updateRun(id, { status: "stopped", finished_at: new Date().toISOString() });
      this.o.events.append("run.finished", { status: "stopped", counts: this.o.repo.counts(id) }, { runId: id });
      return this.get(id)!;
    }
    const run = this.active.get(id);
    if (!run) throw new EngineError("not_running", "The run isn't running.", 409);
    run.control.stop(when);
    this.o.events.append("run.stopping", { when }, { runId: id });
    if (when === "now") await run.session?.closeContext();
    return this.get(id)!;
  }

  /** Queues a finished run again to redo only its broken attempts (and what they need). */
  redoBroken(id: string): RunDetail {
    const r = this.requireRun(id);
    if (this.active.has(id) || r.status === "queued") throw new EngineError("conflict", "The run is still going.", 409);
    if (!this.o.repo.attempts(id).some((a) => a.status === "broken")) throw new EngineError("conflict", "The run has no broken attempts.", 409);
    this.requeue(r, "redo");
    return this.get(id)!;
  }

  private requeue(r: RunRow, mode: RunMode): void {
    this.o.repo.updateRun(r.id, { status: "queued", mode, finished_at: null, error: null });
    this.o.events.append("run.queued", { mode }, { runId: r.id });
    this.schedule();
  }

  /** Sites something other than a run is using (a recording), with how many hold each. */
  private readonly holds = new Map<string, number>();

  /** True while a run of this site is going. */
  siteBusy(siteKey: string): boolean {
    return [...this.active.values()].some((r) => r.siteKey === siteKey);
  }

  /**
   * Keeps runs of a site queued while something else uses the site, as a run of it would (a
   * recording changes the same app). Returns the release; runs that waited start after it.
   */
  holdSite(siteKey: string): () => void {
    this.holds.set(siteKey, (this.holds.get(siteKey) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.holds.get(siteKey) ?? 1) - 1;
      if (n > 0) this.holds.set(siteKey, n);
      else this.holds.delete(siteKey);
      this.schedule();
    };
  }

  /** Starts every queued run whose site is free. */
  schedule(): void {
    if (this.closing) return;
    const busy = new Set([...[...this.active.values()].map((r) => r.siteKey), ...this.holds.keys()]);
    for (const row of this.o.repo.queued()) {
      if (busy.has(row.site_key) || this.active.has(row.id)) continue;
      busy.add(row.site_key);
      this.launch(row);
    }
  }

  /** Stops every run for shutdown; they become interrupted so they can resume after restart. */
  async close(): Promise<void> {
    this.closing = true;
    const runs = [...this.active.values()];
    for (const run of runs) {
      run.shutdown = true;
      run.control.stop("now");
      await run.session?.closeContext();
    }
    await Promise.all(runs.map((r) => r.done.catch(() => undefined)));
  }

  /**
   * A promise that failed with nobody waiting on it, almost always test code that started a
   * Playwright call without `await` and ended before it did. It must not take the server down:
   * it goes on the log of every run that is going (the attempt that is running, else the run),
   * since nothing tells which one it came from. Returns the message, for the server's own log.
   */
  strayError(reason: unknown): string {
    const first = reason instanceof Error ? `${reason.name === "Error" ? "" : `${reason.name}: `}${reason.message.split("\n")[0]}` : String(reason);
    const message = this.mask(`A promise failed after nothing waited on it (a call without await in a test?): ${first}`);
    for (const run of this.active.values()) {
      if (run.recorder) run.recorder.addLog("warn", message);
      else this.emit("run.log", { level: "warn", message }, run.id);
    }
    return message;
  }

  /** Resolves when the run is no longer active (for tests and the CLI). */
  async settled(id: string): Promise<void> {
    await this.active.get(id)?.done;
  }

  private emit(type: string, data: Record<string, unknown>, runId: string, attemptId?: string | null) {
    this.o.events.append(type, this.mask(data), { runId, attemptId: attemptId ?? undefined });
  }

  /** `value` with every secret masked (unchanged when there is no secrets store). */
  private mask<T>(value: T): T {
    const secrets = this.o.secrets;
    return secrets ? maskDeep(value, (s) => secrets.mask(s)) : value;
  }

  private launch(row: RunRow): void {
    const run: ActiveRun = {
      id: row.id,
      siteKey: row.site_key,
      control: new RunControl({
        onState: (state, info) => {
          const status = state === "running" ? "running" : state;
          this.o.repo.updateRun(row.id, { status });
          const type = state === "running" ? "run.resumed" : state === "pausing" ? "run.pausing" : "run.paused";
          const by = info.reason === "manual" ? run.pausedBy : null;
          if (state === "running") run.pausedBy = null;
          this.emit(type, { reason: info.reason, deadline: info.deadline, attemptId: run.attemptId, testId: run.testId, by }, row.id);
        },
      }),
      session: null,
      attemptId: null,
      testId: null,
      step: null,
      pausedBy: null,
      state: JSON.parse(row.state) as Record<string, unknown>,
      info: JSON.parse(row.info ?? "{}") as Record<string, string | number | boolean>,
      collected: new Map(),
      shutdown: false,
      done: Promise.resolve(),
      videoWarned: false,
      runVideo: null,
      runVideoWarned: false,
      ctx: null,
      recorder: null,
      sizeBytes: null,
      storageLow: null,
      storageTimer: null,
    };
    this.active.set(row.id, run);
    run.done = this.execute(row, run)
      .catch((err: unknown) => {
        this.o.repo.updateRun(row.id, { status: "interrupted", error: err instanceof Error ? err.message : String(err) });
        this.emit("run.interrupted", { reason: "engine_error", message: err instanceof Error ? err.message : String(err) }, row.id);
      })
      .finally(async () => {
        if (run.storageTimer) clearInterval(run.storageTimer);
        // Once the run is over its folder doesn't grow; measure it for good.
        await this.keepSize(row.id);
        this.active.delete(row.id);
        this.o.frames.forget(row.id);
        this.schedule();
      });
  }

  private async execute(row: RunRow, run: ActiveRun): Promise<void> {
    const { repo, packs, frames } = this.o;
    const mode = row.mode;
    repo.updateRun(row.id, { status: "running", started_at: row.started_at ?? new Date().toISOString(), finished_at: null, error: null });
    this.emit("run.started", { mode }, row.id);

    const failStart = (message: string) => {
      repo.updateRun(row.id, { status: "failed_to_start", error: this.mask(message), finished_at: new Date().toISOString() });
      this.emit("run.failed_to_start", { message }, row.id);
    };

    let pack: LoadedPack;
    try {
      pack = (await packs.refresh(row.pack_id)).pack;
    } catch (err) {
      failStart(`The pack doesn't load: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      return;
    }
    const kind = this.o.kinds.get(row.job_kind);
    if (!kind) {
      failStart(`No job kind "${row.job_kind}" is loaded.`);
      return;
    }
    const params = JSON.parse(row.params) as ParamValues;
    const options = JSON.parse(row.options) as RunOptions;
    let plan: KindPlan;
    try {
      plan = withAdded(kind.plan(pack, params, JSON.parse(row.tests) as string[], { attempts: options.attempts }), options.added);
    } catch (err) {
      failStart(err instanceof Error ? err.message : String(err));
      return;
    }
    const queue = new RunQueue(plan, options.queue);
    const entries = this.planEntries(kind, pack, plan, queue);
    repo.updateRun(row.id, { plan: JSON.stringify(entries) });
    this.emit("run.planned", { plan: entries }, row.id);

    const o = pack.options;
    let signIn: StorageState | undefined;
    if (options.signIn ?? o.site.signIn === "saved") {
      signIn = this.o.signIns?.get(o.site.key);
      if (!signIn) {
        failStart(`No saved sign-in for the site "${o.site.key}". Sign in on a Record session and press Save sign-in, or call h.saveSignIn() at the end of a login test.`);
        return;
      }
    }
    // Through a runner: the site is reached from that machine (docs/plans/self-hosting.md, section 6).
    const network = options.network ?? o.site.network ?? "server";
    let proxy: { server: string; close(): Promise<void> } | null = null;
    if (network !== "server") {
      if (!this.o.runners) {
        failStart(`This server has no runners, so the run can't reach the site from "${network}".`);
        return;
      }
      try {
        let warned = 0;
        proxy = await this.o.runners.proxy(network, (message) => {
          // One line per refusal, up to 20, so a page full of blocked requests doesn't flood the log.
          if (++warned <= 20) this.emit("run.log", { level: "warn", message: `Runner ${network} didn't open ${message}` }, row.id);
        });
      } catch (err) {
        failStart(err instanceof Error ? err.message : String(err));
        return;
      }
      this.emit("run.log", { level: "info", message: `The browser reaches the site from the runner ${network}.` }, row.id);
    }
    let session: BrowserSession;
    try {
      session = await BrowserSession.launch(
        {
          browser: o.browser?.name ?? "chromium",
          // A machine with no screen (a container) can't show a browser, so it runs headless whatever the pack asks.
          headless: (o.browser?.headless ?? true) || !hasDesktop(),
          viewport: o.browser?.viewport ?? { width: 1280, height: 800 },
          launch: proxy ? { ...o.browser?.launch, proxy: { server: proxy.server } } : o.browser?.launch,
          context: signIn ? { ...o.browser?.context, storageState: signIn } : o.browser?.context,
          size: o.run?.screencastSize,
          quality: o.run?.frameQuality ?? 70,
          showActions: o.run?.showActions ?? true,
        },
        {
          onFrame: (f) => frames.publish({ runId: row.id, ...f }),
          onPageOpened: (pageId, url) => this.emit("page.opened", { pageId, url }, row.id),
          onPageClosed: (pageId) => {
            frames.forget(row.id, pageId);
            this.emit("page.closed", { pageId }, row.id);
          },
          onPageNavigated: (pageId, url) => this.emit("page.navigated", { pageId, url }, row.id),
          onActivePage: (pageId) => this.emit("page.active", { pageId }, row.id),
          onVideoUnavailable: (message) => {
            if (run.videoWarned) return;
            run.videoWarned = true;
            this.emit(
              "video.unavailable",
              { message: "Video couldn't be saved, so this run has no video (frames still stream). Installing Playwright's ffmpeg usually fixes it: npx playwright install ffmpeg", error: message },
              row.id,
            );
          },
        },
      );
    } catch (err) {
      await proxy?.close();
      failStart(`The browser didn't start: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      return;
    }
    run.session = session;
    await this.checkStorage(run);
    run.storageTimer = setInterval(() => void this.checkStorage(run).catch(() => undefined), this.o.storageCheckMs ?? STORAGE_CHECK_MS);
    if (options.runVideo ?? o.run?.runVideo ?? false) this.startRunVideo(run);

    try {
      for (const c of o.collectors ?? []) run.collected.set(c.name, []);
      await this.attachCollectors(run, pack);
      await session.restartCapture(null);
      const page = await session.mainPage();
      const setupRecorder = new AttemptRecorder(path.join(this.o.dataDir, "runs", row.id, "setup"), this.o.dataDir, () => undefined, (l) =>
        this.emit("run.log", { ...l }, row.id),
      );
      try {
        await kind.setup({
          pack,
          params,
          page,
          session,
          helpers: () => this.helpers(run, kind, pack, page, setupRecorder, new Map(), null),
          info: (k, v) => this.setInfo(run, k, v),
        });
      } catch (err) {
        failStart(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      const ctx: RunCtx = {
        row,
        run,
        kind,
        pack,
        params,
        plan,
        mode,
        options,
        queue,
        pauseOnBroken: options.pauseOnBroken ?? o.run?.pauseOnBroken ?? true,
        pauseLimitMs: (options.pauseLimitMinutes ?? o.run?.pauseLimitMinutes ?? DEFAULT_PAUSE_LIMIT_MINUTES) * 60_000,
        childRanIn: new Map(),
        todo: new Set(),
        ended: false,
        addedBatch: [],
        addedFlush: null,
        addedLimitHit: false,
      };
      ctx.todo = this.select(ctx);
      run.ctx = ctx;
      for (;;) {
        await run.control.checkpoint("boundary");
        if (run.control.stopMode) break;
        const item = ctx.queue.next();
        if (!item) break;
        if (!ctx.todo.has(`${item.itemId}#${item.number}`)) {
          ctx.queue.finish(item);
          continue;
        }
        if (ctx.queue.isSkipped(item)) {
          this.skipAttempt(ctx, item, null, "Skipped from the queue.");
          ctx.queue.finish(item);
          continue;
        }

        const r = await packs.refresh(row.pack_id, ctx.pack);
        if (r.reloaded) {
          ctx.pack = r.pack;
          this.emit("pack.reloaded", { packId: row.pack_id }, row.id);
        } else if (r.error) this.emit("run.log", { level: "warn", message: `The pack changed but doesn't build, so the old code keeps running: ${r.error}` }, row.id);

        const brokenNeed = this.brokenNeed(ctx, item.itemId);
        if (brokenNeed) {
          this.skipAttempt(ctx, item, null, `Skipped: ${brokenNeed}`);
          ctx.queue.finish(item);
          continue;
        }
        ctx.queue.started(item);
        const { outcome, attemptId } = await this.runAttempt(ctx, item, null);
        if (run.control.stopMode || run.shutdown) break;
        if (outcome === "broken" && ctx.pauseOnBroken) {
          const d = await this.pauseOnBroken(ctx, item.itemId, attemptId);
          this.emit("run.decision", { decision: d, testId: item.itemId, number: item.number }, row.id);
          if (d === "stop") break;
          if (d === "retry") continue;
        }
        ctx.queue.finish(item);
      }
      ctx.ended = true;
      this.flushAdded(ctx);
      if (!run.control.stopMode && !run.shutdown && mode === "normal") this.fileUnrunChildren(ctx);
    } finally {
      await this.stopRunVideo(run);
      await session.stopCapture();
      await session.close();
      await proxy?.close();
      run.session = null;
    }
    const status = run.shutdown ? "interrupted" : run.control.stopMode ? "stopped" : "finished";
    repo.updateRun(row.id, { status, finished_at: status === "interrupted" ? null : new Date().toISOString() });
    const counts = repo.counts(row.id);
    if (status === "interrupted") {
      repo.markStoppedByServer(row.id);
      this.emit("run.interrupted", { reason: "server_stopped" }, row.id);
    } else this.emit("run.finished", { status, counts }, row.id);
  }

  /** Starts a video of the whole run, of the page the live view follows; a new part when the run already has one. */
  private startRunVideo(run: ActiveRun): void {
    if (run.runVideo || run.storageLow?.videosOff) return;
    const warn = (message: string) => {
      if (run.runVideoWarned) return;
      run.runVideoWarned = true;
      this.emit("run.log", { level: "warn", message }, run.id);
    };
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return warn("The run video can't be recorded: Playwright's ffmpeg isn't installed (npx playwright install ffmpeg). The run goes on without it.");
    const dir = path.join(this.o.dataDir, "runs", run.id);
    mkdirSync(dir, { recursive: true });
    run.runVideo = new RunVideo({
      file: nextRunVideoFile(dir),
      ffmpeg,
      frame: () => {
        const list = this.o.frames.latestFrames(run.id);
        return list.find((f) => f.pageId === run.session?.activePage) ?? list.at(-1) ?? null;
      },
      onError: (message) => warn(`The run video stopped: ${message}. The run goes on without it.`),
    });
    run.runVideo.start();
  }

  private async stopRunVideo(run: ActiveRun): Promise<void> {
    const v = run.runVideo;
    run.runVideo = null;
    await v?.stop();
  }

  /** Which top-level attempts run, by mode. Keys are `test#number`. */
  private select(ctx: RunCtx): Set<string> {
    const { plan, row, mode } = ctx;
    const all = new Set(plan.items.map((i) => `${i.itemId}#${i.number}`));
    if (mode === "normal") return all;
    const statusOf = (id: string, n: number) => this.o.repo.currentAttempt(row.id, id, n)?.status;
    const want = (id: string, n: number): boolean => {
      const s = statusOf(id, n);
      return mode === "resume" ? s === undefined || !DECIDED.includes(s) : s === "broken";
    };
    const out = new Set<string>();
    for (const i of plan.items) {
      if (want(i.itemId, i.number) || (plan.children.get(i.itemId) ?? []).some((c) => want(c, i.number))) out.add(`${i.itemId}#${i.number}`);
    }
    if (mode === "redo") {
      // A redone test needs the state its needs saved on their last attempt: redo those too.
      const lastOf = new Map(plan.items.map((i) => [i.itemId, i]));
      const add = (id: string) => {
        for (const n of plan.needs.get(id) ?? []) {
          const owner = lastOf.get(n) ?? lastOf.get([...plan.children].find(([, kids]) => kids.includes(n))?.[0] ?? "");
          if (owner && !out.has(`${owner.itemId}#${owner.of}`)) {
            out.add(`${owner.itemId}#${owner.of}`);
            add(owner.itemId);
          }
        }
      };
      for (const key of [...out]) add(key.split("#")[0]!);
      for (const i of plan.items) for (const c of plan.children.get(i.itemId) ?? []) if (out.has(`${i.itemId}#${i.number}`)) add(c);
    }
    return out;
  }

  /** A reason to skip `itemId` when something it needs didn't produce its state, else null. */
  private brokenNeed(ctx: RunCtx, itemId: string): string | null {
    for (const n of ctx.plan.needs.get(itemId) ?? []) {
      const last = [...ctx.plan.items].reverse().find((i) => i.itemId === n);
      const parent = last ? null : ctx.plan.items.find((i) => (ctx.plan.children.get(i.itemId) ?? []).includes(n));
      const of = last?.of ?? (parent ? (ctx.plan.childAttempts?.get(n) ?? parent.of) : undefined);
      if (of === undefined || of === 0) continue;
      const a = this.o.repo.currentAttempt(ctx.row.id, n, of);
      if (!a) return `${n} didn't run.`;
      if (["broken", "stopped", "skipped", "interrupted"].includes(a.status)) return `${n} ${a.status === "skipped" ? "was skipped" : `ended ${a.status}`}.`;
    }
    return null;
  }

  /** An attempt's row as the run's page lists it, sent with its events so pages patch instead of refetching the run. */
  private attemptOf(id: string): AttemptSummary | null {
    const a = this.o.repo.attempt(id);
    return a ? attemptSummary(a) : null;
  }

  private skipAttempt(ctx: RunCtx, item: PlanItem, parentId: string | null, reason: string): void {
    const id = newId(6);
    const title = ctx.kind.describe(ctx.pack, item.itemId).title;
    this.o.repo.insertSkipped({ id, runId: ctx.row.id, kind: ctx.kind.name, itemId: item.itemId, title, number: item.number, of: item.of, parentId, reason });
    this.emit("attempt.finished", { testId: item.itemId, number: item.number, of: item.of, status: "skipped", reason, parentId, attempt: this.attemptOf(id) }, ctx.row.id, id);
  }

  /** The kind's helper object for one attempt (or the run's setup), built from the runtime every kind gets. */
  private helpers(run: ActiveRun, kind: JobKind, pack: LoadedPack, page: Page, recorder: AttemptRecorder, saves: Map<string, unknown>, attemptId: string | null): unknown {
    const rt: AttemptRuntime = {
      page,
      context: run.session!.context,
      control: run.control,
      recorder,
      session: run.session!,
      save: (k, v) => saves.set(k, v),
      load: (k) => (saves.has(k) ? saves.get(k) : run.state[k]),
      info: (k, v) => this.setInfo(run, k, v),
      secret: (name) => this.o.secrets?.get(name),
      saveSignIn: async () => {
        const signIns = this.o.signIns;
        if (!signIns) throw new StepError("Saved sign-ins aren't available on this server.");
        const key = pack.options.site.key;
        signIns.save(key, await run.session!.context.storageState(), `run ${run.id}`);
        this.emit("signin.saved", { siteKey: key }, run.id, attemptId);
        return key;
      },
      onStep: (title) => {
        run.step = title;
        if (attemptId) this.emit("attempt.step", { title }, run.id, attemptId);
      },
      onFlag: (f) => {
        if (attemptId) this.emit("attempt.flag", { ...f }, run.id, attemptId);
      },
    };
    return kind.helpers(rt, pack);
  }

  private async runAttempt(ctx: RunCtx, item: PlanItem, parentId: string | null): Promise<{ outcome: Outcome; attemptId: string }> {
    const { row, run, kind } = ctx;
    const session = run.session!;
    const pack = ctx.pack;
    const id = newId(6);
    const title = kind.describe(pack, item.itemId).title;
    const base = path.posix.join("runs", row.id, item.itemId, `attempt-${item.number}`);
    const tryNo = this.o.repo.insertAttempt({
      id,
      runId: row.id,
      kind: kind.name,
      itemId: item.itemId,
      title,
      number: item.number,
      of: item.of,
      parentId,
      folder: (n) => (n > 1 ? `${base}-try-${n}` : base),
    });
    const folder = tryNo > 1 ? `${base}-try-${tryNo}` : base;
    const dir = path.join(this.o.dataDir, ...folder.split("/"));
    const recorder = new AttemptRecorder(
      dir,
      this.o.dataDir,
      (a: ArtifactInfo) => {
        this.o.repo.addArtifact(id, row.id, a);
        this.emit("attempt.artifact", { ...a }, row.id, id);
      },
      (l) => this.emit("attempt.log", { ...l }, row.id, id),
    );

    const prev = { attemptId: run.attemptId, testId: run.testId, step: run.step };
    run.attemptId = id;
    run.testId = item.itemId;
    run.step = null;
    this.emit("attempt.started", { testId: item.itemId, title, number: item.number, of: item.of, try: tryNo, parentId, attempt: this.attemptOf(id) }, row.id, id);

    const top = parentId === null;
    if (top) run.recorder = recorder;
    const o = pack.options.run ?? {};
    const traceMode = ctx.options.trace ?? o.trace ?? "problems";
    const video = run.storageLow?.videosOff ? "never" : videoMode(ctx.options.video ?? o.video ?? "always");
    if (top) {
      // Tabs and popups the last test opened would keep their screencasts going and catch the live view.
      if (!o.keepTabs) {
        const closed = await session.closeExtraPages();
        if (closed > 0) recorder.addLog("info", `Closed ${closed === 1 ? "a tab" : `${closed} tabs`} the last test left open.`);
      }
      await session.restartCapture(video !== "never" ? dir : null);
      if (traceMode !== "never") await session.startTraceChunk();
    }

    const page = await session.mainPage();
    const saves = new Map<string, unknown>();
    const last = item.number === item.of;
    const env: AttemptEnv = {
      pack,
      itemId: item.itemId,
      number: item.number,
      of: item.of,
      last,
      params: ctx.params,
      page,
      session,
      control: run.control,
      recorder,
      helpers: () => this.helpers(run, kind, pack, page, recorder, saves, id),
      runChild: (childId) => this.runChild(ctx, item, id, childId),
      addItem: (itemId, opts) => this.addItem(ctx, itemId, opts?.attempts ?? 1),
    };

    // Collectors: records their context listeners make from here on belong to this attempt (a
    // child takes its share out of its parent's), plus what their attempt hooks add.
    const collectors = pack.options.collectors ?? [];
    const marks = new Map([...run.collected].map(([name, list]) => [name, top ? 0 : list.length]));
    const added = new Map<string, CollectorRecord[]>();
    const views = collectors.map((c): [Collector, CollectorAttempt] => [
      c,
      {
        attemptId: id,
        testId: item.itemId,
        number: item.number,
        page,
        context: session.context,
        record: (entry) => added.set(c.name, [...(added.get(c.name) ?? []), entry]),
        file: (name, data, contentType) => {
          const rel = safeRelative(name);
          if (!rel) throw new Error(`Collector "${c.name}": "${name}" isn't a usable file name.`);
          recorder.write("file", `${c.name}: ${rel}`, path.join("collectors", slug(c.name), ...rel.split("/")), data, contentType);
        },
        metric: (name, value, unit) => {
          if (Number.isFinite(value)) recorder.metrics[name] = { value, unit: unit ?? null };
        },
      },
    ]);
    for (const [c, view] of views) if (c.beginAttempt) await this.hook(recorder, `Collector "${c.name}" (beginAttempt)`, () => c.beginAttempt!(view));

    let error: unknown;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    try {
      const body = ctx.kind.execute(env);
      // After "stop now" the body normally fails at once (its page is gone); don't wait on one that hangs.
      const stopped = run.control.whenStoppedNow.then(() => new Promise<void>((r) => setTimeout(r, STOP_GRACE_MS)));
      if (!top) await Promise.race([body, stopped]);
      else {
        const ownLimit = kind.describe(pack, item.itemId).timeout ?? o.testTimeout ?? DEFAULT_TEST_TIMEOUT;
        const started = Date.now();
        const pausedBefore = run.control.pausedMs();
        const timedOut = new Promise<never>((_, reject) => {
          watchdog = setInterval(() => {
            // Read on every tick: the run's limit can change while the attempt goes.
            const limit = ctx.options.testTimeout ?? ownLimit;
            if (Date.now() - started - (run.control.pausedMs() - pausedBefore) <= limit) return;
            run.control.abort = new AttemptAborted(`The attempt ran longer than its time limit (${Math.round(limit / 1000)} s).`);
            reject(run.control.abort);
          }, 250);
        });
        try {
          await Promise.race([body, timedOut, stopped]);
        } catch (err) {
          if (err instanceof AttemptAborted) {
            // The body stops at its next pause point. If it's stuck inside one long Playwright call, replace the context.
            const settled = await Promise.race([body.then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), ABORT_GRACE_MS))]);
            if (!settled) {
              recorder.addLog("warn", "The attempt didn't stop after its time limit; the browser context was replaced.");
              await session.resetContext();
              await this.attachCollectors(run, pack);
              await session.restartCapture(null);
            }
          }
          throw err;
        }
      }
    } catch (err) {
      error = err;
    } finally {
      if (watchdog) clearInterval(watchdog);
      if (top) run.control.abort = null;
    }

    if (top) run.recorder = null;
    const { status, error: attemptError } = kind.classify({
      error,
      flags: recorder.flags,
      stopped: run.control.stopMode === "now" || run.shutdown,
    });
    const finalStatus: AttemptStatus = run.shutdown && status === "stopped" ? "interrupted" : status;

    if (finalStatus !== "stopped" && finalStatus !== "interrupted") {
      if (ctx.kind.afterAttempt) await this.hook(recorder, "afterAttempt", () => ctx.kind.afterAttempt!(env, status));
      for (const [c, view] of views) if (c.endAttempt) await this.hook(recorder, `Collector "${c.name}" (endAttempt)`, () => c.endAttempt!(view));
    }
    for (const [name, list] of run.collected) {
      const mine = [...list.splice(marks.get(name) ?? 0), ...(added.get(name) ?? [])];
      added.delete(name);
      if (mine.length > 0) recorder.write("collector", name, path.join("collectors", `${slug(name)}.json`), JSON.stringify(mine, null, 2), "application/json");
    }
    for (const [name, mine] of added) recorder.write("collector", name, path.join("collectors", `${slug(name)}.json`), JSON.stringify(mine, null, 2), "application/json");

    if (top) {
      // "problems" keeps a video only when the attempt failed or broke, as "problems" does for traces.
      const keepVideo = video === "always" || finalStatus === "broken" || finalStatus === "failed";
      for (const v of await session.restartCapture(null).catch(() => [])) {
        if (keepVideo) recorder.register("video", `video ${v.pageId}`, v.path, "video/webm");
        else rmSync(v.path, { force: true });
      }
      if (traceMode !== "never") {
        const keep = traceMode === "always" || finalStatus === "broken" || finalStatus === "failed";
        const file = path.join(dir, "trace.zip");
        if (await session.stopTraceChunk(keep ? file : null)) {
          if (this.maskTrace(file, recorder)) recorder.register("trace", "trace", file, "application/zip");
        }
      }
    }

    if (last && (finalStatus === "passed" || finalStatus === "failed") && saves.size > 0) {
      for (const [k, v] of saves) run.state[k] = v;
      this.o.repo.updateRun(row.id, { state: JSON.stringify(run.state) });
    }

    if (recorder.droppedLog > 0) recorder.notes.push(`${recorder.droppedLog} log line${recorder.droppedLog === 1 ? "" : "s"} past the limit of ${MAX_LOG_LINES} weren't kept.`);
    this.o.repo.finishAttempt(
      id,
      {
        status: finalStatus,
        ...this.mask({
          flags: recorder.flags,
          metrics: recorder.metrics,
          notes: recorder.notes,
          texts: recorder.texts,
          log: recorder.log,
          steps: recorder.steps,
          error: attemptError,
        }),
      },
    );
    const doc = resultDocument(this.o.repo.attempt(id)!, this.o.repo.artifacts(id));
    try {
      writeFileSync(path.join(dir, "result.json"), JSON.stringify(doc, null, 2));
    } catch {
      // the folder went away (disk full, removed by hand): the database still has the result
    }
    this.emit(
      "attempt.finished",
      { testId: item.itemId, number: item.number, of: item.of, try: tryNo, status: finalStatus, error: attemptError?.message ?? null, flags: recorder.flags.map((f) => f.name), parentId, attempt: this.attemptOf(id) },
      row.id,
      id,
    );
    run.attemptId = prev.attemptId;
    run.testId = prev.testId;
    run.step = prev.step;
    return { outcome: finalStatus === "interrupted" ? "stopped" : finalStatus, attemptId: id };
  }

  /** Pauses on a broken attempt (shown as the current one) until retry, skip, stop or the time limit. */
  private async pauseOnBroken(ctx: RunCtx, testId: string, attemptId: string): Promise<BrokenDecision> {
    const { run } = ctx;
    const prev = { attemptId: run.attemptId, testId: run.testId };
    run.attemptId = attemptId;
    run.testId = testId;
    try {
      return await run.control.waitBroken(ctx.pauseLimitMs, () => this.o.packs.changed(ctx.row.pack_id));
    } finally {
      run.attemptId = prev.attemptId;
      run.testId = prev.testId;
    }
  }

  /**
   * A trace records every action with its arguments (the text a `fill` typed) and the network
   * traffic, so a secret a test used is in it as typed. Rewrites the trace with every secret masked; false when it had to be dropped instead.
   */
  private maskTrace(file: string, recorder: AttemptRecorder): boolean {
    const maskBytes = this.o.secrets?.maskBytes?.bind(this.o.secrets);
    if (!maskBytes) return true;
    try {
      let changed = false;
      const entries = unzip(readFileSync(file)).map((e) => {
        const masked = maskBytes(e.data);
        if (!masked) return e;
        changed = true;
        return { name: e.name, data: masked };
      });
      if (changed) writeFileSync(file, zip(entries));
      return true;
    } catch (err) {
      // A trace that can't be checked isn't kept: it could hold a secret.
      rmSync(file, { force: true });
      recorder.addLog("warn", `The trace couldn't be checked for secrets, so it wasn't kept: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Runs a pack or collector hook; a failure is logged on the attempt, not raised. */
  private async hook(recorder: AttemptRecorder, what: string, fn: () => unknown): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`took longer than ${HOOK_LIMIT_MS / 1000} s`)), HOOK_LIMIT_MS))),
      ]);
    } catch (err) {
      recorder.addLog("warn", `${what} failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Lets the pack's collectors listen to the session's browser context (again, after it was replaced). */
  private async attachCollectors(run: ActiveRun, pack: LoadedPack): Promise<void> {
    const context = run.session!.context;
    for (const c of pack.options.collectors ?? []) {
      if (!c.attach) continue;
      if (!run.collected.has(c.name)) run.collected.set(c.name, []);
      await c.attach(context, (entry) => run.collected.get(c.name)?.push(entry));
    }
  }

  /** Saves a fact about the run, shown on its page. */
  private setInfo(run: ActiveRun, key: string, value: string | number | boolean): void {
    const k = String(key).trim();
    if (!k || k.length > 64) throw new StepError("info(key, value): the key must be 1 to 64 characters.");
    if (!["string", "number", "boolean"].includes(typeof value)) throw new StepError(`info("${k}", value): the value must be a string, number or boolean.`);
    const v = this.mask(typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value);
    if (run.info[k] === v) return;
    run.info[k] = v;
    this.o.repo.updateRun(run.id, { info: JSON.stringify(run.info) });
    this.emit("run.info", { key: k, value: v }, run.id);
  }

  /** At the end of a run: a planned child attempt that no parent ran is filed as skipped, so it doesn't look lost. */
  private fileUnrunChildren(ctx: RunCtx): void {
    const parentsOfChild = new Map<string, string[]>();
    for (const [p, kids] of ctx.plan.children) for (const c of kids) parentsOfChild.set(c, [...(parentsOfChild.get(c) ?? []), p]);
    for (const [child, parents] of parentsOfChild) {
      const of = Math.max(0, ...parents.map((p) => ctx.plan.childAttempts?.get(child) ?? Math.max(0, ...ctx.plan.items.filter((i) => i.itemId === p).map((i) => i.of))));
      for (let n = 1; n <= of; n++) {
        if (this.o.repo.currentAttempt(ctx.row.id, child, n)) continue;
        const parentRows = parents.map((p) => this.o.repo.currentAttempt(ctx.row.id, p, n)).filter((a) => a !== null);
        if (parentRows.length === 0) continue; // its parent didn't run this number either
        const reason = parents.length > 1 ? `None of ${parents.join(", ")} ran it in attempt ${n}.` : `${parents[0]} didn't run it in attempt ${n}.`;
        this.skipAttempt(ctx, { itemId: child, number: n, of }, parentRows[0]!.id, reason);
      }
    }
  }

  private async runChild(ctx: RunCtx, parent: PlanItem, parentId: string, childId: string): Promise<Outcome> {
    const kids = ctx.plan.children.get(parent.itemId) ?? [];
    if (!kids.includes(childId)) {
      const t = ctx.pack.tests.find((x) => x.id === childId);
      if (t && parentsOf(t).includes(parent.itemId)) return "skipped"; // added to the pack after this run was planned
      throw new Error(`child("${childId}"): that test doesn't declare inside: "${parent.itemId}".`);
    }
    // A child's own attempt count caps it; past it, the call does nothing.
    const of = ctx.plan.childAttempts?.get(childId) ?? parent.of;
    if (parent.number > of) return "skipped";
    const item: PlanItem = { itemId: childId, number: parent.number, of };
    // A child with several parents runs each number once, in the first parent that gets to it.
    const key = `${childId}#${item.number}`;
    const earlier = ctx.childRanIn.get(key);
    if (earlier && earlier.parent !== parent.itemId) return earlier.outcome;
    if (ctx.mode !== "normal") {
      const s = this.o.repo.currentAttempt(ctx.row.id, childId, parent.number)?.status;
      const keep = ctx.mode === "resume" ? s !== undefined && DECIDED.includes(s) : s !== undefined && s !== "broken";
      if (keep) return s as Outcome;
    }
    const need = this.brokenNeed(ctx, childId);
    if (need) {
      this.skipAttempt(ctx, item, parentId, `Skipped: ${need}`);
      return "skipped";
    }
    for (;;) {
      const { outcome, attemptId } = await this.runAttempt(ctx, item, parentId);
      ctx.childRanIn.set(key, { parent: parent.itemId, outcome });
      if (outcome !== "broken" || !ctx.pauseOnBroken || ctx.run.control.stopMode) return outcome;
      const d = await this.pauseOnBroken(ctx, childId, attemptId);
      this.emit("run.decision", { decision: d, testId: childId, number: parent.number }, ctx.row.id);
      if (d !== "retry") return outcome;
      const r = await this.o.packs.refresh(ctx.row.pack_id, ctx.pack);
      if (r.reloaded) ctx.pack = r.pack;
    }
  }

}
