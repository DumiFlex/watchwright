import { describe, expect, it } from "vitest";
import { checkTests } from "../src/plugins/packs/order.js";
import { rubricFor, rubricProblems, scoreProblem } from "../src/plugins/packs/rubric.js";

const rubric = [
  { id: "correct", title: "Correct", scale: 5 },
  { id: "ui", title: "UI problems", choices: ["none", "minor", "major"] },
  { id: "usable", title: "Would use it", yesNo: true },
] as const;

describe("rubrics", () => {
  it("gives every test the default overall criterion when the pack has none", () => {
    expect(rubricFor(undefined, undefined)).toEqual([{ id: "overall", title: "Overall", description: null, kind: "scale", scale: 5 }]);
  });
  it("works out each criterion's kind, and lets a test drop and add", () => {
    const own = rubricFor(rubric, { drop: ["ui"], add: [{ id: "tone", title: "Tone", scale: 3 }] });
    expect(own.map((c) => [c.id, c.kind])).toEqual([
      ["correct", "scale"],
      ["usable", "yesNo"],
      ["tone", "scale"],
    ]);
    expect(rubricFor(rubric, undefined)[1]).toMatchObject({ kind: "choices", choices: ["none", "minor", "major"] });
  });
  it("finds mistakes in a rubric", () => {
    expect(rubricProblems(undefined, "rubric")).toEqual([]);
    expect(rubricProblems(rubric, "rubric")).toEqual([]);
    const bad = rubricProblems(
      [{ id: "a b", title: "" }, { id: "x", title: "X", scale: 1 }, { id: "x", title: "Again", choices: ["one"] }, { id: "y", title: "Y", scale: 3, yesNo: true }],
      "rubric",
    );
    expect(bad.join("\n")).toMatch(/entry 1 needs an `id`/);
    expect(bad.join("\n")).toMatch(/entry 1 needs a `title`/);
    expect(bad.join("\n")).toMatch(/`scale` must be a whole number from 2 to 10/);
    expect(bad.join("\n")).toMatch(/"x" is used twice/);
    expect(bad.join("\n")).toMatch(/two or more different names/);
    expect(bad.join("\n")).toMatch(/not more than one/);
    expect(rubricProblems("nope", "rubric")).toEqual(["`rubric` must be a list of criteria."]);
  });
  it("checks scores against the criteria", () => {
    const criteria = rubricFor(rubric, undefined);
    expect(scoreProblem(criteria, { correct: 4, ui: "minor", usable: false })).toBeNull();
    expect(scoreProblem(criteria, { correct: null })).toBeNull();
    expect(scoreProblem(criteria, { correct: 6 })).toMatch(/1 to 5/);
    expect(scoreProblem(criteria, { correct: 2.5 })).toMatch(/1 to 5/);
    expect(scoreProblem(criteria, { correct: "4" })).toMatch(/1 to 5/);
    expect(scoreProblem(criteria, { ui: "awful" })).toMatch(/none, minor, major/);
    expect(scoreProblem(criteria, { usable: 1 })).toMatch(/true or false/);
    expect(scoreProblem(criteria, { speed: 3 })).toMatch(/isn't a criterion/);
  });
  it("checks tests' review changes against the pack's rubric", () => {
    const test = (id: string, review: object) => ({ id, meta: { review }, body: async () => {}, file: "t.ts" }) as never;
    expect(checkTests([test("A", { drop: ["ui"] })], rubric)).toEqual([]);
    expect(checkTests([test("A", { drop: ["speed"] })], rubric)).toEqual(['Test A drops the criterion "speed", which the pack\'s rubric doesn\'t have.']);
    expect(checkTests([test("A", { drop: ["overall"] })])).toEqual([]);
    expect(checkTests([test("A", { add: [{ id: "t" }] })], rubric)[0]).toMatch(/test A review.add` entry 1 needs a `title`/);
  });
});
