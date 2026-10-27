import { describe, expect, it } from "vitest";
import { rewindSteps } from "../src/rewind";

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
