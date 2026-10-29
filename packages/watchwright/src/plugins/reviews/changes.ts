import type { CompareCell, CompareRun, Comparison } from "./compare.js";

// What changed in a run since an earlier run of the same pack and params: the attempts whose
// status, flags, score or time moved, plus tests one of the two runs didn't have. Built from a
// comparison of the two runs, so it sees the same attempts the compare page does.

export type Change = "status" | "flags" | "score" | "time" | "new" | "gone";

export interface ChangeSide {
  runId: string;
  attemptId: string;
  status: string;
  durationMs: number | null;
  score: number | null;
  flags: string[];
}

export interface ChangeRow {
  testId: string;
  title: string;
  number: number;
  before: ChangeSide | null;
  after: ChangeSide | null;
  changes: Change[];
}

export interface RunChanges {
  /** The earlier run, or null when there is none to compare with. */
  previous: CompareRun | null;
  rows: ChangeRow[];
  /** Attempts in both runs that didn't change. */
  same: number;
}

/** A score moves when it differs by at least this much (on 1 to 5). */
export const SCORE_STEP = 0.5;
/** A time moves when it is this many times longer or shorter, and by at least `TIME_MIN_MS`. */
export const TIME_RATIO = 1.5;
export const TIME_MIN_MS = 2000;

const side = (c: CompareCell): ChangeSide => ({
  runId: c.runId,
  attemptId: c.attemptId,
  status: c.status,
  durationMs: c.durationMs,
  score: c.score,
  flags: [...new Set(c.flags.map((f) => f.name))].sort(),
});

export function changesOf(before: ChangeSide | null, after: ChangeSide | null): Change[] {
  if (!before) return after ? ["new"] : [];
  if (!after) return ["gone"];
  const out: Change[] = [];
  if (before.status !== after.status) out.push("status");
  if (before.flags.join("\u0000") !== after.flags.join("\u0000")) out.push("flags");
  if (before.score !== null && after.score !== null && Math.abs(before.score - after.score) >= SCORE_STEP) out.push("score");
  const [a, b] = [before.durationMs, after.durationMs];
  if (a !== null && b !== null && Math.abs(a - b) >= TIME_MIN_MS && Math.max(a, b) >= TIME_RATIO * Math.max(1, Math.min(a, b))) out.push("time");
  return out;
}

/** What `pickPrevious` needs of a run. `tests` is the run's chosen tests; empty means all of them. */
export interface RunPick {
  id: string;
  params: Record<string, unknown>;
  tests: string[];
}

/** Same params, whatever the key order. */
export const sameParams = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k] === b[k]);
};

const sameTests = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/**
 * The run to compare `run` with, from `earlier` (newest first): the newest with the same params and
 * the same chosen tests, else the newest with the same params. A full run is compared with the last
 * full run, not with a quick run of three tests that happened in between.
 */
export function pickPrevious(run: RunPick, earlier: readonly RunPick[]): string | undefined {
  const candidates = earlier.filter((r) => r.id !== run.id && sameParams(r.params, run.params));
  return (candidates.find((r) => sameTests(r.tests, run.tests)) ?? candidates[0])?.id;
}

/** Changes from the first run of a two-run comparison to the second. */
export function runChanges(c: Comparison): RunChanges {
  if (c.runs.length !== 2) throw new Error("Changes need exactly two runs.");
  const rows: ChangeRow[] = [];
  let same = 0;
  for (const r of c.rows) {
    const before = r.cells[0] ? side(r.cells[0]) : null;
    const after = r.cells[1] ? side(r.cells[1]) : null;
    const changes = changesOf(before, after);
    if (changes.length === 0) {
      if (before && after) same++;
      continue;
    }
    rows.push({ testId: r.testId, title: r.title, number: r.number, before, after, changes });
  }
  return { previous: c.runs[0]!, rows, same };
}
