import type { TimelineStep } from "./timeline";

// Helpers for the live view's rewind: the server's kept frames and the steps that ran meanwhile.

export interface RewindFrame {
  pageId: string;
  timestamp: number;
  width: number;
  height: number;
  url: string;
}

/**
 * Steps (by start time, ms since the epoch) as timeline steps over the window `from`..`to`,
 * in ms from `from`. A step runs until the next one starts; one that started before the window
 * is cut at its start.
 */
export function rewindSteps(steps: readonly { at: number; label: string }[], from: number, to: number): TimelineStep[] {
  const sorted = steps.slice().sort((a, b) => a.at - b.at);
  const out: TimelineStep[] = [];
  sorted.forEach((s, i) => {
    const end = Math.min(to, sorted[i + 1]?.at ?? to);
    if (end <= from || s.at >= to) return;
    out.push({ id: `${i}`, label: s.label, start: Math.max(0, s.at - from), end: end - from });
  });
  return out;
}

/** Playback speeds the rewind offers. */
export const REWIND_SPEEDS = [0.5, 1, 2, 4] as const;

/**
 * The time (ms since the epoch) of the frame next to `at` in direction `dir`: the first one
 * after it, or the last one before it. Null at either end. `times` is in order.
 */
export function neighbourFrame(times: readonly number[], at: number, dir: 1 | -1): number | null {
  if (dir > 0) return times.find((t) => t > at) ?? null;
  return times.findLast((t) => t < at) ?? null;
}

/**
 * Where playback goes after `elapsed` ms at `speed`, and whether it reached the newest kept
 * frame `end` (ms since the epoch). `at` is the moment shown now.
 */
export function playStep(at: number, elapsed: number, speed: number, end: number): { at: number; atEnd: boolean } {
  const next = at + Math.max(0, elapsed) * speed;
  return next >= end ? { at: end, atEnd: true } : { at: next, atEnd: false };
}
