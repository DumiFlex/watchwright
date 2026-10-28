import { describe, expect, it } from "vitest";
import { anything, bars, dayLabel, rate, tiles, type RunStats, type StatCounts } from "../src/runstats";

const c = (o: Partial<StatCounts> = {}): StatCounts => ({ runs: 0, passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, medianMs: null, ...o });
const stats = (cur: Partial<StatCounts>, prev: Partial<StatCounts>): RunStats => ({
  days: [
    { date: "2026-10-26", ...c({ runs: 1, passed: 8, failed: 2, medianMs: 4000 }) },
    { date: "2026-10-27", ...c({ runs: 2, passed: 9, broken: 1, medianMs: 6000 }) },
  ],
  current: c(cur),
  previous: c(prev),
});

describe("rate", () => {
  it("is passed out of passed, failed and broken, to a tenth of a percent", () => {
    expect(rate(c({ passed: 2, failed: 1 }))).toBe(66.7);
    expect(rate(c({ skipped: 3 }))).toBeNull();
  });
});

describe("tiles", () => {
  it("compares with the period before", () => {
    const t = tiles(stats({ runs: 3, passed: 17, failed: 2, broken: 1, medianMs: 5000 }, { runs: 2, passed: 9, failed: 1, broken: 0, medianMs: 5400 }), "en-US");
    expect(t.map((x) => [x.key, x.value, x.unit, x.delta])).toEqual([
      ["runs", 3, undefined, 1],
      ["rate", 85, "%", -5],
      ["broken", 1, undefined, 1],
      ["median", 5, " s", -0.4],
    ]);
    expect(t[1]!.formatDelta!(-5)).toBe("-5 pts");
    expect(t[3]!.goodWhen).toBe("down");
    expect(t[0]!.trend).toEqual([1, 2]);
    expect(t[1]!.trend).toEqual([80, 90]);
    expect(t[3]!.trend).toEqual([4, 6]);
    expect(t[0]!.trendLabels).toEqual(["Oct 26", "Oct 27"]);
  });
  it("has no change to show without an earlier period, and dashes without results", () => {
    const t = tiles(stats({ runs: 1 }, {}), "en-US");
    expect(t.every((x) => x.delta === undefined)).toBe(true);
    expect(t[1]!.value).toBe("–");
    expect(t[1]!.unit).toBeUndefined();
    expect(t[3]!.value).toBe("–");
  });
});

describe("bars", () => {
  it("makes one column per day", () => {
    expect(bars(stats({}, {}), "en-US")[1]).toEqual({ label: "Oct 27", values: { passed: 9, failed: 0, broken: 1, skipped: 0 } });
  });
});

describe("anything", () => {
  it("is true once there was a run in either period", () => {
    expect(anything(stats({}, {}))).toBe(false);
    expect(anything(stats({}, { runs: 1 }))).toBe(true);
  });
});

it("labels a day by month and day", () => {
  expect(dayLabel("2026-11-02", "en-US")).toBe("Nov 2");
});
