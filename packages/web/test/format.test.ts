import { describe, expect, it } from "vitest";
import { ago, clockTime, countsText, done, duration, fileSize, isActive, runDuration } from "../src/format";

const counts = { passed: 3, failed: 1, broken: 1, skipped: 0, stopped: 0, running: 0, interrupted: 0, planned: 6 };

describe("format", () => {
  it("writes durations", () => {
    expect(duration(null)).toBe("");
    expect(duration(850)).toBe("850 ms");
    expect(duration(4200)).toBe("4.2 s");
    expect(duration(185_000)).toBe("3 min 5 s");
    expect(duration(119_700)).toBe("2 min 0 s");
    expect(duration(2 * 3_600_000 + 4 * 60_000)).toBe("2 h 4 min");
  });

  it("measures a run to its end, or to now while it runs", () => {
    expect(runDuration({ startedAt: null, finishedAt: null })).toBeNull();
    expect(runDuration({ startedAt: "2026-10-27T10:00:00Z", finishedAt: "2026-10-27T10:00:30Z" })).toBe(30_000);
    expect(runDuration({ startedAt: "2026-10-27T10:00:00Z", finishedAt: null }, Date.parse("2026-10-27T10:01:00Z"))).toBe(60_000);
    expect(runDuration({ startedAt: "2026-10-27T10:00:00Z", finishedAt: null })).toBeNull();
  });

  it("says how long ago", () => {
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(ago("2026-10-27T11:59:50Z", now)).toBe("just now");
    expect(ago("2026-10-27T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-10-27T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-10-26T09:00:00Z", now)).toBe("yesterday");
  });

  it("counts results", () => {
    expect(countsText(counts)).toBe("3 passed, 1 failed, 1 broken of 6");
    expect(done(counts)).toBe(5);
    expect(isActive("paused")).toBe(true);
    expect(isActive("finished")).toBe(false);
  });
  it("writes video positions and file sizes", () => {
    expect(clockTime(7.9)).toBe("0:07");
    expect(clockTime(754)).toBe("12:34");
    expect(clockTime(3723)).toBe("1:02:03");
    expect(clockTime(Infinity)).toBe("0:00");
    expect(fileSize(820)).toBe("820 B");
    expect(fileSize(12 * 1024)).toBe("12 KB");
    expect(fileSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });
});
