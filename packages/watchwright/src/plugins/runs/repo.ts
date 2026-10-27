import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { ArtifactInfo, FlagRecord, LogLine, MetricRecord } from "../../jobs/recorder.js";
import type { Outcome, ParamValues } from "../packs/api.js";
import type { AttemptError } from "../testing/outcome.js";
import type { QueueEdits } from "./queue.js";

// Rows of the runs plugin: runs, their attempts (with retry history) and artifacts.

export type RunStatus = "queued" | "running" | "pausing" | "paused" | "finished" | "stopped" | "interrupted" | "failed_to_start";
export type RunMode = "normal" | "resume" | "redo";
export type AttemptStatus = Outcome | "running" | "interrupted";

export interface RunFilter {
  limit?: number | undefined;
  packId?: string | undefined;
  statuses?: readonly RunStatus[] | undefined;
  before?: string | undefined;
}

export const ACTIVE_STATUSES: readonly RunStatus[] = ["running", "pausing", "paused"];
/** Outcomes a resume keeps; everything else runs again. */
export const DECIDED: readonly AttemptStatus[] = ["passed", "failed", "skipped"];

/** Migration 2: shots taken as a set (scroll shots) keep the set's name. */
export const RUNS_ARTIFACT_SET_SQL = `ALTER TABLE runs_artifacts ADD COLUMN set_name TEXT;`;

/** Migration 3: facts a run learns while it runs (`info(key, value)` in setup and tests). */
export const RUNS_INFO_SQL = `ALTER TABLE runs ADD COLUMN info TEXT NOT NULL DEFAULT '{}';`;

export const RUNS_MIGRATION_SQL = `
  CREATE TABLE runs (
    id          TEXT PRIMARY KEY,
    pack_id     TEXT NOT NULL,
    pack_name   TEXT NOT NULL,
    pack_path   TEXT NOT NULL,
    site_key    TEXT NOT NULL,
    job_kind    TEXT NOT NULL DEFAULT 'test',
    tests       TEXT NOT NULL,
    params      TEXT NOT NULL,
    options     TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'normal',
    plan        TEXT NOT NULL DEFAULT '[]',
    state       TEXT NOT NULL DEFAULT '{}',
    started_by  TEXT NOT NULL,
    error       TEXT,
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT
  );
  CREATE INDEX runs_status ON runs (status, created_at);

  CREATE TABLE runs_attempts (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    job_kind    TEXT NOT NULL DEFAULT 'test',
    item_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    number      INTEGER NOT NULL,
    of_count    INTEGER NOT NULL,
    try         INTEGER NOT NULL,
    current     INTEGER NOT NULL DEFAULT 1,
    parent_id   TEXT,
    status      TEXT NOT NULL,
    flags       TEXT NOT NULL DEFAULT '[]',
    metrics     TEXT NOT NULL DEFAULT '{}',
    notes       TEXT NOT NULL DEFAULT '[]',
    texts       TEXT NOT NULL DEFAULT '{}',
    log         TEXT NOT NULL DEFAULT '[]',
    error       TEXT,
    folder      TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX runs_attempts_run ON runs_attempts (run_id, item_id, number, try);

  CREATE TABLE runs_artifacts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id   TEXT NOT NULL REFERENCES runs_attempts (id) ON DELETE CASCADE,
    run_id       TEXT NOT NULL,
    kind         TEXT NOT NULL,
    name         TEXT NOT NULL,
    content_type TEXT NOT NULL,
    path         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX runs_artifacts_attempt ON runs_artifacts (attempt_id);
`;

export interface RunRow {
  id: string;
  pack_id: string;
  pack_name: string;
  pack_path: string;
  site_key: string;
  job_kind: string;
  tests: string;
  params: string;
  options: string;
  status: RunStatus;
  mode: RunMode;
  plan: string;
  state: string;
  info: string;
  started_by: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AttemptRow {
  id: string;
  run_id: string;
  job_kind: string;
  item_id: string;
  title: string;
  number: number;
  of_count: number;
  try: number;
  current: number;
  parent_id: string | null;
  status: AttemptStatus;
  flags: string;
  metrics: string;
  notes: string;
  texts: string;
  log: string;
  error: string | null;
  folder: string;
  started_at: string;
  finished_at: string | null;
}

export interface RunOptions {
  pauseOnBroken?: boolean;
  pauseLimitMinutes?: number;
  /** Attempts for every test, instead of each test's `runs`. */
  attempts?: number;
  /** Which attempts keep a trace, instead of the pack's setting. */
  trace?: "problems" | "always" | "never";
  /** Record video, instead of the pack's setting. */
  video?: boolean;
  /** Queue edits made while the run went (order, skipped attempts). */
  queue?: QueueEdits;
}

export interface PlanEntry {
  testId: string;
  title: string;
  number: number;
  of: number;
  /** Child tests the parent runs from its body. */
  children?: string[];
  /** Skipped from the queue before it started. */
  skip?: boolean;
}

export interface AttemptSummary {
  id: string;
  runId: string;
  kind: string;
  testId: string;
  title: string;
  number: number;
  of: number;
  try: number;
  current: boolean;
  parentId: string | null;
  status: AttemptStatus;
  flags: FlagRecord[];
  metrics: Record<string, MetricRecord>;
  error: AttemptError | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface RunSummary {
  id: string;
  packId: string;
  packName: string;
  siteKey: string;
  kind: string;
  tests: string[];
  params: ParamValues;
  /** Facts the run saved while it ran (`info(key, value)`), in the order first saved. */
  info: Record<string, string | number | boolean>;
  options: RunOptions;
  status: RunStatus;
  mode: RunMode;
  startedBy: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: Record<AttemptStatus, number> & { planned: number };
}

export const newId = (bytes: number) => randomBytes(bytes).toString("hex");

const EMPTY_COUNTS = (): RunSummary["counts"] => ({ passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, running: 0, interrupted: 0, planned: 0 });

export class RunsRepo {
  constructor(readonly db: Database.Database) {}

  insertRun(r: Omit<RunRow, "plan" | "state" | "info" | "mode" | "error" | "started_at" | "finished_at" | "job_kind"> & { job_kind: string }): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, pack_id, pack_name, pack_path, site_key, job_kind, tests, params, options, status, started_by, created_at)
         VALUES (@id, @pack_id, @pack_name, @pack_path, @site_key, @job_kind, @tests, @params, @options, @status, @started_by, @created_at)`,
      )
      .run(r);
  }

  run(id: string): RunRow | null {
    return (this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined) ?? null;
  }

  /** Runs newest first. `before` is a cursor: the `createdAt` of the last run of the previous page. */
  runs(filter: RunFilter = {}): RunRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.packId) {
      where.push("pack_id = ?");
      args.push(filter.packId);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      where.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
      args.push(...filter.statuses);
    }
    if (filter.before) {
      where.push("created_at < ?");
      args.push(filter.before);
    }
    const sql = `SELECT * FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, filter.limit ?? 100) as RunRow[];
  }

  /** Removes a run with its attempts and artifacts (the events stay in the log). */
  deleteRun(id: string): boolean {
    return this.db.prepare("DELETE FROM runs WHERE id = ?").run(id).changes > 0;
  }

  queued(): RunRow[] {
    return this.db.prepare("SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at, rowid").all() as RunRow[];
  }

  updateRun(id: string, fields: Partial<Pick<RunRow, "status" | "mode" | "plan" | "options" | "state" | "info" | "error" | "started_at" | "finished_at">>): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    this.db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...fields, id });
  }

  /** Marks runs and attempts a crash left behind as interrupted. Returns the run ids. */
  interruptLeftovers(): string[] {
    const ids = (this.db.prepare(`SELECT id FROM runs WHERE status IN ('running', 'pausing', 'paused')`).all() as { id: string }[]).map((r) => r.id);
    this.db.transaction(() => {
      this.db.prepare(`UPDATE runs SET status = 'interrupted' WHERE status IN ('running', 'pausing', 'paused')`).run();
      this.db.prepare(`UPDATE runs_attempts SET status = 'interrupted' WHERE status = 'running'`).run();
    })();
    return ids;
  }

  /** Starts a new try of an attempt: older tries of the same (item, number) stop being current. */
  insertAttempt(a: { id: string; runId: string; kind: string; itemId: string; title: string; number: number; of: number; parentId: string | null; folder: (tryNo: number) => string }): number {
    return this.db.transaction(() => {
      const prev = this.db.prepare("SELECT MAX(try) AS t FROM runs_attempts WHERE run_id = ? AND item_id = ? AND number = ?").get(a.runId, a.itemId, a.number) as { t: number | null };
      const tryNo = (prev.t ?? 0) + 1;
      this.db.prepare("UPDATE runs_attempts SET current = 0 WHERE run_id = ? AND item_id = ? AND number = ?").run(a.runId, a.itemId, a.number);
      this.db
        .prepare(
          `INSERT INTO runs_attempts (id, run_id, job_kind, item_id, title, number, of_count, try, current, parent_id, status, folder, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'running', ?, ?)`,
        )
        .run(a.id, a.runId, a.kind, a.itemId, a.title, a.number, a.of, tryNo, a.parentId, a.folder(tryNo), new Date().toISOString());
      return tryNo;
    })();
  }

  finishAttempt(
    id: string,
    f: { status: AttemptStatus; flags: FlagRecord[]; metrics: Record<string, MetricRecord>; notes: string[]; texts: Record<string, string>; log: LogLine[]; error: AttemptError | null },
  ): void {
    this.db
      .prepare("UPDATE runs_attempts SET status = ?, flags = ?, metrics = ?, notes = ?, texts = ?, log = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(f.status, JSON.stringify(f.flags), JSON.stringify(f.metrics), JSON.stringify(f.notes), JSON.stringify(f.texts), JSON.stringify(f.log), f.error ? JSON.stringify(f.error) : null, new Date().toISOString(), id);
  }

  /** A skipped attempt that never ran: a row so the result says why. */
  insertSkipped(a: { id: string; runId: string; kind: string; itemId: string; title: string; number: number; of: number; parentId: string | null; reason: string }): void {
    this.insertAttempt({ ...a, folder: () => "" });
    this.finishAttempt(a.id, { status: "skipped", flags: [], metrics: {}, notes: [a.reason], texts: {}, log: [], error: null });
  }

  attempt(id: string): AttemptRow | null {
    return (this.db.prepare("SELECT * FROM runs_attempts WHERE id = ?").get(id) as AttemptRow | undefined) ?? null;
  }

  attempts(runId: string, history = false): AttemptRow[] {
    return this.db
      .prepare(`SELECT * FROM runs_attempts WHERE run_id = ? ${history ? "" : "AND current = 1"} ORDER BY started_at, rowid`)
      .all(runId) as AttemptRow[];
  }

  /** The current try of an attempt, if it ran. */
  currentAttempt(runId: string, itemId: string, number: number): AttemptRow | null {
    return (
      (this.db.prepare("SELECT * FROM runs_attempts WHERE run_id = ? AND item_id = ? AND number = ? AND current = 1").get(runId, itemId, number) as
        | AttemptRow
        | undefined) ?? null
    );
  }

  addArtifact(attemptId: string, runId: string, a: ArtifactInfo): void {
    this.db
      .prepare("INSERT INTO runs_artifacts (attempt_id, run_id, kind, name, content_type, path, size, set_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(attemptId, runId, a.kind, a.name, a.contentType, a.path, a.size, a.set ?? null, new Date().toISOString());
  }

  artifacts(attemptId: string): ArtifactInfo[] {
    const rows = this.db
      .prepare("SELECT kind, name, content_type AS contentType, path, size, set_name AS setName FROM runs_artifacts WHERE attempt_id = ? ORDER BY id")
      .all(attemptId) as (Omit<ArtifactInfo, "set"> & { setName: string | null })[];
    return rows.map(({ setName, ...a }) => (setName === null ? a : { ...a, set: setName }));
  }

  artifactByPath(rel: string): { contentType: string } | null {
    return (this.db.prepare("SELECT content_type AS contentType FROM runs_artifacts WHERE path = ? LIMIT 1").get(rel) as { contentType: string } | undefined) ?? null;
  }

  counts(runId: string): RunSummary["counts"] {
    const c = EMPTY_COUNTS();
    for (const r of this.db.prepare("SELECT status, COUNT(*) AS n FROM runs_attempts WHERE run_id = ? AND current = 1 AND parent_id IS NULL GROUP BY status").all(runId) as {
      status: AttemptStatus;
      n: number;
    }[])
      c[r.status] = r.n;
    const run = this.run(runId);
    c.planned = run ? (JSON.parse(run.plan) as PlanEntry[]).length : 0;
    return c;
  }
}

export function runSummary(r: RunRow, counts: RunSummary["counts"]): RunSummary {
  return {
    id: r.id,
    packId: r.pack_id,
    packName: r.pack_name,
    siteKey: r.site_key,
    kind: r.job_kind,
    tests: JSON.parse(r.tests) as string[],
    params: JSON.parse(r.params) as ParamValues,
    info: JSON.parse(r.info ?? "{}") as Record<string, string | number | boolean>,
    options: JSON.parse(r.options) as RunOptions,
    status: r.status,
    mode: r.mode,
    startedBy: r.started_by,
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    counts,
  };
}

export function attemptSummary(a: AttemptRow): AttemptSummary {
  return {
    id: a.id,
    runId: a.run_id,
    kind: a.job_kind,
    testId: a.item_id,
    title: a.title,
    number: a.number,
    of: a.of_count,
    try: a.try,
    current: a.current === 1,
    parentId: a.parent_id,
    status: a.status,
    flags: JSON.parse(a.flags) as FlagRecord[],
    metrics: JSON.parse(a.metrics) as Record<string, MetricRecord>,
    error: a.error ? (JSON.parse(a.error) as AttemptError) : null,
    startedAt: a.started_at,
    finishedAt: a.finished_at,
    durationMs: a.finished_at ? Date.parse(a.finished_at) - Date.parse(a.started_at) : null,
  };
}
