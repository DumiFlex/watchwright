import { EventEmitter } from "node:events";
import type Database from "better-sqlite3";

// The event log is the spine of Watchwright: everything that happens is one row with a growing
// sequence number. The WebSocket streams it, the web app rebuilds state from it, `GET /events`
// waits on it, and resume after a crash reads it (docs/plan.md, section 2.1).

export interface WwEvent {
  seq: number;
  time: string;
  /** Namespaced, open set: `run.started`, `attempt.finished`, later `scrape.record`. */
  type: string;
  runId?: string;
  attemptId?: string;
  data: Record<string, unknown>;
}

export interface EventFilter {
  runId?: string | undefined;
  /** Event types or `prefix.*` patterns. */
  types?: readonly string[] | undefined;
}

export const EVENTS_MIGRATION_SQL = `
  CREATE TABLE events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    time       TEXT NOT NULL,
    type       TEXT NOT NULL,
    run_id     TEXT,
    attempt_id TEXT,
    data       TEXT NOT NULL
  );
  CREATE INDEX events_run ON events (run_id, seq);
`;

interface Row {
  seq: number;
  time: string;
  type: string;
  run_id: string | null;
  attempt_id: string | null;
  data: string;
}

const TYPE = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

export function matches(event: WwEvent, filter: EventFilter): boolean {
  if (filter.runId !== undefined && event.runId !== undefined && event.runId !== filter.runId) return false;
  if (filter.types && filter.types.length > 0) {
    return filter.types.some((t) => (t.endsWith(".*") ? event.type.startsWith(t.slice(0, -1)) : event.type === t));
  }
  return true;
}

function fromRow(r: Row): WwEvent {
  const e: WwEvent = { seq: r.seq, time: r.time, type: r.type, data: JSON.parse(r.data) as Record<string, unknown> };
  if (r.run_id !== null) e.runId = r.run_id;
  if (r.attempt_id !== null) e.attemptId = r.attempt_id;
  return e;
}

export class EventLog {
  private readonly emitter = new EventEmitter();
  private readonly insert: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.emitter.setMaxListeners(0);
    this.insert = db.prepare("INSERT INTO events (time, type, run_id, attempt_id, data) VALUES (?, ?, ?, ?, ?)");
  }

  /** Appends one event and tells every listener. */
  append(type: string, data: Record<string, unknown> = {}, ref: { runId?: string | undefined; attemptId?: string | undefined } = {}): WwEvent {
    if (!TYPE.test(type)) throw new Error(`Event type "${type}" must be a namespaced lowercase name like "run.started".`);
    const time = new Date().toISOString();
    const info = this.insert.run(time, type, ref.runId ?? null, ref.attemptId ?? null, JSON.stringify(data));
    const event: WwEvent = { seq: Number(info.lastInsertRowid), time, type, data };
    if (ref.runId !== undefined) event.runId = ref.runId;
    if (ref.attemptId !== undefined) event.attemptId = ref.attemptId;
    this.emitter.emit("event", event);
    return event;
  }

  /** Events after `seq`, oldest first, at most `limit`. */
  after(seq: number, filter: EventFilter = {}, limit = 500): WwEvent[] {
    const out: WwEvent[] = [];
    let cursor = seq;
    // Filter in JS so type patterns stay simple; read in pages so a narrow filter still fills `limit`.
    const page = this.db.prepare(
      filter.runId === undefined
        ? "SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?"
        : "SELECT * FROM events WHERE seq > ? AND (run_id = ? OR run_id IS NULL) ORDER BY seq LIMIT ?",
    );
    for (;;) {
      const rows = (filter.runId === undefined ? page.all(cursor, 1000) : page.all(cursor, filter.runId, 1000)) as Row[];
      for (const r of rows) {
        const e = fromRow(r);
        if (matches(e, filter)) out.push(e);
        if (out.length >= limit) return out;
      }
      if (rows.length < 1000) return out;
      cursor = rows[rows.length - 1]!.seq;
    }
  }

  /** The newest sequence number, 0 when the log is empty. */
  head(): number {
    const row = this.db.prepare("SELECT MAX(seq) AS seq FROM events").get() as { seq: number | null };
    return row.seq ?? 0;
  }

  /**
   * Events after `seq`; when there are none yet, waits up to `waitMs` for the first matching one.
   * Resolves early with [] when `signal` aborts (the client went away).
   */
  async wait(seq: number, waitMs: number, filter: EventFilter = {}, limit = 500, signal?: AbortSignal): Promise<WwEvent[]> {
    const now = this.after(seq, filter, limit);
    if (now.length > 0 || waitMs <= 0) return now;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.emitter.off("event", onEvent);
        signal?.removeEventListener("abort", onAbort);
      };
      const onEvent = (e: WwEvent) => {
        if (e.seq <= seq || !matches(e, filter)) return;
        done();
        resolve(this.after(seq, filter, limit));
      };
      const onAbort = () => {
        done();
        resolve([]);
      };
      const timer = setTimeout(() => {
        done();
        resolve([]);
      }, waitMs);
      this.emitter.on("event", onEvent);
      signal?.addEventListener("abort", onAbort);
    });
  }

  /** Calls `fn` for every new event. Returns the function that stops listening. */
  subscribe(fn: (e: WwEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }
}
