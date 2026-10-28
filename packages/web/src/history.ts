// A test's history across runs, for the strip on the pack page: its pass rate, a typical time
// and whether it is flaky. Flaky means it went from passing to failing and back (or the other
// way) with the same parameter values, or passed only when it was run again. A test that fails
// every time is broken, not flaky, and one that started failing once has a regression.
import type { HistoryEntry } from "./api";

/** How many of a test's last attempts the strip shows. */
export const HISTORY_LIMIT = 20;

const keyOf = (params: HistoryEntry["params"]) =>
  JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));

/** Passed against passed, failed and broken; skipped and stopped attempts don't count. */
export function passRate(entries: readonly HistoryEntry[]): number | null {
  const counted = entries.filter((e) => e.status === "passed" || e.status === "failed" || e.status === "broken");
  if (counted.length === 0) return null;
  return counted.filter((e) => e.status === "passed").length / counted.length;
}

export function medianMs(entries: readonly HistoryEntry[]): number | null {
  const ms = entries
    .filter((e) => e.status === "passed" || e.status === "failed")
    .map((e) => e.durationMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (ms.length === 0) return null;
  const mid = Math.floor(ms.length / 2);
  return ms.length % 2 ? ms[mid]! : Math.round((ms[mid - 1]! + ms[mid]!) / 2);
}

/** Why a test is flaky, or null when it isn't. */
export function flakyReason(entries: readonly HistoryEntry[]): string | null {
  if (entries.some((e) => e.status === "passed" && e.try > 1)) return "It passed only when it was run again.";
  // Per set of parameter values, count the times the result flipped between passed and failed:
  // once is a regression or a fix, twice or more is a flake.
  const last = new Map<string, string>();
  const flips = new Map<string, number>();
  for (const e of entries) {
    if (e.status !== "passed" && e.status !== "failed") continue;
    const k = keyOf(e.params);
    const before = last.get(k);
    if (before !== undefined && before !== e.status) flips.set(k, (flips.get(k) ?? 0) + 1);
    last.set(k, e.status);
  }
  for (const n of flips.values()) if (n >= 2) return "It went between passing and failing with the same parameter values.";
  return null;
}

/** One tick's tooltip: status, run, when and how long. */
export function entryText(e: HistoryEntry, formatDuration: (ms: number | null) => string, formatWhen: (iso: string) => string): string {
  const parts = [e.status + (e.try > 1 ? ` on try ${e.try}` : ""), `run ${e.runLabel ? `${e.runLabel} (${e.runId})` : e.runId}`, formatWhen(e.startedAt)];
  const took = formatDuration(e.durationMs);
  if (took) parts.push(took);
  const params = Object.entries(e.params).map(([k, v]) => `${k}=${String(v)}`);
  if (params.length) parts.push(params.join(" "));
  return parts.join(" · ");
}
