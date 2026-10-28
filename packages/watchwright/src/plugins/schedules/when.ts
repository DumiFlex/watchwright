import { Cron } from "croner";

// When a schedule is due: `every` (a fixed gap such as 15m, 2h or 1d) or a cron expression in a
// time zone. Both answer the next due time after a moment, and a sentence for people.

export type When = { every: string } | { cron: string; timezone?: string | undefined };

const EVERY = /^(\d{1,4})\s*(m|h|d)$/;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const UNIT_WORD = { m: "minute", h: "hour", d: "day" } as const;
/** No schedule runs more often than this. */
export const MIN_GAP_MS = 60_000;

export class WhenError extends Error {}

/** The machine's own time zone, which cron schedules use unless they name one. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function everyMs(every: string): number {
  const m = EVERY.exec(every.trim());
  if (!m) throw new WhenError(`"${every}" isn't a gap Watchwright reads: a number and m, h or d (15m, 2h, 1d).`);
  const ms = Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
  if (ms < MIN_GAP_MS) throw new WhenError("A schedule runs at most once a minute.");
  return ms;
}

function cronOf(when: { cron: string; timezone?: string | undefined }): Cron {
  try {
    return new Cron(when.cron, { timezone: when.timezone ?? localZone(), paused: true, mode: "5-part" });
  } catch (err) {
    throw new WhenError(`"${when.cron}" isn't a cron expression Watchwright reads (minute hour day month weekday): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Throws a WhenError when `when` can't be used. */
export function checkWhen(when: When): void {
  if ("every" in when) everyMs(when.every);
  else {
    if (when.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: when.timezone });
      } catch {
        throw new WhenError(`"${when.timezone}" isn't a time zone (try Europe/London or America/New_York).`);
      }
    }
    const cron = cronOf(when);
    const a = cron.nextRun(new Date());
    if (!a) throw new WhenError(`"${when.cron}" never comes round.`);
    const b = cron.nextRun(a);
    if (b && b.getTime() - a.getTime() < MIN_GAP_MS) throw new WhenError("A schedule runs at most once a minute.");
  }
}

/**
 * The first due time after `after`. An `every` schedule counts its gaps from `anchor` (when it was
 * made or last due), so a late tick doesn't make it drift.
 */
export function nextDue(when: When, after: Date, anchor: Date): Date | null {
  if ("every" in when) {
    const gap = everyMs(when.every);
    const steps = Math.max(1, Math.floor((after.getTime() - anchor.getTime()) / gap) + 1);
    return new Date(anchor.getTime() + steps * gap);
  }
  return cronOf(when).nextRun(after);
}

/** The schedule in words: "Every 15 minutes", "0 9 * * 1-5 (Europe/London)". */
export function describeWhen(when: When): string {
  if ("every" in when) {
    const m = EVERY.exec(when.every.trim());
    if (!m) return when.every;
    const n = Number(m[1]);
    const word = UNIT_WORD[m[2] as keyof typeof UNIT_WORD];
    return n === 1 ? `Every ${word}` : `Every ${n} ${word}s`;
  }
  const zone = when.timezone ?? localZone();
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec(when.cron.trim());
  if (daily && Number(daily[1]) < 60 && Number(daily[2]) < 24) {
    const at = `${daily[2]!.padStart(2, "0")}:${daily[1]!.padStart(2, "0")}`;
    return `${daily[3] === "1-5" ? "Weekdays" : "Every day"} at ${at} (${zone})`;
  }
  return `Cron ${when.cron} (${zone})`;
}
