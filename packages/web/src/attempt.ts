// Pure helpers for the attempt page: the order to step through attempts, how shots group into
// the gallery and scroll sets, the columns of a collector's records, and the step timeline.
import type { Artifact, ResultDocument, RunDetail } from "./api";
import type { TimelineStep } from "./timeline";

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

/**
 * An attempt's steps on its own time axis (ms from the attempt's start), nested steps labelled
 * with their parents. Attempts recorded before step times were kept get their steps from the
 * "Step: …" lines of their log, each running until the next one starts.
 */
export function attemptSteps(doc: Pick<ResultDocument, "steps" | "startedAt" | "finishedAt"> & { log?: ResultDocument["log"] }): TimelineStep[] {
  const start = Date.parse(doc.startedAt);
  const end = doc.finishedAt ? Date.parse(doc.finishedAt) : Date.now();
  if (!doc.steps?.length) {
    const lines = (doc.log ?? []).filter((l) => l.level === "info" && l.message.startsWith("Step: "));
    return lines.map((l, i) => ({
      id: String(i),
      label: l.message.slice("Step: ".length),
      start: Math.max(0, Date.parse(l.time) - start),
      end: Math.max(0, (lines[i + 1] ? Date.parse(lines[i + 1]!.time) : end) - start),
    }));
  }
  const path: string[] = [];
  return doc.steps.map((s, i) => {
    path.length = s.depth;
    path.push(s.title);
    return {
      id: String(i),
      label: path.join(" › "),
      start: Math.max(0, Date.parse(s.startedAt) - start),
      end: Math.max(0, (s.finishedAt ? Date.parse(s.finishedAt) : end) - start),
      status: s.status,
    };
  });
}

/** Warnings and errors from the log as points on the attempt's time axis. */
export function logMarks(doc: Pick<ResultDocument, "log" | "startedAt">): { at: number; label: string; tone: "warn" | "bad" }[] {
  const start = Date.parse(doc.startedAt);
  return doc.log.filter((l) => l.level !== "info").map((l) => ({ at: Math.max(0, Date.parse(l.time) - start), label: l.message, tone: l.level === "error" ? "bad" : "warn" }));
}

/** True for a Markdown file (by its content type, or its name when the type is generic). */
export function isMarkdown(a: Pick<Artifact, "contentType" | "url">): boolean {
  return a.contentType.startsWith("text/markdown") || /\.(md|markdown)$/i.test(a.url.split("?")[0] ?? "");
}

/**
 * A relative link or image in a saved file, as a url next to that file (`notes.md` linking
 * `img/a.png`); null for anything that isn't relative or would leave the run's files.
 */
export function besideFile(fileUrl: string, target: string): string | null {
  if (!target || /^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(target)) return null;
  const base = new URL(fileUrl, "http://x");
  const to = new URL(target, base);
  const run = base.pathname.split("/").slice(0, 6).join("/");
  if (to.origin !== base.origin || !to.pathname.startsWith(`${run}/`)) return null;
  return to.pathname + to.search + to.hash;
}
