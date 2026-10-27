import { describe, expect, it } from "vitest";
import { dropIndex, moveItem } from "../src/reorder";
import { clampSplit, loadSplit, saveSplit, splitAt } from "../src/split";
import { clock, clusterMarks, fitTimelineZoom, laneSteps, nextStart, stepAt, stepTimelineZoom, timeTicks } from "../src/timeline";

describe("split panes", () => {
  it("keeps both panes above their minimum", () => {
    expect(clampSplit(50, 1000, 120, 120)).toBe(50);
    expect(clampSplit(5, 1000, 120, 120)).toBe(12);
    expect(clampSplit(95, 1000, 120, 200)).toBe(80);
  });
  it("shares a space too small for both minimums in proportion", () => {
    expect(clampSplit(50, 200, 300, 100)).toBe(75);
  });
  it("turns a pointer offset into a share", () => {
    expect(splitAt(250, 1000)).toBe(25);
    expect(splitAt(10, 0)).toBe(50);
  });
  it("remembers a size and ignores junk", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadSplit(store, "run")).toBeNull();
    saveSplit(store, "run", 33.333);
    expect(loadSplit(store, "run")).toBe(33.33);
    m.set("watchwright.split.run", "abc");
    expect(loadSplit(store, "run")).toBeNull();
    expect(loadSplit(null, "run")).toBeNull();
  });
});

describe("timeline", () => {
  const steps = [
    { id: "a", label: "Open page", start: 0, end: 4000 },
    { id: "b", label: "Search", start: 4000, end: 9000 },
    { id: "c", label: "Network wait", start: 5000, end: 7000 },
    { id: "d", label: "Checkout", start: 9000, end: 20_000 },
  ];
  it("puts overlapping steps on separate lanes", () => {
    expect(laneSteps(steps).map((l) => l.map((s) => s.id))).toEqual([["a", "b", "d"], ["c"]]);
  });
  it("finds the step at a time, preferring the one started last", () => {
    expect(stepAt(steps, 6000)?.id).toBe("c");
    expect(stepAt(steps, 8000)?.id).toBe("b");
    expect(stepAt(steps, 25_000)).toBeNull();
  });
  it("jumps between step starts", () => {
    expect(nextStart(steps, 4000, 1)).toBe(5000);
    expect(nextStart(steps, 4000, -1)).toBe(0);
    expect(nextStart(steps, 9000, 1)).toBeNull();
  });
  it("spaces ticks at least the gap apart", () => {
    expect(timeTicks(20_000, 800)).toEqual([0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000, 16_000, 18_000, 20_000]);
    expect(timeTicks(3_600_000, 600)).toEqual([0, 600_000, 1_200_000, 1_800_000, 2_400_000, 3_000_000, 3_600_000]);
    expect(timeTicks(0, 600)).toEqual([0]);
  });
  it("picks sub-second ticks that tenths show exactly", () => {
    // 2.7 s on 930 px: 250 ms ticks would read 0:00.2, 0:00.5, 0:00.7.
    expect(timeTicks(2700, 930).map((t) => clock(t, true))).toEqual(["0:00.0", "0:00.5", "0:01.0", "0:01.5", "0:02.0", "0:02.5"]);
    expect(timeTicks(2700, 1600)).toEqual([0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600]);
  });
  it("groups marks that would sit on top of each other", () => {
    const marks = [
      { at: 1000, label: "a" },
      { at: 1050, label: "b" },
      { at: 9000, label: "c" },
      { at: 1100, label: "d" },
    ];
    // 10 s on 1000 px: 10 ms a pixel, so marks less than 160 ms from the one before join.
    expect(clusterMarks(marks, 10_000, 1000).map((c) => [c.at, c.marks.map((m) => m.label)])).toEqual([
      [1000, ["a", "b", "d"]],
      [9000, ["c"]],
    ]);
    // Zoomed in ten times they come apart.
    expect(clusterMarks(marks, 10_000, 10_000)).toHaveLength(4);
  });
  it("zooms in steps and opens far enough in for most labels", () => {
    expect(stepTimelineZoom(1, 1)).toBe(2);
    expect(stepTimelineZoom(2, -1)).toBe(1);
    expect(stepTimelineZoom(1, -1)).toBe(1);
    expect(stepTimelineZoom(64, 1)).toBe(64);
    const many = Array.from({ length: 60 }, (_, i) => ({ id: String(i), label: `Step ${i}`, start: i * 5000, end: (i + 1) * 5000 }));
    // 60 steps of 5 s on 900 px are 15 px each: 4× makes them 60 px.
    expect(fitTimelineZoom(many, 300_000, 900)).toBe(4);
    expect(fitTimelineZoom(many.slice(0, 5), 25_000, 900)).toBe(1);
    // Never further in than 8× on opening.
    expect(fitTimelineZoom(many, 3_000_000, 900)).toBe(8);
    expect(fitTimelineZoom([], 1000, 900)).toBe(1);
  });
  it("formats clock times", () => {
    expect(clock(7400)).toBe("0:07");
    expect(clock(7400, true)).toBe("0:07.4");
    expect(clock(83_000)).toBe("1:23");
    expect(clock(3_723_000)).toBe("1:02:03");
  });
});

describe("reorder", () => {
  it("moves an item", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 9)).toEqual(["b", "a"]);
  });
  it("drops past the middles the pointer crossed", () => {
    const mids = [20, 60, 100, 140];
    expect(dropIndex(mids, 70, 0)).toBe(1);
    expect(dropIndex(mids, 150, 0)).toBe(3);
    expect(dropIndex(mids, 10, 3)).toBe(0);
    expect(dropIndex(mids, 120, 3)).toBe(3);
  });
  it("never passes a locked item", () => {
    const mids = [20, 60, 100, 140];
    expect(dropIndex(mids, 150, 3, (i) => i === 0)).toBe(3);
    expect(dropIndex(mids, 10, 3, (i) => i === 0)).toBe(1);
    expect(dropIndex(mids, 150, 1, (i) => i === 2)).toBe(1);
  });
});
