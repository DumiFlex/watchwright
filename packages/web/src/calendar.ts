// Date helpers for DatePicker. Days are plain "YYYY-MM-DD" strings in local time, like the
// value of <input type="date">, so there are no time zone surprises.

export type Day = { y: number; m: number; d: number }; // m is 1-12

export function parseDay(s: string): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return toIso(fromDate(toDate(day))) === s ? day : null; // rejects 2026-02-30
}

export function toIso(day: Day): string {
  return `${String(day.y).padStart(4, "0")}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

function toDate(day: Day): Date {
  const dt = new Date(day.y, day.m - 1, day.d);
  dt.setFullYear(day.y); // years below 100 would otherwise map to 19xx
  return dt;
}
function fromDate(dt: Date): Day {
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

export function today(now = new Date()): Day {
  return fromDate(now);
}

export function addDays(day: Day, n: number): Day {
  const dt = toDate(day);
  dt.setDate(dt.getDate() + n);
  return fromDate(dt);
}

/** Moves by whole months and keeps the day, clamped to the target month's length. */
export function addMonths(day: Day, n: number): Day {
  const first = new Date(day.y, day.m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { y: first.getFullYear(), m: first.getMonth() + 1, d: Math.min(day.d, last) };
}

/** Monday = 0 … Sunday = 6. */
export function weekday(day: Day): number {
  return (toDate(day).getDay() + 6) % 7;
}

/** The six weeks (42 days, Monday first) that show the month of `day`. */
export function monthGrid(day: Day): Day[] {
  const first = { y: day.y, m: day.m, d: 1 };
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function compareDays(a: Day, b: Day): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}
