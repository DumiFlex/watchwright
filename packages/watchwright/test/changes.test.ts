import { describe, expect, it } from "vitest";
import { changesOf, pickPrevious, runChanges, type ChangeSide } from "../src/plugins/reviews/changes.js";
import type { CompareCell, Comparison } from "../src/plugins/reviews/compare.js";

const side = (over: Partial<ChangeSide> = {}): ChangeSide => ({ runId: "r", attemptId: "a", status: "passed", durationMs: 4000, score: 4, flags: [], ...over });

describe("run changes", () => {
  it("names what moved", () => {
    expect(changesOf(side(), side())).toEqual([]);
    expect(changesOf(null, side())).toEqual(["new"]);
    expect(changesOf(side(), null)).toEqual(["gone"]);
    expect(changesOf(side(), side({ status: "failed", flags: ["slow"] }))).toEqual(["status", "flags"]);
    expect(changesOf(side(), side({ score: 3.6 }))).toEqual([]);
    expect(changesOf(side(), side({ score: 3.5 }))).toEqual(["score"]);
    expect(changesOf(side(), side({ score: null }))).toEqual([]);
    // Time: half again as long and at least 2 s apart, either way.
    expect(changesOf(side(), side({ durationMs: 5900 }))).toEqual([]);
    expect(changesOf(side(), side({ durationMs: 6000 }))).toEqual(["time"]);
    expect(changesOf(side({ durationMs: 1000 }), side({ durationMs: 2000 }))).toEqual([]);
    expect(changesOf(side({ durationMs: 9000 }), side({ durationMs: 4000 }))).toEqual(["time"]);
  });

  it("goes through a comparison of two runs", () => {
    const cell = (runId: string, status: string, flags: string[] = []): CompareCell => ({
      runId, attemptId: `${runId}-a`, status, durationMs: 1000, error: null, flags: flags.map((name) => ({ name, kind: "finding", detail: null, declared: true })),
      metrics: {}, notes: [], texts: {}, shots: [], files: [], reviews: [], score: null,
    });
    const run = (id: string) => ({ id, label: "", params: {}, info: {}, status: "finished" as const, startedBy: "api", createdAt: "", startedAt: null, counts: { passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, running: 0, interrupted: 0, planned: 0 } });
    const c: Comparison = {
      packId: "p", packName: "P", runs: [run("r1"), run("r2")], criteria: {}, shotNames: [], textNames: [],
      rows: [
        { testId: "A", title: "A", number: 1, cells: [cell("r1", "passed"), cell("r2", "passed")] },
        { testId: "B", title: "B", number: 1, cells: [cell("r1", "passed"), cell("r2", "failed", ["slow", "slow"])] },
        { testId: "C", title: "C", number: 1, cells: [null, cell("r2", "passed")] },
      ],
    };
    const out = runChanges(c);
    expect(out.previous?.id).toBe("r1");
    expect(out.same).toBe(1);
    expect(out.rows.map((r) => [r.testId, r.changes])).toEqual([["B", ["status", "flags"]], ["C", ["new"]]]);
    expect(out.rows[0]!.after?.flags).toEqual(["slow"]);
  });
});

describe("the run to compare with", () => {
  const r = (id: string, tests: string[] = [], params: Record<string, unknown> = {}) => ({ id, params, tests });
  it("prefers the newest earlier run with the same tests", () => {
    expect(pickPrevious(r("now"), [r("quick", ["A1", "B2"]), r("full"), r("older")])).toBe("full");
    expect(pickPrevious(r("now", ["B2", "A1"]), [r("full"), r("quick", ["A1", "B2"])])).toBe("quick");
  });
  it("falls back to the newest run with the same params", () => {
    expect(pickPrevious(r("now"), [r("quick", ["A1"]), r("other", [], { model: "b" })])).toBe("quick");
  });
  it("needs the same params and never picks the run itself", () => {
    expect(pickPrevious(r("now", [], { model: "a" }), [r("now", [], { model: "a" }), r("x", [], { model: "b" })])).toBeUndefined();
  });
});
