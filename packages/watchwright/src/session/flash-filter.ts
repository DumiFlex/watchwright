import { jpegLuma, type LumaGrid } from "./jpeg-dc.js";

// Firefox's screencast sometimes sends a frame before every part of the page is painted again:
// whole tiles (256 or 512 px) show the page background for one frame, then the next frame is
// whole. In a video they flash as dark or light boxes. This filter holds each frame until the
// next one arrives and drops it when a large area differs from both the last frame it let through
// and the next one, while those two agree there: a flash, not a change. Chromium doesn't do this,
// so only Firefox sessions use it.

/** How far a block's brightness (0–255) must move to count as changed, and stay to count as the same. */
const CHANGED = 10;
const SAME = 4;
/** The fewest changed 8×8 blocks that make a flash: 128 blocks is 8192 px², more than a caret, a counter or a hover highlight; the flashes are whole 256 or 512 px tiles. */
const MIN_BLOCKS = 128;

export interface FlashFrame {
  data: Buffer;
}

/** The 8×8 blocks of `a` that differ from both `before` and `after` where those two agree. */
export function flashBlocks(before: LumaGrid, a: LumaGrid, after: LumaGrid): number {
  if (before.luma.length !== a.luma.length || after.luma.length !== a.luma.length) return 0;
  let n = 0;
  for (let i = 0; i < a.luma.length; i++) {
    const p = before.luma[i]!;
    const c = a.luma[i]!;
    const q = after.luma[i]!;
    if (Math.abs(c - p) > CHANGED && Math.abs(c - q) > CHANGED && Math.abs(p - q) < SAME) n++;
  }
  return n;
}

export class FlashFilter<F extends FlashFrame> {
  private pending: { frame: F; grid: LumaGrid | null } | null = null;
  private last: LumaGrid | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Frames dropped so far. */
  dropped = 0;

  /**
   * @param emit gets every frame that isn't a flash, one frame late.
   * @param holdMs how long a frame waits for the next one before it goes out anyway (a page that
   *   stopped changing sends no more frames).
   */
  constructor(
    private readonly emit: (frame: F) => void,
    private readonly holdMs = 120,
  ) {}

  push(frame: F): void {
    const grid = jpegLuma(frame.data);
    const held = this.pending;
    if (held) {
      this.clearTimer();
      if (held.grid && grid && this.last && flashBlocks(this.last, held.grid, grid) >= MIN_BLOCKS) {
        this.dropped++;
      } else {
        this.release(held);
      }
    }
    this.pending = { frame, grid };
    this.timer = setTimeout(() => this.flush(), this.holdMs);
    this.timer.unref?.();
  }

  /** Lets the held frame out now (the page stopped changing, or capture is stopping). */
  flush(): void {
    this.clearTimer();
    const held = this.pending;
    this.pending = null;
    if (held) this.release(held);
  }

  private release(held: { frame: F; grid: LumaGrid | null }): void {
    if (held.grid) this.last = held.grid;
    this.emit(held.frame);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
