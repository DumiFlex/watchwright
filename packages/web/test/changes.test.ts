import { describe, expect, it } from "vitest";
import { splitChanges } from "../src/changes";

describe("since the last run", () => {
  it("lists moved attempts and counts the ones only one run has", () => {
    const rows = [{ id: 1, changes: ["new"] }, { id: 2, changes: ["status", "time"] }, { id: 3, changes: ["gone"] }, { id: 4, changes: ["new"] }, { id: 5, changes: ["flags"] }];
    const s = splitChanges(rows);
    expect(s.moved.map((r) => r.id)).toEqual([2, 5]);
    expect(s.added).toBe(2);
    expect(s.gone).toBe(1);
  });
  it("is empty for no rows", () => {
    expect(splitChanges([])).toEqual({ moved: [], added: 0, gone: 0 });
  });
});
