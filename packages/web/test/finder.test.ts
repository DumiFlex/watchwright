import { describe, expect, it, vi } from "vitest";
import type { Pack, RunSummary } from "../src/api";
import { finderCommands, runLine } from "../src/finder";

const pack = {
  id: "27b779ce",
  name: "Shop smoke",
  dir: "/sites/shop/watchwright",
  siteKey: "shop",
  status: "ok",
  tests: [{ id: "S1", title: "Checkout", section: "Cart", tags: ["smoke"], file: "tests/cart.ts" }],
} as unknown as Pack;
const counts = { passed: 1, failed: 0, broken: 0, skipped: 0, stopped: 0, running: 0, interrupted: 0, planned: 1 };
const run = (id: string, status: RunSummary["status"], label = "") =>
  ({ id, label, packId: pack.id, packName: "Shop smoke", status, params: { lang: "de" }, createdAt: "2026-10-27T11:00:00Z", counts }) as unknown as RunSummary;

describe("Ctrl+K finder", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");

  it("names a run by its label, or its id when it has none", () => {
    expect(runLine(run("3011fc76", "finished"))).toBe("Shop smoke 3011fc76");
    expect(runLine(run("3011fc76", "finished", "nightly"))).toBe("Shop smoke: nightly");
  });

  it("lists packs, tests and runs for a search only, and the commands always", () => {
    const go = vi.fn();
    const again = vi.fn();
    const cmds = finderCommands([pack], [run("aaaaaaaa", "running"), run("3011fc76", "finished", "nightly")], { go, again }, now);
    expect(cmds.filter((c) => !c.searchOnly).map((c) => c.id)).toEqual(["again-latest", "add-pack", "find-packs"]);
    const latest = cmds.find((c) => c.id === "again-latest")!;
    expect(latest.note).toBe("Shop smoke: nightly");
    latest.run();
    expect(again).toHaveBeenCalledWith("3011fc76");

    const test = cmds.find((c) => c.id === "test-27b779ce-S1")!;
    expect(test.label).toBe("S1 Checkout");
    test.run();
    expect(go).toHaveBeenLastCalledWith("#/new?pack=27b779ce&test=S1");

    const r = cmds.find((c) => c.id === "run-3011fc76")!;
    expect(r.note).toBe("finished · 1 h ago");
    expect(r.words).toContain("lang=de");
    expect(cmds.find((c) => c.id === "new-27b779ce")?.label).toBe("New run: Shop smoke");
  });

  it("offers no run again while every run is still going", () => {
    expect(finderCommands([], [run("aaaaaaaa", "running")], { go: vi.fn(), again: vi.fn() }).some((c) => c.id === "again-latest")).toBe(false);
  });
});
