import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { jumps, markAmong, outlineTops, railPlace, type OutlineItem } from "../src/outline";

describe("railPlace", () => {
  it("puts the outline in the right margin when it fits", () => {
    expect(railPlace(1920, 1550)).toEqual({ left: 1566, width: 240 });
  });
  it("narrows it to the margin left", () => {
    expect(railPlace(1500, 1290)).toBeNull();
    expect(railPlace(1520, 1290)).toEqual({ left: 1306, width: 198 });
  });
  it("leaves it out without room", () => {
    expect(railPlace(1440, 1310)).toBeNull();
    expect(railPlace(390, 390)).toBeNull();
  });
});

describe("jumps", () => {
  it("offers nothing on a page that fits, or nearly", () => {
    expect(jumps(0, 900, 900)).toEqual({ long: false, up: false, down: false });
    expect(jumps(0, 900, 1300)).toEqual({ long: false, up: false, down: false });
  });
  it("offers the way down at the top of a long page, both in the middle, the way up at the bottom", () => {
    expect(jumps(0, 900, 4000)).toEqual({ long: true, up: false, down: true });
    expect(jumps(1500, 900, 4000)).toEqual({ long: true, up: true, down: true });
    expect(jumps(3100, 900, 4000)).toEqual({ long: true, up: true, down: false });
  });
});

describe("outlineTops and markAmong", () => {
  // The attempt page: cards, then the tabs of one card, which share its element.
  const tab = { value: "log" };
  const items: OutlineItem[] = [
    { id: "steps", label: "Steps" },
    ...["shots", "log", "files"].map((t) => ({ id: "saved", label: t, on: () => tab.value === t })),
    { id: "review", label: "Review" },
  ];
  const at: Record<string, number> = { steps: -400, saved: 50, review: 900 };
  it("reads a shared element once, through its first item", () => {
    expect(outlineTops(items, (id) => at[id] ?? null)).toEqual([-400, 50, null, null, 900]);
  });
  it("marks the tab that is showing among the items of one card", () => {
    expect(markAmong(items, 1)).toBe(2);
    tab.value = "files";
    expect(markAmong(items, 1)).toBe(3);
    expect(markAmong(items, 0)).toBe(0);
    expect(markAmong(items, 4)).toBe(4);
  });
});

describe("dropdowns keep the page still", () => {
  // scrollIntoView scrolls the page as well as the list, and a bare focus() scrolls to what it
  // focuses: either moved the page when a dropdown opened or closed (Firefox does it even for
  // fixed popups). Popups scroll their own list with revealInList and focus with focusStill.
  it.each(["SelectMenu", "MultiSelect", "MenuButton", "CommandPalette", "FolderBrowser", "DatePicker", "DateRangePicker", "ThemePicker", "PageOutline"])("%s", async (name) => {
    const text = await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), "utf8");
    expect(text).not.toMatch(/scrollIntoView\(/);
    expect(text).not.toMatch(/(button|list|menu)\.value\?\.focus\(\)/);
  });
});
