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
