import { describe, expect, it } from "vitest";
import { noteFor, progress, runTitle, runTone, settingsText } from "../src/runstate";

const counts = { passed: 3, failed: 0, broken: 0, skipped: 1, stopped: 0, running: 1, interrupted: 0, planned: 12 };
const run = { id: "3011fc76", label: "", packName: "Shop smoke", status: "running" as const, counts };

describe("run state", () => {
  it("counts attempts with a result", () => {
    expect(progress(run)).toEqual({ done: 4, of: 12 });
  });

  it("puts the state first in the tab title", () => {
    expect(runTitle(run, { state: "running", pauseReason: null, testId: "S1" })).toBe("Running 4/12 · Shop smoke 3011fc76 · Watchwright");
    expect(runTitle({ ...run, label: "nightly" }, { state: "paused", pauseReason: "broken", testId: "S1" })).toBe("Paused: S1 broke · nightly · Shop smoke · Watchwright");
    expect(runTitle({ ...run, status: "finished", counts: { ...counts, skipped: 9, running: 0 } }, null)).toBe("Done 12/12 · Shop smoke 3011fc76 · Watchwright");
    expect(runTitle({ ...run, status: "finished", counts: { ...counts, failed: 1 } }, null)).toMatch(/^Done with problems/);
    expect(runTitle({ ...run, status: "queued" }, null)).toMatch(/^Queued · /);
  });

  it("colors the favicon dot by state", () => {
    expect(runTone(run, { state: "running", pauseReason: null, testId: null })).toBe("accent");
    expect(runTone(run, { state: "paused", pauseReason: "broken", testId: "S1" })).toBe("warn");
    expect(runTone(run, { state: "paused", pauseReason: "manual", testId: null })).toBe("paused");
    expect(runTone({ ...run, status: "finished" }, null)).toBe("ok");
    expect(runTone({ ...run, status: "finished", counts: { ...counts, broken: 1 } }, null)).toBe("bad");
    expect(runTone({ ...run, status: "stopped" }, null)).toBeNull();
  });

  it("writes notifications for finished, paused on broken and failed starts", () => {
    const fin = noteFor("run.finished", { status: "finished" }, { ...run, counts: { ...counts, failed: 2 } });
    expect(fin).toEqual({ title: "Finished: Shop smoke 3011fc76", body: "3 passed, 2 failed", tag: "run-3011fc76" });
    const now = Date.parse("2026-10-27T12:00:00Z");
    const paused = noteFor("run.paused", { reason: "broken", testId: "S1", deadline: "2026-10-27T12:20:00Z" }, { ...run, label: "nightly" }, now);
    expect(paused?.title).toBe("Paused: Shop smoke: nightly");
    expect(paused?.body).toBe("S1 broke. Retry or skip it; it skips by itself in 20 min.");
    expect(noteFor("run.paused", { reason: "manual" }, run)).toBeNull();
    expect(noteFor("run.failed_to_start", { message: "No browser" }, run)?.body).toBe("No browser");
    expect(noteFor("attempt.step", {}, run)).toBeNull();
  });
});

describe("settingsText", () => {
  it("says who changed what", () => {
    expect(settingsText({ changed: { pauseLimitMinutes: 30, video: false }, by: "web" })).toBe("Settings changed (web): skip a broken test after 30 min, no video.");
    expect(settingsText({ changed: { testTimeoutMinutes: null, trace: "always", pauseOnBroken: false } })).toBe(
      "Settings changed: don't pause when a test breaks, each test's own time limit, trace always.",
    );
    expect(settingsText({ changed: { testTimeoutMinutes: 5 } })).toBe("Settings changed: 5 min per test.");
    expect(settingsText({ changed: { video: "problems", runVideo: true } })).toBe("Settings changed: video only on problems, run video on.");
  });
});
