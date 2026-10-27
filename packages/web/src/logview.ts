// The log viewer's logic: counting and filtering by level, finding a search in the lines and
// cutting a line into its matching and other parts. Kept apart from LogViewer.vue to test it.

export type LogLevel = "info" | "warn" | "error";
export const LEVELS: readonly LogLevel[] = ["info", "warn", "error"];

export interface LogLine {
  /** Stable key for the line (an event's seq, or its place in the log). */
  key: string | number;
  /** The line's number, counted from 1 in the whole log, not in what the filters show. */
  n: number;
  time: string;
  level: LogLevel;
  message: string;
  /** The test it came from, in a run's log. */
  test?: string | null | undefined;
}

/** Any level other than warn and error counts as info. */
export function levelOf(level: string): LogLevel {
  return level === "warn" || level === "error" ? level : "info";
}

export function levelCounts(lines: readonly LogLine[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { info: 0, warn: 0, error: 0 };
  for (const l of lines) counts[l.level]++;
  return counts;
}

/** The lines at the shown levels. */
export function shownLines(lines: readonly LogLine[], levels: ReadonlySet<LogLevel>): LogLine[] {
  return levels.size === LEVELS.length ? [...lines] : lines.filter((l) => levels.has(l.level));
}

/** What a search looks at in a line: its message, test and level. */
const haystack = (l: LogLine) => `${l.message}\n${l.test ?? ""}\n${l.level}`.toLowerCase();

/** Indices into `lines` of the lines that hold `query` (any case). An empty query matches nothing. */
export function findLines(lines: readonly LogLine[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  lines.forEach((l, i) => haystack(l).includes(q) && out.push(i));
  return out;
}

/** `text` cut into parts, with `hit` on the ones that equal `query` (any case). */
export function splitHits(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length)) {
    if (i > at) parts.push({ text: text.slice(at, i), hit: false });
    parts.push({ text: text.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** The match to go to from `current` in `dir`, wrapping around; -1 when there are none. */
export function stepMatch(count: number, current: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}
