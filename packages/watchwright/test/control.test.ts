import { describe, expect, it, vi } from "vitest";
import { AttemptAborted, RunControl, StopNow } from "../src/jobs/control.js";

const make = () => {
  const states: string[] = [];
  const control = new RunControl({ onState: (s, i) => states.push(`${s}${i.reason ? `:${i.reason}` : ""}`) });
  return { control, states };
};

describe("run control", () => {
  it("lands a pause at the next checkpoint and resumes", async () => {
    const { control, states } = make();
    expect(control.requestPause()).toBe(true);
    expect(control.requestPause()).toBe(false);
    let passed = false;
    const at = control.checkpoint("attempt").then(() => (passed = true));
    await Promise.resolve();
    expect(control.state).toBe("paused");
    expect(passed).toBe(false);
    expect(control.resume()).toBe(true);
    await at;
    expect(passed).toBe(true);
    expect(states).toEqual(["pausing:manual", "paused:manual", "running"]);
  });

  it("cancels a pause that hasn't landed", () => {
    const { control } = make();
    control.requestPause();
    expect(control.resume()).toBe(true);
    expect(control.state).toBe("running");
  });

  it("throws StopNow inside an attempt when stopped while paused", async () => {
    const { control } = make();
    control.requestPause();
    const at = control.checkpoint("attempt");
    await Promise.resolve();
    control.stop("after");
    await expect(at).rejects.toBeInstanceOf(StopNow);
  });

  it("lets a boundary checkpoint pass when stopped while paused", async () => {
    const { control } = make();
    control.requestPause();
    const at = control.checkpoint("boundary");
    await Promise.resolve();
    control.stop("after");
    await expect(at).resolves.toBeUndefined();
    expect(control.stopMode).toBe("after");
  });

  it("stops now at the next attempt checkpoint", async () => {
    const { control } = make();
    control.stop("now");
    await expect(control.checkpoint("attempt")).rejects.toBeInstanceOf(StopNow);
    await expect(control.checkpoint("boundary")).resolves.toBeUndefined();
  });

  it("throws the abort error once an attempt is given up", async () => {
    const { control } = make();
    control.abort = new AttemptAborted("too slow");
    await expect(control.checkpoint("attempt")).rejects.toThrow("too slow");
  });

  it("waits for a decision after a broken attempt, skips after the limit, retries on change", async () => {
    vi.useFakeTimers();
    try {
      const { control } = make();
      const a = control.waitBroken(60_000, () => false);
      expect(control.state).toBe("paused");
      expect(control.deadline).not.toBeNull();
      expect(control.decide("retry")).toBe(true);
      await expect(a).resolves.toBe("retry");

      const b = control.waitBroken(60_000, () => false);
      vi.advanceTimersByTime(60_000);
      await expect(b).resolves.toBe("skip");

      let changed = false;
      const c = control.waitBroken(60_000, () => changed, 1000);
      changed = true;
      vi.advanceTimersByTime(1000);
      await expect(c).resolves.toBe("retry");

      const d = control.waitBroken(60_000, () => false);
      control.stop("after");
      await expect(d).resolves.toBe("stop");
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts paused time", async () => {
    vi.useFakeTimers();
    try {
      const { control } = make();
      control.requestPause();
      const at = control.checkpoint("attempt");
      vi.advanceTimersByTime(5000);
      expect(control.pausedMs()).toBe(5000);
      control.resume();
      await at;
      vi.advanceTimersByTime(5000);
      expect(control.pausedMs()).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });
});
