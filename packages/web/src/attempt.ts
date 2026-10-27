// Pure helpers for the attempt page: the order to step through attempts, how shots group into
// the gallery and scroll sets, and the columns of a collector's records.
import type { Artifact, RunDetail } from "./api";

/** The run's attempts in the order they show on the run page: each planned attempt, then the attempts that ran inside it. */
export function attemptOrder(run: Pick<RunDetail, "plan" | "attempts">): string[] {
  const out: string[] = [];
  for (const p of run.plan) {
    if (!p.attemptId) continue;
    out.push(p.attemptId);
    for (const a of run.attempts) if (a.parentId === p.attemptId) out.push(a.id);
  }
  return out;
}

export type ShotGroup = { set: null; shots: Artifact[] } | { set: string; shots: Artifact[] };

/** Images in the order they were taken, with each scroll set kept together as one group and single shots (and marks) grouped between them. */
export function shotGroups(artifacts: readonly Artifact[]): ShotGroup[] {
  const groups: ShotGroup[] = [];
  for (const a of artifacts) {
    if (a.kind !== "shot" && a.kind !== "mark") continue;
    const set = a.set ?? null;
    const last = groups[groups.length - 1];
    if (last && last.set === set) last.shots.push(a);
    else groups.push(set === null ? { set: null, shots: [a] } : { set, shots: [a] });
  }
  return groups;
}

/** The keys of a collector's records, in the order they first appear (at most `max`). */
export function recordColumns(records: readonly unknown[], max = 40): string[] {
  const keys = new Set<string>();
  for (const r of records.slice(0, 500)) {
    if (r && typeof r === "object" && !Array.isArray(r)) for (const k of Object.keys(r)) keys.add(k);
    if (keys.size >= max) break;
  }
  return [...keys].slice(0, max);
}

/** A record's value as one line of table text; numbers and booleans stay as they are so they sort. */
export function cellOf(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** The address that opens a trace in the trace viewer the server serves. */
export function traceViewerUrl(origin: string, traceUrl: string): string {
  return `/api/v1/trace-viewer/index.html?trace=${encodeURIComponent(origin + traceUrl)}`;
}

/** Error text without the terminal colour codes Playwright puts in its call logs. */
export function plainText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
