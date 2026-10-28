// Runs at a glance (`GET /runs/stats`): the runs page's headline tiles and the attempts-per-day
// chart. Each tile compares the period with the one before it.
import type { BarItem, BarSeries } from "./components/BarChart.vue";

export interface StatCounts {
  runs: number;
  passed: number;
  failed: number;
  broken: number;
  skipped: number;
  stopped: number;
  medianMs: number | null;
}
export interface RunStats {
  days: (StatCounts & { date: string })[];
  current: StatCounts;
  previous: StatCounts;
}

export interface Tile {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  delta?: number;
  goodWhen: "up" | "down";
  formatDelta?: (v: number) => string;
  trend: number[];
  trendLabels: string[];
}

export const PERIODS = [7, 14, 30] as const;

/** Passed against passed, failed and broken, in percent; null with none of those. */
export function rate(c: StatCounts): number | null {
  const n = c.passed + c.failed + c.broken;
  return n === 0 ? null : Math.round((c.passed / n) * 1000) / 10;
}

/** "Oct 14" in the page's language, for a YYYY-MM-DD day. */
export const dayLabel = (date: string, locale?: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" });

const seconds = (ms: number) => Math.round(ms / 100) / 10;

export function tiles(s: RunStats, locale?: string): Tile[] {
  const labels = s.days.map((d) => dayLabel(d.date, locale));
  const cur = rate(s.current);
  const prev = rate(s.previous);
  const hadBefore = s.previous.runs > 0 || s.previous.passed + s.previous.failed + s.previous.broken > 0;
  const delta = (a: number | null, b: number | null) => (hadBefore && a !== null && b !== null ? Math.round((a - b) * 10) / 10 : undefined);
  const out: Tile[] = [
    { key: "runs", label: "Runs", value: s.current.runs, goodWhen: "up", trend: s.days.map((d) => d.runs), trendLabels: labels },
    {
      key: "rate",
      label: "Pass rate",
      value: cur ?? "–",
      goodWhen: "up",
      formatDelta: (v) => `${v > 0 ? "+" : ""}${v} pts`,
      trend: s.days.map((d) => rate(d) ?? 0),
      trendLabels: labels,
    },
    { key: "broken", label: "Broken attempts", value: s.current.broken, goodWhen: "down", trend: s.days.map((d) => d.broken), trendLabels: labels },
    {
      key: "median",
      label: "Median attempt",
      value: s.current.medianMs === null ? "–" : seconds(s.current.medianMs),
      goodWhen: "down",
      formatDelta: (v) => `${v > 0 ? "+" : ""}${v} s`,
      trend: s.days.map((d) => (d.medianMs === null ? 0 : seconds(d.medianMs))),
      trendLabels: labels,
    },
  ];
  if (cur !== null) out[1]!.unit = "%";
  if (s.current.medianMs !== null) out[3]!.unit = " s";
  const deltas = [
    hadBefore ? s.current.runs - s.previous.runs : undefined,
    delta(cur, prev),
    hadBefore ? s.current.broken - s.previous.broken : undefined,
    delta(s.current.medianMs === null ? null : seconds(s.current.medianMs), s.previous.medianMs === null ? null : seconds(s.previous.medianMs)),
  ];
  deltas.forEach((d, i) => {
    if (d !== undefined) out[i]!.delta = d;
  });
  return out;
}

export const SERIES: BarSeries[] = [
  { key: "passed", label: "Passed", tone: "ok" },
  { key: "failed", label: "Failed", tone: "bad" },
  { key: "broken", label: "Broken", tone: "warn" },
  { key: "skipped", label: "Skipped", tone: "muted" },
];

export function bars(s: RunStats, locale?: string): BarItem[] {
  return s.days.map((d) => ({ label: dayLabel(d.date, locale), values: { passed: d.passed, failed: d.failed, broken: d.broken, skipped: d.skipped } }));
}

/** Whether there is anything to show: a run in the period or the one before. */
export const anything = (s: RunStats) => s.current.runs + s.previous.runs > 0;
