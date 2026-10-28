import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { EventLog } from "../../events/log.js";
import { checkWhen, describeWhen, nextDue, type When } from "./when.js";

// Schedules and the timer that starts their runs (docs/plans/groundwork.md, section 6). One timer
// waits for the earliest due time; at each tick every due schedule starts its run, unless its last
// run is still going (that time is skipped). Times missed while the server was off start once or
// are skipped, as each schedule says.

export type MissedPolicy = "once" | "skip";

/** What a schedule starts: the input of `runs.start` without the pack. */
export type RunInput = Record<string, unknown>;

export interface Schedule {
  id: string;
  name: string;
  packId: string;
  when: When;
  /** The schedule in words. */
  says: string;
  run: RunInput;
  missed: MissedPolicy;
  enabled: boolean;
  nextAt: string | null;
  lastDueAt: string | null;
  lastRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name: string;
  packId: string;
  when: When;
  run?: RunInput;
  missed?: MissedPolicy;
  enabled?: boolean;
}

export interface ScheduledRun {
  runId: string;
  dueAt: string;
  startedAt: string;
}

/** What the scheduler needs from runs: start one, and whether one is still going. */
export interface RunStarter {
  start(schedule: Schedule): Promise<string>;
  /** True while the run is queued, running or paused. */
  going(runId: string): boolean;
}

export class ScheduleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Row {
  id: string;
  name: string;
  pack_id: string;
  when_json: string;
  run_json: string;
  missed: MissedPolicy;
  enabled: number;
  next_at: string | null;
  last_due_at: string | null;
  last_run_id: string | null;
  created_at: string;
  updated_at: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
/** A due time this far in the past at start-up counts as missed (a tick can be a little late). */
const MISSED_AFTER_MS = 60_000;
/** The timer wakes at least this often, so a clock change or a long sleep can't strand it. */
const MAX_WAIT_MS = 60 * 60_000;

function fromRow(r: Row): Schedule {
  const when = JSON.parse(r.when_json) as When;
  return {
    id: r.id,
    name: r.name,
    packId: r.pack_id,
    when,
    says: describeWhen(when),
    run: JSON.parse(r.run_json) as RunInput,
    missed: r.missed,
    enabled: r.enabled === 1,
    nextAt: r.next_at,
    lastDueAt: r.last_due_at,
    lastRunId: r.last_run_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private closed = false;
  private starter: RunStarter | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly events: EventLog,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): Schedule[] {
    return (this.db.prepare("SELECT * FROM schedules ORDER BY name COLLATE NOCASE").all() as Row[]).map(fromRow);
  }

  get(id: string): Schedule {
    const row = this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new ScheduleError("not_found", `No schedule ${id}.`, 404);
    return fromRow(row);
  }

  /** The schedule's runs, newest first. */
  runs(id: string, limit = 50): ScheduledRun[] {
    return (this.db.prepare("SELECT run_id, due_at, started_at FROM schedules_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?").all(id, limit) as { run_id: string; due_at: string; started_at: string }[]).map((r) => ({
      runId: r.run_id,
      dueAt: r.due_at,
      startedAt: r.started_at,
    }));
  }

  private check(input: Partial<ScheduleInput>, id: string | null): void {
    if (input.name !== undefined) {
      if (!NAME.test(input.name)) throw new ScheduleError("bad_input", "A schedule's name is up to 64 letters, digits, spaces, dots, dashes or underscores.");
      const other = this.db.prepare("SELECT id FROM schedules WHERE name = ? COLLATE NOCASE").get(input.name) as { id: string } | undefined;
      if (other && other.id !== id) throw new ScheduleError("name_taken", `There is already a schedule named "${input.name}".`, 409);
    }
    if (input.when !== undefined) {
      try {
        checkWhen(input.when);
      } catch (err) {
        throw new ScheduleError("bad_when", err instanceof Error ? err.message : String(err));
      }
    }
  }

  create(input: ScheduleInput): Schedule {
    this.check(input, null);
    const at = this.now().toISOString();
    const id = randomBytes(4).toString("hex");
    const enabled = input.enabled ?? true;
    const next = enabled ? nextDue(input.when, this.now(), this.now()) : null;
    this.db
      .prepare(
        `INSERT INTO schedules (id, name, pack_id, when_json, run_json, missed, enabled, next_at, last_due_at, last_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(id, input.name, input.packId, JSON.stringify(input.when), JSON.stringify(input.run ?? {}), input.missed ?? "once", enabled ? 1 : 0, next?.toISOString() ?? null, at, at);
    const s = this.get(id);
    this.events.append("schedule.created", { id, name: s.name, nextAt: s.nextAt });
    this.arm();
    return s;
  }

  update(id: string, input: Partial<ScheduleInput>): Schedule {
    const old = this.get(id);
    this.check(input, id);
    const s = { ...old, ...input };
    const timing = input.when !== undefined || input.enabled !== undefined;
    const next = !s.enabled ? null : timing ? nextDue(s.when, this.now(), this.now()) : old.nextAt ? new Date(old.nextAt) : nextDue(s.when, this.now(), this.now());
    this.db
      .prepare("UPDATE schedules SET name = ?, pack_id = ?, when_json = ?, run_json = ?, missed = ?, enabled = ?, next_at = ?, updated_at = ? WHERE id = ?")
      .run(s.name, s.packId, JSON.stringify(s.when), JSON.stringify(s.run), s.missed, s.enabled ? 1 : 0, next?.toISOString() ?? null, this.now().toISOString(), id);
    const out = this.get(id);
    this.events.append("schedule.updated", { id, name: out.name, enabled: out.enabled, nextAt: out.nextAt });
    this.arm();
    return out;
  }

  delete(id: string): void {
    const s = this.get(id);
    this.db.prepare("DELETE FROM schedules_runs WHERE schedule_id = ?").run(id);
    this.db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
    this.events.append("schedule.deleted", { id, name: s.name });
    this.arm();
  }

  /** Starts the schedule's run now, outside its times (its next time stays). */
  async runNow(id: string): Promise<string> {
    const s = this.get(id);
    if (!this.starter) throw new ScheduleError("not_ready", "The server is still starting.", 503);
    return this.fire(s, this.now(), "now");
  }

  /** Starts the timer. Times missed while the server was off are handled first. */
  begin(starter: RunStarter): void {
    this.starter = starter;
    const now = this.now();
    for (const s of this.list()) {
      if (!s.enabled || !s.nextAt) continue;
      const due = new Date(s.nextAt);
      if (now.getTime() - due.getTime() < MISSED_AFTER_MS) continue;
      this.events.append("schedule.missed", { id: s.id, name: s.name, missedAt: s.nextAt, policy: s.missed });
      this.setNext(s, nextDue(s.when, now, s.lastDueAt ? new Date(s.lastDueAt) : new Date(s.createdAt)));
      if (s.missed === "once") void this.fire(this.get(s.id), due, "missed").catch(() => undefined);
    }
    this.arm();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Starts every schedule that is due now. The timer calls this; tests call it with their own clock. */
  async tick(): Promise<void> {
    if (this.ticking || !this.starter) return;
    this.ticking = true;
    try {
      const now = this.now();
      const due = (this.db.prepare("SELECT * FROM schedules WHERE enabled = 1 AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at").all(now.toISOString()) as Row[]).map(fromRow);
      for (const s of due) {
        const at = new Date(s.nextAt!);
        this.setNext(s, nextDue(s.when, now, at));
        if (s.lastRunId && this.starter.going(s.lastRunId)) {
          this.db.prepare("UPDATE schedules SET last_due_at = ? WHERE id = ?").run(at.toISOString(), s.id);
          this.events.append("schedule.skipped", { id: s.id, name: s.name, dueAt: at.toISOString(), runId: s.lastRunId, reason: "The last run of this schedule is still going." });
          continue;
        }
        await this.fire(s, at, "due").catch(() => undefined);
      }
    } finally {
      this.ticking = false;
      this.arm();
    }
  }

  private setNext(s: Schedule, next: Date | null): void {
    this.db.prepare("UPDATE schedules SET next_at = ? WHERE id = ?").run(next?.toISOString() ?? null, s.id);
  }

  private async fire(s: Schedule, dueAt: Date, why: "due" | "missed" | "now"): Promise<string> {
    const startedAt = this.now().toISOString();
    try {
      const runId = await this.starter!.start(s);
      this.db.prepare("INSERT INTO schedules_runs (schedule_id, run_id, due_at, started_at) VALUES (?, ?, ?, ?)").run(s.id, runId, dueAt.toISOString(), startedAt);
      this.db.prepare(`UPDATE schedules SET last_run_id = ?${why === "now" ? "" : ", last_due_at = ?"} WHERE id = ?`).run(...(why === "now" ? [runId, s.id] : [runId, dueAt.toISOString(), s.id]));
      this.events.append("schedule.fired", { id: s.id, name: s.name, dueAt: dueAt.toISOString(), why }, { runId });
      return runId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (why !== "now") this.db.prepare("UPDATE schedules SET last_due_at = ? WHERE id = ?").run(dueAt.toISOString(), s.id);
      this.events.append("schedule.failed", { id: s.id, name: s.name, dueAt: dueAt.toISOString(), message });
      throw err;
    }
  }

  /** Sets the timer for the earliest due time (at most an hour away). */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.closed || !this.starter) return;
    const row = this.db.prepare("SELECT MIN(next_at) AS at FROM schedules WHERE enabled = 1 AND next_at IS NOT NULL").get() as { at: string | null };
    if (!row.at) return;
    const wait = Math.min(Math.max(0, new Date(row.at).getTime() - this.now().getTime()), MAX_WAIT_MS);
    this.timer = setTimeout(() => void this.tick(), wait);
    this.timer.unref();
  }
}
