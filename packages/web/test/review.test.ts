import { describe, expect, it } from "vitest";
import type { Criterion } from "../src/api";
import { attemptScore, mean, onFive, resultRows, scoreText } from "../src/review";

const correct: Criterion = { id: "correct", title: "Correct", description: null, kind: "scale", scale: 5 };
const tone: Criterion = { id: "tone", title: "Tone", description: null, kind: "scale", scale: 3 };
const ui: Criterion = { id: "ui", title: "UI", description: null, kind: "choices", choices: ["none", "minor"] };
const usable: Criterion = { id: "usable", title: "Usable", description: null, kind: "yesNo" };

describe("review helpers", () => {
  it("writes scores", () => {
    expect(scoreText(correct, 4)).toBe("4 / 5");
    expect(scoreText(ui, "minor")).toBe("minor");
    expect(scoreText(usable, false)).toBe("no");
    expect(scoreText(correct, undefined)).toBe("–");
  });
  it("puts scales on 1 to 5 and averages over reviewers", () => {
    expect(onFive(1, 3)).toBe(1);
    expect(onFive(2, 3)).toBe(3);
    expect(onFive(3, 3)).toBe(5);
    expect(attemptScore([correct, tone, ui], [{ scores: { correct: 4, tone: 3, ui: "none" } }, { scores: { correct: 2 } }])).toBeCloseTo((4 + 5 + 2) / 3);
    expect(attemptScore([correct, usable], [{ scores: { usable: true } }])).toBeNull();
    expect(attemptScore([correct], [])).toBeNull();
  });
  it("averages what's there", () => {
    expect(mean([4, null, 2])).toBe(3);
    expect(mean([null])).toBeNull();
  });
  it("lays out a run as tests × attempts with children after their parent", () => {
    const att = (id: string, testId: string, number: number, status: string, parentId: string | null = null, flags = 0) => ({
      id,
      testId,
      title: testId,
      number,
      of: 2,
      try: 1,
      parentId,
      status,
      flags: Array.from({ length: flags }, () => ({ name: "f", kind: "finding", detail: null })),
      error: null,
      startedAt: "",
      finishedAt: null,
      durationMs: null,
    });
    const run = {
      plan: [
        { testId: "A", title: "First", number: 1, of: 2, status: "passed", attemptId: "a1" },
        { testId: "A", title: "First", number: 2, of: 2, status: "failed", attemptId: "a2" },
        { testId: "P", title: "Parent", number: 1, of: 1, status: "passed", attemptId: "p1" },
      ],
      attempts: [att("a1", "A", 1, "passed"), att("a2", "A", 2, "failed", null, 2), att("p1", "P", 1, "passed"), att("k1", "K", 1, "passed", "p1")],
    };
    const review = (attemptId: string, scores: Record<string, number>) => ({ runId: "r", packId: "p", attemptId, testId: "", reviewer: "web", scores, note: "", createdAt: "", updatedAt: "" });
    const rows = resultRows(run as never, [review("a1", { correct: 5 }), review("a2", { correct: 3 })], { A: [correct] });
    expect(rows.map((r) => [r.testId, r.parent, Object.keys(r.cells)])).toEqual([
      ["A", null, ["1", "2"]],
      ["P", null, ["1"]],
      ["K", "P", ["1"]],
    ]);
    expect(rows[0]!.cells[2]).toMatchObject({ status: "failed", flags: 2, score: 3, reviewed: true });
    expect(rows[0]!.score).toBe(4);
    expect(rows[1]!.score).toBeNull();
  });
});
