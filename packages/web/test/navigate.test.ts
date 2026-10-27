import { describe, expect, it } from "vitest";
import { fuzzy, markHits } from "../src/fuzzy";
import { keyParts, matches } from "../src/keys";

const ev = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("keyParts", () => {
  it("splits on plus", () => {
    expect(keyParts("Mod+Shift+P")).toEqual(["Mod", "Shift", "P"]);
    expect(keyParts("Escape")).toEqual(["Escape"]);
  });
  it("keeps the plus key", () => {
    expect(keyParts("Shift++")).toEqual(["Shift", "+"]);
  });
});

describe("matches", () => {
  it("reads Mod as Ctrl off a Mac and Cmd on one", () => {
    expect(matches(ev("k", { ctrlKey: true }), "Mod+K", false)).toBe(true);
    expect(matches(ev("k", { metaKey: true }), "Mod+K", false)).toBe(false);
    expect(matches(ev("k", { metaKey: true }), "Mod+K", true)).toBe(true);
    expect(matches(ev(" "), "Space", false)).toBe(true);
    expect(matches(ev("S", { shiftKey: true }), "Shift+S", false)).toBe(true);
    expect(matches(ev("s"), "Shift+S", false)).toBe(false);
    expect(matches(ev("k", { ctrlKey: true }), "Mod+K", true)).toBe(false);
  });
  it("ignores letter case but not extra modifiers", () => {
    expect(matches(ev("K", { ctrlKey: true, shiftKey: true }), "Mod+K", false)).toBe(false);
    expect(matches(ev("K", { ctrlKey: true, shiftKey: true }), "Mod+Shift+K", false)).toBe(true);
    expect(matches(ev("k", { ctrlKey: true, altKey: true }), "Mod+K", false)).toBe(false);
  });
  it("lets shift type symbols", () => {
    expect(matches(ev("?", { shiftKey: true }), "?", false)).toBe(true);
    expect(matches(ev("?", { shiftKey: true }), "Shift+?", false)).toBe(true);
  });
  it("matches named keys", () => {
    expect(matches(ev("Escape"), "Escape", false)).toBe(true);
    expect(matches(ev("Enter", { ctrlKey: true }), "Mod+Enter", false)).toBe(true);
    expect(matches(ev("Enter"), "Mod+Enter", false)).toBe(false);
  });
});

describe("fuzzy", () => {
  it("matches everything with an empty query", () => {
    expect(fuzzy("", "Anything")).toEqual({ score: 0, hits: [] });
  });
  it("finds letters in order", () => {
    expect(fuzzy("nr", "New run")?.hits).toEqual([0, 4]);
    expect(fuzzy("nw", "Run")).toBeNull();
    expect(fuzzy("xyz", "New run")).toBeNull();
  });
  it("ranks a substring above scattered letters, and word starts above the middle", () => {
    const sub = fuzzy("run", "Go to runs")!;
    const scattered = fuzzy("run", "Reset unused nodes")!;
    expect(sub.score).toBeGreaterThan(scattered.score);
    expect(fuzzy("run", "Runs")!.score).toBeGreaterThan(fuzzy("run", "Prune")!.score);
  });
  it("prefers word starts for initials", () => {
    expect(fuzzy("hc", "Look: High contrast")?.hits).toEqual([6, 11]);
  });
  it("ignores case", () => {
    expect(fuzzy("PACKS", "Go to packs")?.hits).toEqual([6, 7, 8, 9, 10]);
  });
});

describe("markHits", () => {
  it("groups runs of hits", () => {
    expect(markHits("New run", [0, 4])).toEqual([
      { text: "N", hit: true },
      { text: "ew ", hit: false },
      { text: "r", hit: true },
      { text: "un", hit: false },
    ]);
  });
});
