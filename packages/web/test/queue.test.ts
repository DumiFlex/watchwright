import { describe, expect, it } from "vitest";
import { canMove, followTop, movable, rowInView } from "../src/queue";

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

describe("following the running row", () => {
  const box = { scrollTop: 0, height: 300 };
  it("leaves a row that shows alone", () => {
    expect(rowInView(box, { top: 100, height: 30 })).toBe(true);
    expect(followTop(box, { top: 100, height: 30 })).toBeNull();
  });
  it("scrolls a row below the box to a third of the way down", () => {
    expect(rowInView(box, { top: 800, height: 30 })).toBe(false);
    expect(followTop(box, { top: 800, height: 30 })).toBe(700);
  });
  it("scrolls back up to a row above the box, never past the top", () => {
    expect(followTop({ scrollTop: 900, height: 300 }, { top: 40, height: 30 })).toBe(0);
  });
  it("counts a row cut by the box's edge as hidden", () => {
    expect(rowInView(box, { top: 290, height: 30 })).toBe(false);
  });
});
