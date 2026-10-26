import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, LOOKS, applyTheme, loadTheme, saveTheme } from "../src/theme";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwingStore = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
};

describe("theme", () => {
  it("starts on Movement, following the system's light or dark", () => {
    expect(loadTheme(memoryStore())).toEqual({ look: "movement", mode: "system" });
    expect(loadTheme(null)).toEqual(DEFAULT_THEME);
  });

  it("round-trips a saved theme", () => {
    const store = memoryStore();
    saveTheme(store, { look: "onair", mode: "dark" });
    expect(loadTheme(store)).toEqual({ look: "onair", mode: "dark" });
  });

  it("falls back per field on unknown or broken values", () => {
    expect(loadTheme(memoryStore({ "watchwright.theme": '{"look":"neon","mode":"light"}' }))).toEqual({ look: "movement", mode: "light" });
    expect(loadTheme(memoryStore({ "watchwright.theme": "not json" }))).toEqual(DEFAULT_THEME);
  });

  it("survives storage that throws", () => {
    expect(loadTheme(throwingStore)).toEqual(DEFAULT_THEME);
    expect(() => saveTheme(throwingStore, { look: "drafting", mode: "light" })).not.toThrow();
  });

  it("sets data-look always and data-mode only when not following the system", () => {
    const root = { dataset: {} as DOMStringMap };
    applyTheme(root, { look: "drafting", mode: "dark" });
    expect(root.dataset).toEqual({ look: "drafting", mode: "dark" });
    applyTheme(root, { look: "movement", mode: "system" });
    expect(root.dataset).toEqual({ look: "movement" });
  });

  it("has a style block for every look", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
    for (const look of LOOKS) expect(css).toContain(`[data-look="${look.id}"]`);
  });
});
