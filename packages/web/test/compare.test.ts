import { describe, expect, it } from "vitest";
import { differingParams, exportUrl, paramsText, runIdsOf, runScores, shotOf, showOptions } from "../src/compare";

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
