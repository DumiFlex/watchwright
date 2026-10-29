// Pure helpers for the compare page: which runs the address names, what the cells show, and
// the export links.
import type { CompareCell, CompareShot, Comparison, ParamValue } from "./api";
import { mean } from "./review";

export const MAX_COMPARE = 6;
const ID = /^[0-9a-f]{8}$/;

/** The run ids in `?runs=a,b,c`: valid ones, each once, at most six. */
export function runIdsOf(list: string | undefined): string[] {
  return [...new Set((list ?? "").split(",").filter((x) => ID.test(x)))].slice(0, MAX_COMPARE);
}

export function paramsText(params: Record<string, ParamValue>, keys?: readonly string[]): string {
  const xs = Object.entries(params).filter(([k]) => !keys || keys.includes(k));
  return xs.map(([k, v]) => `${k}=${String(v)}`).join(", ");
}

/** Params whose values differ between the runs: what tells the columns apart in a model matrix. */
export function differingParams(runs: readonly { params: Record<string, ParamValue> }[]): string[] {
  const keys = new Set(runs.flatMap((r) => Object.keys(r.params)));
  return [...keys].filter((k) => new Set(runs.map((r) => JSON.stringify(r.params[k] ?? null))).size > 1);
}

/** What the cells show besides status and score: `shot:<name>`, `text:<name>`, or "" for nothing. */
export function showOptions(c: Pick<Comparison, "shotNames" | "textNames">): { value: string; label: string }[] {
  return [
    { value: "", label: "Status and scores" },
    ...c.shotNames.map((n) => ({ value: `shot:${n}`, label: `Screenshot: ${n}` })),
    ...c.textNames.map((n) => ({ value: `text:${n}`, label: `Text: ${n}` })),
  ];
}

/** The cell's screenshot by name; a scroll set's name picks its first shot. */
export function shotOf(cell: Pick<CompareCell, "shots">, name: string): CompareShot | null {
  return cell.shots.find((s) => s.set === name) ?? cell.shots.find((s) => s.name === name && !s.set) ?? null;
}

/** Each run's mean attempt score. */
export function runScores(c: Pick<Comparison, "runs" | "rows">): (number | null)[] {
  return c.runs.map((_, i) => mean(c.rows.map((r) => r.cells[i]?.score ?? null)));
}

export function exportUrl(kind: "md" | "zip", ids: readonly string[]): string {
  return `/api/v1/export.${kind}?runs=${ids.join(",")}`;
}

/** A score differs by at least this much (on 1 to 5); the same rule as Since the last run on the server. */
const SCORE_STEP = 0.5;
/** A time differs when one is this many times the other, and by at least `TIME_MIN_MS`. */
const TIME_RATIO = 1.5;
const TIME_MIN_MS = 2000;

type DiffCell = Pick<CompareCell, "status" | "flags" | "score" | "durationMs">;

const flagKey = (c: DiffCell) => [...new Set(c.flags.map((f) => f.name))].sort().join("\u0000");

/** Whether two cells of a row went differently: one missing, or status, flags, score or time moved. */
export function cellsDiffer(a: DiffCell | null, b: DiffCell | null): boolean {
  if (!a || !b) return a !== b;
  if (a.status !== b.status || flagKey(a) !== flagKey(b)) return true;
  if (a.score !== null && b.score !== null && Math.abs(a.score - b.score) >= SCORE_STEP) return true;
  const [x, y] = [a.durationMs, b.durationMs];
  return x !== null && y !== null && Math.abs(x - y) >= TIME_MIN_MS && Math.max(x, y) >= TIME_RATIO * Math.max(1, Math.min(x, y));
}

/** Whether any two runs of a row went differently. */
export function rowDiffers(cells: readonly (DiffCell | null)[]): boolean {
  return cells.some((a, i) => cells.slice(i + 1).some((b) => cellsDiffer(a, b)));
}

/** Every word of the search appears in the row's test id or title. */
export function rowMatches(row: { testId: string; title: string }, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${row.testId}\n${row.title}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Past this many rows, the compare page opens on the rows that differ. */
export const DIFFER_FIRST = 12;
