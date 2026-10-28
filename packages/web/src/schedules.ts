import type { RunSummary } from "./api";

// The Schedules page's form and the server's `when`: a gap (every 15 minutes), a time of day
// (daily at 09:00, weekdays only) written as a cron expression, or a cron expression as typed.

export type When = { every: string } | { cron: string; timezone?: string };

export type WhenMode = "every" | "daily" | "cron";
export type EveryUnit = "m" | "h" | "d";

export interface WhenForm {
  mode: WhenMode;
  count: number;
  unit: EveryUnit;
  /** "HH:MM" for daily. */
  time: string;
  weekdays: boolean;
  cron: string;
  timezone: string;
}

export interface ScheduleRun {
  id: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  counts: RunSummary["counts"];
}

export interface Schedule {
  id: string;
  name: string;
  packId: string;
  when: When;
  says: string;
  run: { tests?: string[]; preset?: string; label?: string } & Record<string, unknown>;
  missed: "once" | "skip";
  enabled: boolean;
  nextAt: string | null;
  lastRunId: string | null;
  lastRun: ScheduleRun | null;
}

export interface ScheduleDetail extends Schedule {
  runs: { runId: string; dueAt: string; startedAt: string; run: ScheduleRun | null }[];
}

const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/;

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function emptyForm(): WhenForm {
  return { mode: "daily", count: 1, unit: "h", time: "09:00", weekdays: false, cron: "0 9 * * *", timezone: localZone() };
}

/** The form for a schedule's `when`: a cron expression that is a plain time of day shows as "daily". */
export function formOf(when: When): WhenForm {
  const f = emptyForm();
  if ("every" in when) {
    const m = /^(\d+)\s*(m|h|d)$/.exec(when.every.trim());
    return { ...f, mode: "every", count: m ? Number(m[1]) : 1, unit: (m?.[2] as EveryUnit | undefined) ?? "h" };
  }
  const tz = when.timezone ?? localZone();
  const d = DAILY.exec(when.cron.trim());
  if (d && Number(d[2]) < 24 && Number(d[1]) % 15 === 0 && Number(d[1]) < 60) {
    return { ...f, mode: "daily", time: `${d[2]!.padStart(2, "0")}:${d[1]!.padStart(2, "0")}`, weekdays: d[3] === "1-5", cron: when.cron, timezone: tz };
  }
  return { ...f, mode: "cron", cron: when.cron, timezone: tz };
}

/** The `when` the server takes for the form. */
export function whenOf(f: WhenForm): When {
  if (f.mode === "every") return { every: `${f.count}${f.unit}` };
  if (f.mode === "daily") {
    const [h, m] = f.time.split(":").map(Number);
    return { cron: `${m ?? 0} ${h ?? 0} * * ${f.weekdays ? "1-5" : "*"}`, timezone: f.timezone };
  }
  return { cron: f.cron.trim(), timezone: f.timezone };
}

/** Every quarter hour of the day, for the "daily at" menu. */
export const TIMES: readonly { value: string; label: string }[] = Array.from({ length: 96 }, (_, i) => {
  const v = `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
  return { value: v, label: v };
});
