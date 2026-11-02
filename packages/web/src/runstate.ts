// A run's state in a few words, for places outside the page: the tab title, the favicon's dot
// and desktop notifications. Pure, so the wording is tested.
import { runName, type RunSummary } from "./api";

export type Tone = "accent" | "ok" | "warn" | "bad" | "paused";

export interface LiveLike {
  state: "running" | "pausing" | "paused";
  pauseReason: "manual" | "broken" | null;
  testId: string | null;
}

type RunLike = Pick<RunSummary, "id" | "label" | "packName" | "status" | "counts">;

/** Attempts with a result so far, and the attempts planned. */
export function progress(run: RunLike): { done: number; of: number } {
  const c = run.counts;
  return { done: c.passed + c.failed + c.broken + c.skipped + c.stopped, of: c.planned };
}

/** The tab title for a run's page: state first, so it reads in a narrow tab. */
export function runTitle(run: RunLike, live: LiveLike | null): string {
  const name = run.label ? `${run.label} · ${run.packName}` : `${run.packName} ${run.id}`;
  const { done, of } = progress(run);
  const head = (() => {
    if (live?.state === "paused") return live.pauseReason === "broken" ? `Paused: ${live.testId ?? "a test"} broke` : "Paused";
    if (live?.state === "pausing") return "Pausing";
    switch (run.status) {
      case "queued":
        return "Queued";
      case "running":
        return `Running ${done}/${of}`;
      case "finished":
        return run.counts.failed || run.counts.broken ? `Done with problems ${done}/${of}` : `Done ${done}/${of}`;
      case "stopped":
        return "Stopped";
      case "interrupted":
        return "Interrupted";
      case "failed_to_start":
        return "Didn't start";
      default:
        return "";
    }
  })();
  return [head, name, "Watchwright"].filter(Boolean).join(" · ");
}

/** The color of the favicon's dot for a run, or null for none. */
export function runTone(run: RunLike, live: LiveLike | null): Tone | null {
  if (live?.state === "paused" || live?.state === "pausing") return live.pauseReason === "broken" ? "warn" : "paused";
  switch (run.status) {
    case "running":
    case "queued":
      return "accent";
    case "finished":
      return run.counts.failed || run.counts.broken ? "bad" : "ok";
    case "failed_to_start":
      return "bad";
    default:
      return null;
  }
}

export interface Note {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
}

/** The desktop notification for a run event, or null when the event isn't worth one. */
export function noteFor(type: string, data: Record<string, unknown>, run: Pick<RunSummary, "id" | "label" | "packName" | "counts">, now = Date.now()): Note | null {
  const name = run.label ? `${run.packName}: ${runName(run)}` : `${run.packName} ${run.id}`;
  const tag = `run-${run.id}`;
  if (type === "run.finished") {
    const status = String(data.status ?? "finished");
    const c = run.counts;
    const parts = [`${c.passed} passed`, c.failed ? `${c.failed} failed` : "", c.broken ? `${c.broken} broken` : ""].filter(Boolean).join(", ");
    return { title: status === "stopped" ? `Stopped: ${name}` : `Finished: ${name}`, body: parts, tag };
  }
  if (type === "run.paused" && data.reason === "broken") {
    const deadline = typeof data.deadline === "string" ? Date.parse(data.deadline) : NaN;
    const minutes = Number.isFinite(deadline) ? Math.max(0, Math.round((deadline - now) / 60000)) : null;
    const test = typeof data.testId === "string" ? data.testId : "A test";
    return {
      title: `Paused: ${name}`,
      body: `${test} broke. Retry or skip it${minutes !== null ? `; it skips by itself in ${minutes} min` : ""}.`,
      tag,
    };
  }
  if (type === "run.failed_to_start") return { title: `Didn't start: ${name}`, body: String(data.message ?? ""), tag };
  return null;
}

const TRACE_WORDS: Record<string, string> = { problems: "only on problems", always: "always", never: "never" };

/** A log line for a `run.settings` event: who changed what. */
export function settingsText(data: Record<string, unknown>): string {
  const c = (data.changed ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof c.pauseOnBroken === "boolean") bits.push(c.pauseOnBroken ? "pause when a test breaks" : "don't pause when a test breaks");
  if (typeof c.pauseLimitMinutes === "number") bits.push(`skip a broken test after ${c.pauseLimitMinutes} min`);
  if (c.testTimeoutMinutes === null) bits.push("each test's own time limit");
  else if (typeof c.testTimeoutMinutes === "number") bits.push(`${c.testTimeoutMinutes} min per test`);
  if (typeof c.trace === "string") bits.push(`trace ${TRACE_WORDS[c.trace] ?? c.trace}`);
  if (c.video === true || c.video === "always") bits.push("video of every attempt");
  else if (c.video === "problems") bits.push("video only on problems");
  else if (c.video === false || c.video === "never") bits.push("no video");
  if (typeof c.runVideo === "boolean") bits.push(c.runVideo ? "run video on" : "run video off");
  const by = typeof data.by === "string" && data.by ? ` (${data.by})` : "";
  return `Settings changed${by}: ${bits.join(", ") || "nothing"}.`;
}
