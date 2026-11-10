import { serviceKey } from "../../core/services.js";
import type { PackRegistry } from "./registry.js";

/** How often the packs' files are checked for changes. */
export const WATCH_EVERY_MS = 2000;

/**
 * Rebuilds packs whose files changed outside Watchwright (an editor, git, an agent): every
 * WATCH_EVERY_MS it asks the registry to check each pack's stamp. Polling, not fs.watch, so it
 * works the same on Docker bind mounts and network shares. See docs/research/pack-refresh.md.
 */
export class PackWatch {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly registry: PackRegistry,
    private readonly on: () => boolean,
  ) {}

  start(every = WATCH_EVERY_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  /** One check of every pack; a tick while the last one still runs does nothing. */
  tick(): Promise<void> {
    if (this.running || !this.on()) return this.running ?? Promise.resolve();
    this.running = (async () => {
      try {
        for (const p of this.registry.list()) await this.registry.check(p.id).catch(() => undefined);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}

export const PACK_WATCH = serviceKey<PackWatch>("packs.watch");
