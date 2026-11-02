import { describe, expect, it } from "vitest";
import type { Dashboard, Tile } from "../src/dashboard";
import { KINDS, NO_NAMES, argOptions, kindOf, measureOptions, newTile, tileLabel, toInput, toSave, type DashboardNames } from "../src/dashedit";

const names: DashboardNames = {
  ...NO_NAMES,
  params: ["model"],
  info: ["build"],
  metrics: [{ name: "Load ms", unit: "ms" }],
  texts: ["summary"],
  files: ["report.md"],
  shots: ["home"],
  flags: [{ name: "typo", kind: "finding" }],
  criteria: [
    { id: "quality", title: "Quality", kind: "scale" },
    { id: "severity", title: "Severity", kind: "choices" },
    { id: "works", title: "Works", kind: "yesNo" },
  ],
};
const tile = (t: Partial<Tile> & Pick<Tile, "type" | "arg">): Tile => ({ width: 1, current: true, public: true, ...t });

describe("dashboard editor", () => {
  it("has every kind the server knows, once", () => {
    expect(KINDS).toHaveLength(21);
    expect(new Set(KINDS.map((k) => k.type)).size).toBe(21);
  });

  it("writes a tile back as a pack writes it, leaving out defaults", () => {
    expect(toInput(tile({ type: "metric", arg: "Load ms", of: "p90", goal: { below: 1500 } }))).toEqual({ metric: "Load ms", of: "p90", goal: { below: 1500 } });
    expect(toInput(tile({ type: "leaderboard", arg: "model", width: 2 }))).toEqual({ leaderboard: "model" });
    expect(toInput(tile({ type: "matrix", arg: true, width: 4, public: false, current: false }))).toEqual({ matrix: true, width: 4, public: false, current: false });
    expect(toInput(tile({ type: "stat", arg: "passrate", measure: "passrate" }))).toEqual({ stat: "passrate" });
    expect(toInput(tile({ type: "links", arg: true, links: [{ compare: "last" }] }))).toEqual({ links: [{ compare: "last" }] });
    expect(toInput(tile({ type: "flaky", arg: true, tests: [] }))).toEqual({ flaky: true });
  });

  it("sends tiles alone for one untitled group, and groups otherwise", () => {
    const one: Dashboard = { runs: 30, filters: [], groups: [{ title: null, tiles: [tile({ type: "outcome", arg: true })] }] };
    expect(toSave(one)).toEqual({ runs: 30, tiles: [{ outcome: true }] });
    const two: Dashboard = { runs: 20, days: 7, filters: ["model"], groups: [{ title: "A", tiles: [] }, { title: null, tiles: [tile({ type: "latest", arg: true })] }] };
    expect(toSave(two)).toEqual({ days: 7, filters: ["model"], groups: [{ title: "A", tiles: [] }, { tiles: [{ latest: true }] }] });
  });

  it("offers each kind the names that fit it", () => {
    expect(argOptions(kindOf("choices"), names).map((o) => o.value)).toEqual(["severity", "works"]);
    expect(argOptions(kindOf("score"), names).map((o) => o.value)).toEqual(["", "quality", "works"]);
    expect(argOptions(kindOf("value"), names).map((o) => o.value)).toEqual(["model", "info.build"]);
    expect(argOptions(kindOf("lowest"), names).map((o) => o.value)).toEqual(["quality", "works", "metric.Load ms"]);
    expect(argOptions(kindOf("output"), names).map((o) => o.value)).toEqual(["summary", "report.md"]);
    expect(argOptions(kindOf("outcome"), names).map((o) => o.value)).toEqual([""]);
    const m = measureOptions(names).map((o) => o.value);
    expect(m).toContain("metric.Load ms");
    expect(m).toContain("flags.typo");
    expect(m).not.toContain("score.severity");
    expect(new Set(m).size).toBe(m.length);
  });

  it("makes new tiles the server accepts", () => {
    expect(newTile("failures", true).width).toBe(2);
    expect(newTile("scatter", "model")).toMatchObject({ x: "passrate", y: "duration" });
    expect(newTile("stat", "passrate").measure).toBe("passrate");
    expect(newTile("links", true).links).toEqual([{ compare: "last" }]);
  });

  it("names tiles for the list", () => {
    expect(tileLabel(tile({ type: "metric", arg: "Load ms" }))).toBe("Metric: Load ms");
    expect(tileLabel(tile({ type: "matrix", arg: true }))).toBe("Matrix");
    expect(tileLabel(tile({ type: "stat", arg: "passrate" }))).toBe("Number: Pass rate");
    expect(tileLabel(tile({ type: "note", arg: "Hi", title: "About" }))).toBe("About");
  });
});
