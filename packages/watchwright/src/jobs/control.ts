// Pause and stop for one run. Playwright has no hook before each action, so a pause request takes
// effect at the next checkpoint: every `h` helper call, every `h.step` and every attempt boundary
// (docs/plan.md, section 2.2). "Stop now" doesn't wait for a checkpoint: the engine closes the
// browser context, and the next checkpoint (or the failing Playwright call) ends the attempt.

export type ControlState = "running" | "pausing" | "paused";
export type PauseReason = "manual" | "broken";
export type BrokenDecision = "retry" | "skip" | "stop";

/** Thrown at a checkpoint once the run is stopping now. */
export class StopNow extends Error {
  override name = "StopNow";
  constructor() {
    super("The run was stopped.");
  }
}

/** Thrown at a checkpoint once the attempt ran out of time or was given up. */
export class AttemptAborted extends Error {
  override name = "AttemptAborted";
}

export interface ControlListener {
  onState(state: ControlState, info: { reason: PauseReason | null; deadline: string | null }): void;
}

export class RunControl {
  state: ControlState = "running";
  reason: PauseReason | null = null;
  stopMode: "after" | "now" | null = null;
  /** When a broken pause gives up and skips (ISO time), while paused after a break. */
  deadline: string | null = null;
  private resumeWaiter: ((stop: boolean) => void) | null = null;
  private brokenWaiter: ((d: BrokenDecision) => void) | null = null;
  private pausedSince: number | null = null;
  private pausedTotal = 0;
  /** Set while an attempt runs; checkpoints throw it once the attempt is aborted. */
  abort: AttemptAborted | null = null;
  private stoppedNow!: () => void;
  /** Resolves once "stop now" is requested. */
  readonly whenStoppedNow: Promise<void>;

  constructor(private readonly listener: ControlListener) {
    this.whenStoppedNow = new Promise((resolve) => (this.stoppedNow = resolve));
  }

  /** Milliseconds this run has spent paused so far (attempt time limits leave it out). */
  pausedMs(): number {
    return this.pausedTotal + (this.pausedSince === null ? 0 : Date.now() - this.pausedSince);
  }

  private set(state: ControlState, reason: PauseReason | null) {
    if (state === "paused" && this.pausedSince === null) this.pausedSince = Date.now();
    if (state !== "paused" && this.pausedSince !== null) {
      this.pausedTotal += Date.now() - this.pausedSince;
      this.pausedSince = null;
    }
    this.state = state;
    this.reason = reason;
    if (state !== "paused") this.deadline = null;
    this.listener.onState(state, { reason, deadline: this.deadline });
  }

  /** Asks for a pause at the next checkpoint. False when already pausing or paused, or stopping. */
  requestPause(): boolean {
    if (this.state !== "running" || this.stopMode) return false;
    this.set("pausing", "manual");
    return true;
  }

  /** Resumes a manual pause (or cancels a pause that hasn't landed yet). */
  resume(): boolean {
    if (this.state === "pausing") {
      this.set("running", null);
      return true;
    }
    if (this.state === "paused" && this.reason === "manual" && this.resumeWaiter) {
      const w = this.resumeWaiter;
      this.resumeWaiter = null;
      this.set("running", null);
      w(false);
      return true;
    }
    return false;
  }

  /** Answers a pause after a broken attempt. */
  decide(decision: BrokenDecision): boolean {
    if (this.state !== "paused" || this.reason !== "broken" || !this.brokenWaiter) return false;
    const w = this.brokenWaiter;
    this.brokenWaiter = null;
    this.set("running", null);
    w(decision);
    return true;
  }

  /** "after": finish the current attempt, then end. "now": end at once. */
  stop(mode: "after" | "now"): void {
    if (this.stopMode === "now") return;
    this.stopMode = mode;
    if (mode === "now") this.stoppedNow();
    if (this.resumeWaiter) {
      const w = this.resumeWaiter;
      this.resumeWaiter = null;
      this.set("running", null);
      w(true);
    }
    if (this.brokenWaiter) this.decide("stop");
    if (this.state === "pausing") this.set("running", null);
  }

  /**
   * A pause point. Lands a requested pause and waits for Resume or Stop. `where` tells what a
   * stop means here: at a boundary nothing is in progress; inside an attempt the attempt ends stopped.
   */
  async checkpoint(where: "boundary" | "attempt"): Promise<void> {
    if (this.abort && where === "attempt") throw this.abort;
    if (this.stopMode === "now" && where === "attempt") throw new StopNow();
    if (this.state !== "pausing") return;
    this.set("paused", "manual");
    const stopped = await new Promise<boolean>((resolve) => (this.resumeWaiter = resolve));
    if (stopped && where === "attempt") throw new StopNow();
    if (this.abort && where === "attempt") throw this.abort;
  }

  /**
   * Pauses after a broken attempt until Retry, Skip or Stop. Skips by itself after `limitMs`, and
   * retries by itself when `changed()` turns true (the person fixed the test file).
   */
  async waitBroken(limitMs: number, changed: () => boolean, pollMs = 1000): Promise<BrokenDecision> {
    if (this.stopMode) return "stop";
    this.deadline = new Date(Date.now() + limitMs).toISOString();
    const decision = new Promise<BrokenDecision>((resolve) => (this.brokenWaiter = resolve));
    this.set("paused", "broken");
    const timer = setTimeout(() => this.decide("skip"), limitMs);
    const poll = setInterval(() => {
      if (changed()) this.decide("retry");
    }, pollMs);
    try {
      return await decision;
    } finally {
      clearTimeout(timer);
      clearInterval(poll);
    }
  }

  /** Waits `ms`, not counting time spent paused; a pause point every so often. */
  async sleep(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      const slice = Math.min(left, 200);
      await new Promise((r) => setTimeout(r, slice));
      left -= slice;
      await this.checkpoint("attempt");
    }
  }
}
