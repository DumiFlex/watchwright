// Sizes for SplitPane: the first pane's share of the space, in percent, kept so neither
// pane gets smaller than its minimum in pixels. Kept apart from the component to test it.
import type { Store } from "./theme";

/** Clamps `pct` so the first pane is at least `minFirst` px and the second `minSecond` px. */
export function clampSplit(pct: number, total: number, minFirst: number, minSecond: number): number {
  if (!(total > 0)) return Math.min(100, Math.max(0, pct));
  const lo = (minFirst / total) * 100;
  const hi = 100 - (minSecond / total) * 100;
  // Too small for both minimums: split the space in proportion to them.
  if (lo > hi) return (minFirst / (minFirst + minSecond)) * 100;
  return Math.min(hi, Math.max(lo, pct));
}

/** The share for a pointer at `offset` px from the start of a container `total` px long. */
export function splitAt(offset: number, total: number): number {
  return total > 0 ? (offset / total) * 100 : 50;
}

const PREFIX = "watchwright.split.";

export function loadSplit(store: Store | null, key: string): number | null {
  try {
    const raw = store?.getItem(PREFIX + key);
    const v = Number(raw);
    return raw && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  } catch {
    return null;
  }
}

export function saveSplit(store: Store | null, key: string, pct: number) {
  try {
    store?.setItem(PREFIX + key, pct.toFixed(2));
  } catch {
    // Storage full or blocked: the size just isn't remembered.
  }
}
