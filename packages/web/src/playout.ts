// A playback (jitter) buffer for the live view, as video players have: each frame is shown at the
// time it was captured, a short, steady delay behind, instead of the moment it happens to arrive.
// Frames that the network or decoding bunched up or spread out are evened out again, so motion
// that was steady in the browser looks steady here. See docs/research/smooth-videos.md.
//
// The viewer's clock and the browser's aren't the same, so the buffer learns the gap from the
// frames themselves: the smallest (arrival − capture time) over the last few seconds is the clock
// difference plus the quickest delivery; a frame is due `delay` ms after that.

export interface Playable {
  close(): void;
}

/** How far behind capture time frames are shown, past the quickest delivery seen lately. */
export const PLAYOUT_DELAY_MS = 150;
/** How long the quickest delivery is remembered: a slower network is learned this soon. */
const OFFSET_WINDOW_MS = 4000;
/** At most this many frames wait; past it the oldest are dropped (a tab in the background). */
const MAX_WAITING = 60;

export class Playout<T extends Playable> {
  private waiting: { at: number; item: T }[] = [];
  private samples: { arrived: number; gap: number }[] = [];
  private lastShown = -Infinity;

  constructor(
    private readonly delayMs = PLAYOUT_DELAY_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The clock gap the buffer works with now (arrival − capture time at its quickest), or null before any frame. */
  offset(): number | null {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.gap)) : null;
  }

  /** A frame captured at `at` (ms, the browser's clock). An older frame than one shown is closed. */
  add(at: number, item: T): void {
    if (at <= this.lastShown) {
      item.close();
      return;
    }
    const arrived = this.now();
    this.samples.push({ arrived, gap: arrived - at });
    this.samples = this.samples.filter((s) => arrived - s.arrived <= OFFSET_WINDOW_MS);
    let i = this.waiting.length;
    while (i > 0 && this.waiting[i - 1]!.at > at) i--;
    this.waiting.splice(i, 0, { at, item });
    while (this.waiting.length > MAX_WAITING) this.waiting.shift()!.item.close();
  }

  /**
   * The newest frame that is due now, or null when none is. Frames due before it were never shown
   * and are closed. Ask on every animation frame.
   */
  due(): T | null {
    const offset = this.offset();
    if (offset === null) return null;
    const now = this.now();
    let found: { at: number; item: T } | null = null;
    while (this.waiting.length && this.waiting[0]!.at + offset + this.delayMs <= now) {
      found?.item.close();
      found = this.waiting.shift()!;
    }
    if (!found) return null;
    this.lastShown = found.at;
    return found.item;
  }

  /** How many frames wait. */
  get size(): number {
    return this.waiting.length;
  }

  /** Every waiting frame, newest last, out of the buffer (when it's turned off). */
  drain(): T[] {
    const all = this.waiting.map((w) => w.item);
    this.waiting = [];
    return all;
  }

  clear(): void {
    for (const w of this.waiting) w.item.close();
    this.waiting = [];
    this.samples = [];
    this.lastShown = -Infinity;
  }
}
