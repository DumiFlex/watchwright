import { describe, expect, it } from "vitest";
import { addDays, addMonths, compareDays, monthGrid, parseDay, toIso, weekday } from "../src/calendar";

describe("calendar", () => {
  it("parses and prints days, rejecting impossible ones", () => {
    expect(parseDay("2026-10-27")).toEqual({ y: 2026, m: 10, d: 27 });
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("27.10.2026")).toBeNull();
    expect(parseDay("")).toBeNull();
    expect(toIso({ y: 2026, m: 3, d: 5 })).toBe("2026-03-05");
  });

  it("moves by days across months and years", () => {
    expect(toIso(addDays({ y: 2026, m: 12, d: 31 }, 1))).toBe("2027-01-01");
    expect(toIso(addDays({ y: 2026, m: 3, d: 1 }, -1))).toBe("2026-02-28");
  });

  it("moves by months and clamps the day", () => {
    expect(toIso(addMonths({ y: 2026, m: 1, d: 31 }, 1))).toBe("2026-02-28");
    expect(toIso(addMonths({ y: 2024, m: 1, d: 31 }, 1))).toBe("2024-02-29");
    expect(toIso(addMonths({ y: 2026, m: 1, d: 15 }, -1))).toBe("2025-12-15");
    expect(toIso(addMonths({ y: 2026, m: 5, d: 10 }, 12))).toBe("2027-05-10");
  });

  it("lays out six Monday-first weeks", () => {
    const g = monthGrid({ y: 2026, m: 10, d: 27 });
    expect(g).toHaveLength(42);
    expect(toIso(g[0]!)).toBe("2026-09-28"); // Oct 1 2026 is a Thursday
    expect(g.every((d) => weekday(d) === g.indexOf(d) % 7)).toBe(true);
    expect(g.some((d) => toIso(d) === "2026-10-31")).toBe(true);
  });

  it("compares days", () => {
    expect(compareDays({ y: 2026, m: 1, d: 2 }, { y: 2026, m: 1, d: 10 })).toBeLessThan(0);
    expect(compareDays({ y: 2027, m: 1, d: 1 }, { y: 2026, m: 12, d: 31 })).toBeGreaterThan(0);
    expect(compareDays({ y: 2026, m: 5, d: 5 }, { y: 2026, m: 5, d: 5 })).toBe(0);
  });
});
