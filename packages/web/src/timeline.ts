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

// Steps a tick label can show exactly: tenths below a second (no 250 ms, which tenths round to
// 0:00.2, 0:00.5, 0:00.7), then whole seconds and minutes.
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000];

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

export type MarkCluster<M> = { at: number; marks: M[] };

/**
 * Groups points less than `gap` px from the one before on an axis `width` px wide covering
 * `duration` ms, so marks that would sit on or against each other show as one with a count. Each
 * group sits at its first mark.
 */
export function clusterMarks<M extends { at: number }>(marks: readonly M[], duration: number, width: number, gap = 16): MarkCluster<M>[] {
  const perPx = duration > 0 && width > 0 ? duration / width : 0;
  const out: MarkCluster<M>[] = [];
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    const last = out[out.length - 1];
    if (last && m.at - last.marks[last.marks.length - 1]!.at < gap * perPx) last.marks.push(m);
    else out.push({ at: m.at, marks: [m] });
  }
  return out;
}

/** Zoom levels of the timeline: how many times the visible width the whole axis is. */
export const TIMELINE_ZOOMS = [1, 2, 4, 8, 16, 32, 64];

/** The next zoom level up (dir 1) or down (dir -1) from `zoom`. */
export function stepTimelineZoom(zoom: number, dir: 1 | -1): number {
  if (dir === 1) return TIMELINE_ZOOMS.find((z) => z > zoom) ?? TIMELINE_ZOOMS[TIMELINE_ZOOMS.length - 1]!;
  return [...TIMELINE_ZOOMS].reverse().find((z) => z < zoom) ?? 1;
}

/**
 * The zoom to open at: the least that gives the median step `minPx` px, so most steps are wide
 * enough for their label, but at most `max` so the run doesn't open as a sliver of itself.
 */
export function fitTimelineZoom(steps: readonly TimelineStep[], duration: number, width: number, minPx = 56, max = 8): number {
  if (!steps.length || !(duration > 0) || !(width > 0)) return 1;
  const lengths = steps.map((s) => Math.max(0, s.end - s.start)).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)]!;
  const px = (median / duration) * width;
  if (px >= minPx) return 1;
  return TIMELINE_ZOOMS.find((z) => z <= max && px * z >= minPx) ?? TIMELINE_ZOOMS.filter((z) => z <= max).pop()!;
}
