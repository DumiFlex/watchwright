import { describe, expect, it } from "vitest";
import { neighbourFrame, playStep, rewindSteps } from "../src/rewind";

describe("rewind steps", () => {
  it("lays steps over the window, each until the next starts", () => {
    const steps = [
      { at: 500, label: "before" },
      { at: 1500, label: "open" },
      { at: 2500, label: "ask" },
      { at: 9000, label: "after" },
    ];
    expect(rewindSteps(steps, 1000, 4000)).toEqual([
      { id: "0", label: "before", start: 0, end: 500 },
      { id: "1", label: "open", start: 500, end: 1500 },
      { id: "2", label: "ask", start: 1500, end: 3000 },
    ]);
  });

  it("drops steps that ended before the window", () => {
    expect(rewindSteps([{ at: 0, label: "a" }, { at: 100, label: "b" }], 1000, 2000)).toEqual([{ id: "1", label: "b", start: 0, end: 1000 }]);
  });
});

describe("rewind playback", () => {
  it("finds the frame next to a moment in either direction", () => {
    const times = [100, 200, 300];
    expect(neighbourFrame(times, 200, 1)).toBe(300);
    expect(neighbourFrame(times, 200, -1)).toBe(100);
    expect(neighbourFrame(times, 250, -1)).toBe(200);
    expect(neighbourFrame(times, 300, 1)).toBeNull();
    expect(neighbourFrame(times, 100, -1)).toBeNull();
  });

  it("moves with the clock at the chosen speed and stops at the newest frame", () => {
    expect(playStep(1000, 100, 1, 5000)).toEqual({ at: 1100, atEnd: false });
    expect(playStep(1000, 100, 4, 5000)).toEqual({ at: 1400, atEnd: false });
    expect(playStep(1000, 100, 0.5, 5000)).toEqual({ at: 1050, atEnd: false });
    expect(playStep(4950, 100, 1, 5000)).toEqual({ at: 5000, atEnd: true });
    expect(playStep(1000, -50, 1, 5000)).toEqual({ at: 1000, atEnd: false });
  });
});
