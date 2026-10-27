import { describe, expect, it } from "vitest";
import { areaPath, columnPath, compact, linePath, niceTicks, scale, slotAt } from "../src/chart";

describe("scale", () => {
  it("maps a domain onto a range", () => {
    const s = scale([0, 10], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(0);
  });
  it("puts a flat domain in the middle", () => {
    expect(scale([3, 3], [0, 40])(3)).toBe(20);
  });
});

describe("niceTicks", () => {
  it("steps in round numbers past the max", () => {
    expect(niceTicks(47)).toEqual([0, 20, 40, 60]);
    expect(niceTicks(10)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(1840)).toEqual([0, 500, 1000, 1500, 2000]);
  });
  it("copes with nothing to show", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("compact", () => {
  it("shortens big numbers and keeps small ones", () => {
    expect(compact(1284)).toBe("1,284");
    expect(compact(12_900)).toBe("12.9K");
    expect(compact(4_200_000)).toBe("4.2M");
    expect(compact(96.4)).toBe("96.4");
    expect(compact(-15_000)).toBe("-15K");
  });
});

describe("paths", () => {
  it("draws a line and the area under it", () => {
    expect(linePath([[0, 10], [5, 2]])).toBe("M0,10L5,2");
    expect(areaPath([[0, 10], [5, 2]], 12)).toBe("M0,10L5,2L5,12L0,12Z");
    expect(areaPath([], 12)).toBe("");
  });
  it("rounds only the top of a column", () => {
    expect(columnPath(0, 0, 10, 20, 4)).toBe("M0,20V4Q0,0 4,0H6Q10,0 10,4V20Z");
    expect(columnPath(0, 0, 10, 0)).toBe("");
  });
  it("keeps a short column's radius within its height", () => {
    expect(columnPath(0, 18, 10, 2, 4)).toBe("M0,20V20Q0,18 2,18H8Q10,18 10,20V20Z");
  });
});

describe("slotAt", () => {
  it("finds the slot under the pointer, clamped to the ends", () => {
    expect(slotAt(0, 100, 4)).toBe(0);
    expect(slotAt(30, 100, 4)).toBe(1);
    expect(slotAt(250, 100, 4)).toBe(3);
    expect(slotAt(-5, 100, 4)).toBe(0);
    expect(slotAt(10, 100, 0)).toBe(-1);
  });
});
