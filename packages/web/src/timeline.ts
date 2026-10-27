// Layout for TimelineScrubber: steps placed on lanes so none overlap, tick marks for the
// time axis, and the clock text. Kept apart from the component to test it.

export type TimelineStep = { id: string; label: string; start: number; end: number; status?: string | undefined };

/** Puts each step on the first lane where it doesn't overlap the one before. Returns lanes of steps. */
export function laneSteps<S extends TimelineStep>(steps: readonly S[]): S[][] {
  const lanes: S[][] = [];
  for (const s of [...steps].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const lane = lanes.find((l) => l[l.length - 1]!.end <= s.start);
    if (lane) lane.push(s);
    else lanes.push([s]);
  }
  return lanes;
}

const TICK_STEPS = [100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000];

/** Tick times for an axis `width` px wide covering `duration` ms, at least `minGap` px apart. */
export function timeTicks(duration: number, width: number, minGap = 72): number[] {
  if (!(duration > 0) || !(width > 0)) return [0];
  const perPx = duration / width;
  const step = TICK_STEPS.find((s) => s / perPx >= minGap) ?? Math.ceil((minGap * perPx) / 3_600_000) * 3_600_000;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
  return ticks;
}

/** "0:07", "1:23", "1:02:03"; with tenths ("0:07.4") when `fine` is set. */
export function clock(ms: number, fine = false): string {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const tenths = Math.floor(abs / 100) % 10;
  const s = Math.floor(abs / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return `${neg ? "-" : ""}${body}${fine ? `.${tenths}` : ""}`;
}

/** The step running at `at` (the latest started one), or null. */
export function stepAt<S extends TimelineStep>(steps: readonly S[], at: number): S | null {
  let best: S | null = null;
  for (const s of steps) if (s.start <= at && at < s.end && (!best || s.start >= best.start)) best = s;
  return best;
}

/** The start of the next (dir 1) or previous (dir -1) step from `at`, or null when there is none. */
export function nextStart(steps: readonly TimelineStep[], at: number, dir: 1 | -1): number | null {
  const starts = [...new Set(steps.map((s) => s.start))].sort((a, b) => a - b);
  if (dir === 1) return starts.find((t) => t > at + 1) ?? null;
  return starts.reverse().find((t) => t < at - 1) ?? null;
}
