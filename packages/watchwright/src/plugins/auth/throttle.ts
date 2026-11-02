// Slows down guessing passwords: after FREE failures for a name or an address within WINDOW_MS,
// each further try has to wait, from 1 s doubling up to 60 s (docs/plans/self-hosting.md, 2.3).

export const FREE = 5;
export const WINDOW_MS = 15 * 60_000;
const MAX_WAIT_MS = 60_000;

interface Entry {
  failures: number;
  first: number;
  last: number;
}

export class Throttle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  private entry(key: string): Entry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (this.now() - e.first > WINDOW_MS) {
      this.entries.delete(key);
      return null;
    }
    return e;
  }

  /** How long to wait before the next try for any of these keys; 0 when it may go now. */
  waitMs(keys: readonly string[]): number {
    let wait = 0;
    for (const k of keys) {
      const e = this.entry(k);
      if (!e || e.failures < FREE) continue;
      const delay = Math.min(1000 * 2 ** (e.failures - FREE), MAX_WAIT_MS);
      wait = Math.max(wait, e.last + delay - this.now());
    }
    return Math.max(0, wait);
  }

  failed(keys: readonly string[]): void {
    const t = this.now();
    for (const k of keys) {
      const e = this.entry(k);
      if (e) {
        e.failures++;
        e.last = t;
      } else this.entries.set(k, { failures: 1, first: t, last: t });
    }
    if (this.entries.size > 10_000) for (const [k, e] of this.entries) if (t - e.first > WINDOW_MS) this.entries.delete(k);
  }

  cleared(keys: readonly string[]): void {
    for (const k of keys) this.entries.delete(k);
  }
}
