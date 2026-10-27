import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { EventLog } from "../../events/log.js";
import { AttemptAborted, RunControl, type BrokenDecision } from "../../jobs/control.js";
import type { JobKind, KindPlan, PlanItem } from "../../jobs/kind.js";
import { AttemptRecorder, type ArtifactInfo } from "../../jobs/recorder.js";
import { BrowserSession } from "../../session/session.js";
import type { FrameHub } from "../live/hub.js";
import type { CollectorRecord, Helpers, Outcome, ParamValues } from "../packs/api.js";
import type { LoadedPack } from "../packs/loader.js";
import { resolveParams } from "../packs/order.js";
import type { PackRegistry } from "../packs/registry.js";
import { createHelpers } from "../testing/helpers.js";
import { classify } from "../testing/outcome.js";
import {
  attemptSummary,
  DECIDED,
  newId,
  runSummary,
  type AttemptStatus,
  type AttemptSummary,
  type PlanEntry,
  type RunMode,
  type RunOptions,
  type RunFilter,
  type RunRow,
  type RunsRepo,
  type RunSummary,
} from "./repo.js";
import { resultDocument, type ResultDocument } from "./results.js";

// The job runner: queue and site locks, one browser session per run, attempts with pause, retry,
// skip, stop and hot reload, resume after a crash, redo of broken attempts (docs/plan.md, section 6).

export const DEFAULT_TEST_TIMEOUT = 30 * 60_000;
export const DEFAULT_PAUSE_LIMIT_MINUTES = 20;
/** How long a timed-out attempt gets to reach its next pause point before the context is replaced. */
const ABORT_GRACE_MS = 10_000;
/** After "stop now", how long the attempt's body gets to notice before it is filed as stopped anyway. */
const STOP_GRACE_MS = 5_000;

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
  /** When a broken pause skips by itself. */
  deadline: string | null;
  stopping: "after" | "now" | null;
  attemptId: string | null;
  testId: string | null;
  step: string | null;
  pages: { id: string; url: string }[];
  activePageId: string | null;
}

export interface RunDetail extends RunSummary {
  plan: (PlanEntry & { status: AttemptStatus | "pending"; attemptId: string | null })[];
  attempts: AttemptSummary[];
  live: LiveSnapshot | null;
}

interface ActiveRun {
  id: string;
  siteKey: string;
  control: RunControl;
  session: BrowserSession | null;
  attemptId: string | null;
  testId: string | null;
  step: string | null;
  state: Record<string, unknown>;
  collected: Map<string, CollectorRecord[]>;
  shutdown: boolean;
  done: Promise<void>;
  videoWarned: boolean;
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
  pauseOnBroken: boolean;
  pauseLimitMs: number;
}

export interface EngineOptions {
  repo: RunsRepo;
  events: EventLog;
  packs: PackRegistry;
  frames: FrameHub;
  /** Folder that holds `runs/`; artifact paths are relative to it. */
  dataDir: string;
  kinds: readonly JobKind[];
}

export class Engine {
  private readonly active = new Map<string, ActiveRun>();
  private readonly kinds: Map<string, JobKind>;
  private closing = false;

  constructor(private readonly o: EngineOptions) {
    this.kinds = new Map(o.kinds.map((k) => [k.name, k]));
  }

  /** On boot: runs a crash left running become interrupted, ready for resume. */
  recover(): void {
    for (const id of this.o.repo.interruptLeftovers()) this.o.events.append("run.interrupted", { reason: "server_stopped" }, { runId: id });
  }

  list(filter: RunFilter = {}): RunSummary[] {
    return this.o.repo.runs(filter).map((r) => runSummary(r, this.o.repo.counts(r.id)));
  }

  /** Deletes a run that isn't queued or going, with its rows and its folder. */
  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const r = this.requireRun(id);
    if (this.active.has(id) || r.status === "queued") throw new EngineError("conflict", "Stop the run before deleting it.", 409);
    this.o.repo.deleteRun(id);
    await rm(path.join(this.o.dataDir, "runs", id), { recursive: true, force: true });
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
    return { ...runSummary(r, this.o.repo.counts(id)), plan, attempts, live: this.snapshot(id) };
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
      deadline: run.control.deadline,
      stopping: run.control.stopMode,
      attemptId: run.attemptId,
      testId: run.testId,
      step: run.step,
      pages: run.session?.openPages() ?? [],
      activePageId: run.session?.activePage ?? null,
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
    const kind = this.kinds.get("test")!;
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
      status: "queued",
      started_by: input.startedBy,
      created_at: new Date().toISOString(),
    });
    this.o.events.append("run.queued", { packId: input.packId, tests: input.tests ?? [], params, startedBy: input.startedBy }, { runId: id });
    this.schedule();
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

  pause(id: string): RunDetail {
    const run = this.requireActive(id);
    if (!run.control.requestPause()) throw new EngineError("conflict", "The run is already pausing, paused or stopping.", 409);
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

  /** Starts every queued run whose site is free. */
  schedule(): void {
    if (this.closing) return;
    const busy = new Set([...this.active.values()].map((r) => r.siteKey));
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

  /** Resolves when the run is no longer active (for tests and the CLI). */
  async settled(id: string): Promise<void> {
    await this.active.get(id)?.done;
  }

  private emit(type: string, data: Record<string, unknown>, runId: string, attemptId?: string | null) {
    this.o.events.append(type, data, { runId, attemptId: attemptId ?? undefined });
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
          this.emit(type, { reason: info.reason, deadline: info.deadline, attemptId: run.attemptId, testId: run.testId }, row.id);
        },
      }),
      session: null,
      attemptId: null,
      testId: null,
      step: null,
      state: JSON.parse(row.state) as Record<string, unknown>,
      collected: new Map(),
      shutdown: false,
      done: Promise.resolve(),
      videoWarned: false,
    };
    this.active.set(row.id, run);
    run.done = this.execute(row, run)
      .catch((err: unknown) => {
        this.o.repo.updateRun(row.id, { status: "interrupted", error: err instanceof Error ? err.message : String(err) });
        this.emit("run.interrupted", { reason: "engine_error", message: err instanceof Error ? err.message : String(err) }, row.id);
      })
      .finally(() => {
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
      repo.updateRun(row.id, { status: "failed_to_start", error: message, finished_at: new Date().toISOString() });
      this.emit("run.failed_to_start", { message }, row.id);
    };

    let pack: LoadedPack;
    try {
      pack = (await packs.refresh(row.pack_id)).pack;
    } catch (err) {
      failStart(`The pack doesn't load: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      return;
    }
    const kind = this.kinds.get(row.job_kind);
    if (!kind) {
      failStart(`No job kind "${row.job_kind}" is loaded.`);
      return;
    }
    const params = JSON.parse(row.params) as ParamValues;
    const options = JSON.parse(row.options) as RunOptions;
    let plan: KindPlan;
    try {
      plan = kind.plan(pack, params, JSON.parse(row.tests) as string[], { attempts: options.attempts });
    } catch (err) {
      failStart(err instanceof Error ? err.message : String(err));
      return;
    }
    const entries: PlanEntry[] = plan.items.map((i) => {
      const children = plan.children.get(i.itemId);
      return { testId: i.itemId, title: kind.describe(pack, i.itemId).title, number: i.number, of: i.of, ...(children && children.length > 0 ? { children } : {}) };
    });
    repo.updateRun(row.id, { plan: JSON.stringify(entries) });
    this.emit("run.planned", { plan: entries }, row.id);

    const o = pack.options;
    let session: BrowserSession;
    try {
      session = await BrowserSession.launch(
        {
          browser: o.browser?.name ?? "chromium",
          headless: o.browser?.headless ?? true,
          viewport: o.browser?.viewport ?? { width: 1280, height: 800 },
          launch: o.browser?.launch,
          context: o.browser?.context,
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
      failStart(`The browser didn't start: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      return;
    }
    run.session = session;

    try {
      for (const c of o.collectors ?? []) {
        run.collected.set(c.name, []);
        await c.attach(session.context, (entry) => run.collected.get(c.name)?.push(entry));
      }
      await session.restartCapture(null);
      const page = await session.mainPage();
      const setupRecorder = new AttemptRecorder(path.join(this.o.dataDir, "runs", row.id, "setup"), this.o.dataDir, () => undefined, (l) =>
        this.emit("run.log", { ...l }, row.id),
      );
      try {
        await kind.setup({ pack, params, page, session, helpers: () => this.helpers(run, pack, page, setupRecorder, new Map(), null) });
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
        pauseOnBroken: options.pauseOnBroken ?? o.run?.pauseOnBroken ?? true,
        pauseLimitMs: (options.pauseLimitMinutes ?? o.run?.pauseLimitMinutes ?? DEFAULT_PAUSE_LIMIT_MINUTES) * 60_000,
      };
      const todo = this.select(ctx);
      for (let i = 0; i < plan.items.length; i++) {
        await run.control.checkpoint("boundary");
        if (run.control.stopMode) break;
        const item = plan.items[i]!;
        if (!todo.has(`${item.itemId}#${item.number}`)) continue;

        const r = await packs.refresh(row.pack_id);
        if (r.reloaded) {
          ctx.pack = r.pack;
          this.emit("pack.reloaded", { packId: row.pack_id }, row.id);
        } else if (r.error) this.emit("run.log", { level: "warn", message: `The pack changed but doesn't build, so the old code keeps running: ${r.error}` }, row.id);

        const brokenNeed = this.brokenNeed(ctx, item.itemId);
        if (brokenNeed) {
          this.skipAttempt(ctx, item, null, `Skipped: ${brokenNeed}`);
          continue;
        }
        const { outcome, attemptId } = await this.runAttempt(ctx, item, null);
        if (run.control.stopMode || run.shutdown) break;
        if (outcome === "broken" && ctx.pauseOnBroken) {
          const d = await this.pauseOnBroken(ctx, item.itemId, attemptId);
          this.emit("run.decision", { decision: d, testId: item.itemId, number: item.number }, row.id);
          if (d === "retry") i--;
          else if (d === "stop") break;
        }
      }
    } finally {
      await session.stopCapture();
      await session.close();
      run.session = null;
    }
    const status = run.shutdown ? "interrupted" : run.control.stopMode ? "stopped" : "finished";
    repo.updateRun(row.id, { status, finished_at: status === "interrupted" ? null : new Date().toISOString() });
    const counts = repo.counts(row.id);
    if (status === "interrupted") this.emit("run.interrupted", { reason: "server_stopped" }, row.id);
    else this.emit("run.finished", { status, counts }, row.id);
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
      const of = last?.of ?? parent?.of;
      if (of === undefined || of === 0) continue;
      const a = this.o.repo.currentAttempt(ctx.row.id, n, of);
      if (!a) return `${n} didn't run.`;
      if (["broken", "stopped", "skipped", "interrupted"].includes(a.status)) return `${n} ${a.status === "skipped" ? "was skipped" : `ended ${a.status}`}.`;
    }
    return null;
  }

  private skipAttempt(ctx: RunCtx, item: PlanItem, parentId: string | null, reason: string): void {
    const id = newId(6);
    const title = ctx.kind.describe(ctx.pack, item.itemId).title;
    this.o.repo.insertSkipped({ id, runId: ctx.row.id, kind: ctx.kind.name, itemId: item.itemId, title, number: item.number, of: item.of, parentId, reason });
    this.emit("attempt.finished", { testId: item.itemId, number: item.number, of: item.of, status: "skipped", reason, parentId }, ctx.row.id, id);
  }

  private helpers(run: ActiveRun, pack: LoadedPack, page: Page, recorder: AttemptRecorder, saves: Map<string, unknown>, attemptId: string | null): Helpers {
    return createHelpers(
      {
        page,
        context: run.session!.context,
        baseURL: pack.options.site.baseURL,
        control: run.control,
        recorder,
        session: run.session!,
        flagKinds: { ...(pack.options.flags ?? {}) },
        idleCheck: pack.options.idle,
        chapters: pack.options.run?.chapters ?? false,
        save: (k, v) => saves.set(k, v),
        load: (k) => (saves.has(k) ? saves.get(k) : run.state[k]),
        onStep: (title) => {
          run.step = title;
          if (attemptId) this.emit("attempt.step", { title }, run.id, attemptId);
        },
        onFlag: (f) => {
          if (attemptId) this.emit("attempt.flag", { ...f }, run.id, attemptId);
        },
      },
      pack.options.helpers,
    );
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
    this.emit("attempt.started", { testId: item.itemId, title, number: item.number, of: item.of, try: tryNo, parentId }, row.id, id);

    const top = parentId === null;
    const o = pack.options.run ?? {};
    const traceMode = ctx.options.trace ?? o.trace ?? "problems";
    const video = ctx.options.video ?? o.video ?? true;
    if (top) {
      await session.restartCapture(video ? dir : null);
      if (traceMode !== "never") await session.startTraceChunk();
    }

    const page = await session.mainPage();
    const saves = new Map<string, unknown>();
    const last = item.number === item.of;
    let error: unknown;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    try {
      const body = ctx.kind.execute({
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
        helpers: () => this.helpers(run, pack, page, recorder, saves, id),
        runChild: (childId) => this.runChild(ctx, item, id, childId),
      });
      // After "stop now" the body normally fails at once (its page is gone); don't wait on one that hangs.
      const stopped = run.control.whenStoppedNow.then(() => new Promise<void>((r) => setTimeout(r, STOP_GRACE_MS)));
      if (!top) await Promise.race([body, stopped]);
      else {
        const limit = kind.describe(pack, item.itemId).timeout ?? o.testTimeout ?? DEFAULT_TEST_TIMEOUT;
        const started = Date.now();
        const pausedBefore = run.control.pausedMs();
        const timedOut = new Promise<never>((_, reject) => {
          watchdog = setInterval(() => {
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

    const { status, error: attemptError } = classify({
      error,
      flags: recorder.flags,
      stopped: run.control.stopMode === "now" || run.shutdown,
    });
    const finalStatus: AttemptStatus = run.shutdown && status === "stopped" ? "interrupted" : status;

    if (top) {
      for (const v of await session.restartCapture(null).catch(() => [])) recorder.register("video", `video ${v.pageId}`, v.path, "video/webm");
      if (traceMode !== "never") {
        const keep = traceMode === "always" || finalStatus === "broken" || finalStatus === "failed";
        const file = path.join(dir, "trace.zip");
        if (await session.stopTraceChunk(keep ? file : null)) recorder.register("trace", "trace", file, "application/zip");
      }
      for (const [name, records] of run.collected) {
        if (records.length === 0) continue;
        recorder.write("collector", name, path.join("collectors", `${name}.json`), JSON.stringify(records, null, 2), "application/json");
        records.length = 0;
      }
    }

    if (last && (finalStatus === "passed" || finalStatus === "failed") && saves.size > 0) {
      for (const [k, v] of saves) run.state[k] = v;
      this.o.repo.updateRun(row.id, { state: JSON.stringify(run.state) });
    }

    this.o.repo.finishAttempt(id, {
      status: finalStatus,
      flags: recorder.flags,
      metrics: recorder.metrics,
      notes: recorder.notes,
      texts: recorder.texts,
      log: recorder.log,
      error: attemptError,
    });
    const doc = resultDocument(this.o.repo.attempt(id)!, this.o.repo.artifacts(id));
    try {
      writeFileSync(path.join(dir, "result.json"), JSON.stringify(doc, null, 2));
    } catch {
      // the folder went away (disk full, removed by hand): the database still has the result
    }
    this.emit(
      "attempt.finished",
      { testId: item.itemId, number: item.number, of: item.of, try: tryNo, status: finalStatus, error: attemptError?.message ?? null, flags: recorder.flags.map((f) => f.name), parentId },
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

  private async runChild(ctx: RunCtx, parent: PlanItem, parentId: string, childId: string): Promise<Outcome> {
    const kids = ctx.plan.children.get(parent.itemId) ?? [];
    if (!kids.includes(childId)) {
      const t = ctx.pack.tests.find((x) => x.id === childId);
      if (t?.meta.inside === parent.itemId) return "skipped"; // added to the pack after this run was planned
      throw new Error(`child("${childId}"): that test doesn't declare inside: "${parent.itemId}".`);
    }
    const item: PlanItem = { itemId: childId, number: parent.number, of: parent.of };
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
      if (outcome !== "broken" || !ctx.pauseOnBroken || ctx.run.control.stopMode) return outcome;
      const d = await this.pauseOnBroken(ctx, childId, attemptId);
      this.emit("run.decision", { decision: d, testId: childId, number: parent.number }, ctx.row.id);
      if (d !== "retry") return outcome;
      const r = await this.o.packs.refresh(ctx.row.pack_id);
      if (r.reloaded) ctx.pack = r.pack;
    }
  }

}
