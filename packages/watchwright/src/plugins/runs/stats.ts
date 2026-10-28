// Runs at a glance: runs and attempt outcomes per day for the runs page's tiles and chart, and
// the same totals for the period before, so a tile can say what changed. Days are the caller's
// calendar days: the page sends its time zone offset, so "today" is the person's today.

export interface StatCounts {
  runs: number;
  passed: number;
  failed: number;
  broken: number;
  skipped: number;
  stopped: number;
  /** The median time of the passed and failed attempts, or null with none. */
  medianMs: number | null;
}

export interface DayStats extends StatCounts {
  /** The calendar day, YYYY-MM-DD, in the caller's time zone. */
  date: string;
}

export interface RunStats {
  days: DayStats[];
  current: StatCounts;
  previous: StatCounts;
}

export interface StatsRows {
  runs: { created_at: string }[];
  attempts: { status: string; started_at: string; finished_at: string | null }[];
}

const DAY = 86_400_000;
const OUTCOMES = ["passed", "failed", "broken", "skipped", "stopped"] as const;

/** The calendar day of an instant for a time zone `offset` minutes behind UTC (as `Date.getTimezoneOffset()` gives it). */
export const dayOf = (iso: string, offset: number) => new Date(Date.parse(iso) - offset * 60_000).toISOString().slice(0, 10);

/** The instant a calendar day starts in that time zone. */
export const dayStart = (date: string, offset: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + offset * 60_000).toISOString();

/** The `days` days ending with `until`, oldest first. */
export function dayList(until: string, days: number): string[] {
  const end = Date.parse(`${until}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * DAY).toISOString().slice(0, 10));
}

function median(ms: number[]): number | null {
  if (ms.length === 0) return null;
  const s = ms.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

function empty(): StatCounts & { ms: number[] } {
  return { runs: 0, passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, medianMs: null, ms: [] };
}

const done = ({ ms, ...c }: StatCounts & { ms: number[] }): StatCounts => ({ ...c, medianMs: median(ms) });

/**
 * Sorts runs (by the day they were made) and attempts (by the day they started) into the
 * `days` days ending with `until` and the `days` days before them. Rows outside both are ignored.
 */
export function runStats(rows: StatsRows, o: { until: string; days: number; offset: number }): RunStats {
  const list = dayList(o.until, o.days * 2);
  const index = new Map(list.map((d, i) => [d, i]));
  const buckets = list.map(() => empty());
  for (const r of rows.runs) {
    const b = buckets[index.get(dayOf(r.created_at, o.offset)) ?? -1];
    if (b) b.runs++;
  }
  for (const a of rows.attempts) {
    const b = buckets[index.get(dayOf(a.started_at, o.offset)) ?? -1];
    if (!b || !(OUTCOMES as readonly string[]).includes(a.status)) continue;
    b[a.status as (typeof OUTCOMES)[number]]++;
    if ((a.status === "passed" || a.status === "failed") && a.finished_at) b.ms.push(Date.parse(a.finished_at) - Date.parse(a.started_at));
  }
  const sum = (part: (StatCounts & { ms: number[] })[]) =>
    part.reduce((t, b) => {
      t.runs += b.runs;
      for (const k of OUTCOMES) t[k] += b[k];
      t.ms.push(...b.ms);
      return t;
    }, empty());
  const previous = buckets.slice(0, o.days);
  const current = buckets.slice(o.days);
  return {
    days: current.map((b, i) => ({ date: list[o.days + i]!, ...done(b) })),
    current: done(sum(current)),
    previous: done(sum(previous)),
  };
}
