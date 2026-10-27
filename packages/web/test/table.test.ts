import { describe, expect, it } from "vitest";
import { compareValues, nextSort, rowWindow, sortRows } from "../src/table";

describe("table helpers", () => {
  it("compares numbers by value and text with numeric parts", () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues("S2", "S10")).toBeLessThan(0);
    expect(compareValues("apple", "Banana")).toBeLessThan(0);
    expect(compareValues(false, true)).toBeLessThan(0);
  });

  it("sorts stably and keeps empty values last in both directions", () => {
    const rows = [
      { id: "a", n: 3 },
      { id: "b", n: null },
      { id: "c", n: 1 },
      { id: "d", n: 3 },
    ];
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.id)).toEqual(["a", "d", "c", "b"]);
  });

  it("cycles a column through ascending, descending and none", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toBeNull();
    expect(nextSort({ key: "name", dir: "desc" }, "date")).toEqual({ key: "date", dir: "asc" });
  });

  it("renders only the rows on screen plus overscan", () => {
    expect(rowWindow(0, 360, 36, 1000, 5)).toEqual({ start: 0, end: 15, padTop: 0, padBottom: 985 * 36 });
    const mid = rowWindow(3600, 360, 36, 1000, 5);
    expect(mid).toEqual({ start: 95, end: 115, padTop: 95 * 36, padBottom: 885 * 36 });
    expect(rowWindow(36000, 360, 36, 1000, 5)).toMatchObject({ end: 1000, padBottom: 0 });
    expect(rowWindow(0, 360, 36, 0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});
