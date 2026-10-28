import { describe, expect, it } from "vitest";
import { findLines, levelCounts, levelOf, shownLines, splitHits, stepMatch, type LogLine } from "../src/logview";

const line = (n: number, level: LogLine["level"], message: string, test?: string): LogLine => ({ key: n, n, time: "2026-10-27T02:14:07.112Z", level, message, test });
const lines = [line(1, "info", "goto / → 200"), line(2, "warn", "slow response: POST /api/cart", "C1"), line(3, "error", "expect text failed: Timeout 30,000 ms"), line(4, "info", "timeout raised", "S1")];

describe("log view", () => {
  it("counts and filters by level", () => {
    expect(levelCounts(lines)).toEqual({ info: 2, warn: 1, error: 1 });
    expect(shownLines(lines, new Set(["warn", "error"])).map((l) => l.n)).toEqual([2, 3]);
    expect(shownLines(lines, new Set(["info", "warn", "error"]))).toHaveLength(4);
    expect(levelOf("debug")).toBe("info");
    expect(levelOf("error")).toBe("error");
  });

  it("finds a search in any case, in the message, test or level", () => {
    expect(findLines(lines, "TIMEOUT")).toEqual([2, 3]);
    expect(findLines(lines, "s1")).toEqual([3]);
    expect(findLines(lines, "warn")).toEqual([1]);
    expect(findLines(lines, "  ")).toEqual([]);
  });

  it("cuts a line into matching parts", () => {
    expect(splitHits("Timeout after timeout", "timeout")).toEqual([
      { text: "Timeout", hit: true },
      { text: " after ", hit: false },
      { text: "timeout", hit: true },
    ]);
    expect(splitHits("no match", "zzz")).toEqual([{ text: "no match", hit: false }]);
    expect(splitHits("", "")).toEqual([{ text: "", hit: false }]);
  });

  it("steps through matches and wraps around", () => {
    expect(stepMatch(3, -1, 1)).toBe(0);
    expect(stepMatch(3, -1, -1)).toBe(2);
    expect(stepMatch(3, 2, 1)).toBe(0);
    expect(stepMatch(3, 0, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
});
