import { expect, it } from "vitest";
import { sectionAt } from "../src/toc";

it("marks the last section whose top passed the line", () => {
  expect(sectionAt([100, 600, 1200], 80, false)).toBe(0);
  expect(sectionAt([-500, 40, 700], 80, false)).toBe(1);
  expect(sectionAt([-900, -300, 60], 80, false)).toBe(2);
  expect(sectionAt([-900, null, 60], 80, false)).toBe(2);
});

it("marks the last section at the bottom of the page", () => {
  expect(sectionAt([-900, -300, 400], 80, true)).toBe(2);
  expect(sectionAt([], 80, true)).toBe(0);
});
