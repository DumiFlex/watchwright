import { describe, expect, it } from "vitest";
import { QueueError, RunQueue } from "../src/plugins/runs/queue.js";

// A plan: A, B (needs A, two attempts), P (runs child K, which needs B), C.
const plan = {
  items: [
    { itemId: "A", number: 1, of: 1 },
    { itemId: "B", number: 1, of: 2 },
    { itemId: "B", number: 2, of: 2 },
    { itemId: "P", number: 1, of: 1 },
    { itemId: "C", number: 1, of: 1 },
  ],
  needs: new Map([
    ["B", ["A"]],
    ["K", ["B"]],
  ]),
  children: new Map([["P", ["K"]]]),
};
const order = (q: RunQueue) => q.items.map((i) => `${i.itemId}#${i.number}`);

describe("run queue", () => {
  it("moves a test past its neighbour when needs allow", () => {
    const q = new RunQueue(plan);
    q.move("C", "up");
    expect(q.tests()).toEqual(["A", "B", "C", "P"]);
    q.move("C", "up");
    expect(order(q)).toEqual(["A#1", "C#1", "B#1", "B#2", "P#1"]);
  });

  it("refuses a move that puts a test before what it (or its child) needs", () => {
    const q = new RunQueue(plan);
    expect(() => q.move("B", "up")).toThrow(/B needs A/);
    expect(() => q.move("P", "up")).toThrow(/K needs B, so P can't run before it/);
    expect(() => q.move("A", "up")).toThrow(QueueError);
    expect(() => q.move("C", "down")).toThrow(/bottom/);
  });

  it("adds a larger plan's new attempts at the end and keeps its own order", () => {
    const q = new RunQueue(plan);
    q.move("C", "up");
    const added = q.extend({ ...plan, items: [{ itemId: "D", number: 1, of: 1 }, ...plan.items] });
    expect(added.map((i) => i.itemId)).toEqual(["D"]);
    expect(q.tests()).toEqual(["A", "B", "C", "P", "D"]);
    expect(q.edits().order).toEqual(["A", "B", "C", "P", "D"]);
  });

  it("refuses to touch what has started", () => {
    const q = new RunQueue(plan);
    const a = q.next()!;
    q.started(a);
    expect(() => q.skip("A", 1, true)).toThrow(/already started/);
    q.finish(a);
    q.started(q.next()!); // B#1
    expect(() => q.move("P", "up")).toThrow(/B has already started/);
    q.skip("B", 2, true);
    expect(q.isSkipped({ itemId: "B", number: 2, of: 2 })).toBe(true);
    q.skip("B", 2, false);
    expect(q.skipped()).toEqual([]);
  });

  it("keeps edits across a restart", () => {
    const q = new RunQueue(plan);
    q.move("C", "up");
    q.skip("C", 1, true);
    const again = new RunQueue(plan, q.edits());
    expect(again.tests()).toEqual(["A", "B", "C", "P"]);
    expect(again.skipped()).toEqual(["C#1"]);
    // An order that no longer fits (the pack changed) falls back to the plan's order.
    expect(new RunQueue(plan, { order: ["B", "A"] }).tests()).toEqual(["A", "B", "P", "C"]);
  });

  it("walks attempts in order until each is finished", () => {
    const q = new RunQueue(plan);
    const seen: string[] = [];
    for (let i = q.next(); i; i = q.next()) {
      seen.push(`${i.itemId}#${i.number}`);
      q.finish(i);
    }
    expect(seen).toEqual(["A#1", "B#1", "B#2", "P#1", "C#1"]);
  });
});
