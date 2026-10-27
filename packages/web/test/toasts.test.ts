import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, holdToasts, toast, toasts } from "../src/toasts";

describe("toasts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    holdToasts(false);
    for (const t of [...toasts]) dismissToast(t.id);
    vi.useRealTimers();
  });

  it("shows a message and removes it after its timeout", () => {
    toast("Pack reloaded", { tone: "ok" });
    expect(toasts.map((t) => t.text)).toEqual(["Pack reloaded"]);
    vi.advanceTimersByTime(4999);
    expect(toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts).toHaveLength(0);
  });

  it("keeps errors longer and keeps a message with timeout 0 until closed", () => {
    toast("Run failed to start", { tone: "bad" });
    const id = toast("Waiting for Retry", { timeout: 0 });
    vi.advanceTimersByTime(7000);
    expect(toasts).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(toasts.map((t) => t.id)).toEqual([id]);
    vi.advanceTimersByTime(60_000);
    expect(toasts).toHaveLength(1);
  });

  it("shows at most four, dropping the oldest", () => {
    for (let i = 1; i <= 6; i++) toast(`Message ${i}`);
    expect(toasts.map((t) => t.text)).toEqual(["Message 3", "Message 4", "Message 5", "Message 6"]);
  });

  it("holds the timers while hovered and restarts them in full", () => {
    toast("Run finished");
    vi.advanceTimersByTime(4000);
    holdToasts(true);
    vi.advanceTimersByTime(20_000);
    expect(toasts).toHaveLength(1);
    holdToasts(false);
    vi.advanceTimersByTime(4999);
    expect(toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts).toHaveLength(0);
  });
});
