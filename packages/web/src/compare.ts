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
