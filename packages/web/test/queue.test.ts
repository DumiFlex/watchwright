import { describe, expect, it } from "vitest";
import { canMove, movable } from "../src/queue";

const plan = [
  { testId: "A", status: "passed" },
  { testId: "B", status: "running" },
  { testId: "C", status: "pending" },
  { testId: "C", status: "pending" },
  { testId: "D", status: "pending" },
];

describe("queue rows", () => {
  it("puts move buttons on the first row of a test that hasn't started", () => {
    expect(plan.map((_, i) => movable(plan, i))).toEqual([false, false, true, false, true]);
  });
  it("keeps a test whose attempts have begun in place", () => {
    const begun = [{ testId: "C", status: "passed" }, { testId: "C", status: "pending" }];
    expect(movable(begun, 0)).toBe(false);
  });
  it("moves only past a test that hasn't started", () => {
    expect(canMove(plan, 2, -1)).toBe(false);
    expect(canMove(plan, 2, 1)).toBe(true);
    expect(canMove(plan, 4, -1)).toBe(true);
    expect(canMove(plan, 4, 1)).toBe(false);
  });
});
