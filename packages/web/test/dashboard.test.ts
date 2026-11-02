import { describe, expect, it } from "vitest";
import { filterQuery, formatChange, formatValue, measureLabel, meetsGoal, runName, share } from "../src/dashboard";

describe("dashboard helpers", () => {
  it("formats a measure's value by what it is", () => {
    expect(formatValue(0.667, "passrate")).toBe("67%");
    expect(formatValue(4.333, "score.quality")).toBe("4.33");
    expect(formatValue(9.5, "metric.AI s", "s")).toBe("9.5 s");
    expect(formatValue(65_000, "duration")).toBe("1 min 5 s");
    expect(formatValue(1500.4, "metric.Load", "ms")).toBe("1.5 s");
    expect(formatValue(null, "passrate")).toBe("–");
    expect(formatChange(-0.1, "passrate")).toBe("−10%");
    expect(formatChange(2, "metric.AI s", "s")).toBe("+2 s");
  });

  it("checks a goal", () => {
    expect(meetsGoal(4, { below: 5 })).toBe(true);
    expect(meetsGoal(6, { below: 5 })).toBe(false);
    expect(meetsGoal(6, { above: 5 })).toBe(true);
    expect(meetsGoal(6, null)).toBeNull();
    expect(meetsGoal(null, { below: 1 })).toBeNull();
  });

  it("names measures and runs, and builds the filter", () => {
    expect(measureLabel("score.quality")).toBe("quality");
    expect(measureLabel("metric.AI s")).toBe("AI s");
    expect(measureLabel("flags.finding")).toBe("finding flags");
    expect(measureLabel("passrate")).toBe("Pass rate");
    expect(runName({ label: "", id: "00000001" })).toBe("00000001");
    expect(runName({ runLabel: "nightly", runId: "00000001" })).toBe("nightly");
    expect(filterQuery({ model: "q9", format: "" })).toBe("model=q9");
  });

  it("works out a bar's share of its column, from zero", () => {
    expect(share(5, [5, 10])).toBe(0.5);
    expect(share(10, [5, 10])).toBe(1);
    expect(share(null, [5, 10])).toBe(0);
    expect(share(-2, [-2, 2])).toBe(0);
  });
});
