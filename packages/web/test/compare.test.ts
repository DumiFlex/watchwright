import { describe, expect, it } from "vitest";
import { cellsDiffer, differingParams, exportUrl, paramsText, rowDiffers, rowMatches, runIdsOf, runScores, shotOf, showOptions } from "../src/compare";

describe("compare helpers", () => {
  it("reads run ids from the address", () => {
    expect(runIdsOf("aaaa0001,bad,aaaa0001,bbbb0002")).toEqual(["aaaa0001", "bbbb0002"]);
    expect(runIdsOf(undefined)).toEqual([]);
    expect(runIdsOf(Array.from({ length: 8 }, (_, i) => `0000000${i}`).join(","))).toHaveLength(6);
  });

  it("names params and finds the ones that differ", () => {
    const runs = [{ params: { model: "q9", lang: "en" } }, { params: { model: "haiku", lang: "en" } }];
    expect(differingParams(runs)).toEqual(["model"]);
    expect(paramsText(runs[0]!.params)).toBe("model=q9, lang=en");
    expect(paramsText(runs[0]!.params, ["model"])).toBe("model=q9");
  });

  it("offers screenshots and texts to show, and finds them in a cell", () => {
    expect(showOptions({ shotNames: ["home"], textNames: ["answer"] }).map((o) => o.value)).toEqual(["", "shot:home", "text:answer"]);
    const cell = {
      shots: [
        { name: "home", url: "/a", path: "a" },
        { name: "page 1", url: "/b", path: "b", set: "page" },
        { name: "page 2", url: "/c", path: "c", set: "page" },
      ],
    };
    expect(shotOf(cell, "home")?.url).toBe("/a");
    expect(shotOf(cell, "page")?.url).toBe("/b");
    expect(shotOf(cell, "nope")).toBeNull();
  });

  it("averages each run's scores and builds export links", () => {
    const cell = (score: number | null) => ({ score }) as never;
    expect(runScores({ runs: [{}, {}] as never, rows: [{ cells: [cell(4), null] }, { cells: [cell(2), cell(null)] }] as never })).toEqual([3, null]);
    expect(exportUrl("zip", ["aaaa0001", "bbbb0002"])).toBe("/api/v1/export.zip?runs=aaaa0001,bbbb0002");
  });
});

describe("rows that differ", () => {
  const cell = (status: "passed" | "failed", more: { score?: number | null; durationMs?: number | null; flags?: string[] } = {}) => ({
    status,
    score: more.score ?? null,
    durationMs: more.durationMs ?? 1000,
    flags: (more.flags ?? []).map((name) => ({ name, kind: "finding", detail: null })),
  });

  it("follows the Since the last run rule", () => {
    expect(cellsDiffer(cell("passed"), cell("passed"))).toBe(false);
    expect(cellsDiffer(cell("passed"), cell("failed"))).toBe(true);
    expect(cellsDiffer(cell("passed"), null)).toBe(true);
    expect(cellsDiffer(null, null)).toBe(false);
    expect(cellsDiffer(cell("passed", { flags: ["a", "b"] }), cell("passed", { flags: ["b", "a", "a"] }))).toBe(false);
    expect(cellsDiffer(cell("passed", { flags: ["a"] }), cell("passed"))).toBe(true);
    expect(cellsDiffer(cell("passed", { score: 3 }), cell("passed", { score: 3.4 }))).toBe(false);
    expect(cellsDiffer(cell("passed", { score: 3 }), cell("passed", { score: 3.5 }))).toBe(true);
    expect(cellsDiffer(cell("passed", { score: 3 }), cell("passed"))).toBe(false);
    expect(cellsDiffer(cell("passed", { durationMs: 1000 }), cell("passed", { durationMs: 2900 }))).toBe(false);
    expect(cellsDiffer(cell("passed", { durationMs: 4000 }), cell("passed", { durationMs: 6500 }))).toBe(true);
    expect(cellsDiffer(cell("passed", { durationMs: 10_000 }), cell("passed", { durationMs: 13_000 }))).toBe(false);
  });

  it("looks at every pair of runs", () => {
    expect(rowDiffers([cell("passed"), cell("passed"), cell("passed")])).toBe(false);
    expect(rowDiffers([cell("passed"), cell("passed"), cell("failed")])).toBe(true);
    expect(rowDiffers([cell("passed")])).toBe(false);
  });

  it("searches ids and titles, every word", () => {
    const row = { testId: "CAR3", title: "Cart keeps items" };
    expect(rowMatches(row, "")).toBe(true);
    expect(rowMatches(row, "car items")).toBe(true);
    expect(rowMatches(row, "car checkout")).toBe(false);
  });
});
