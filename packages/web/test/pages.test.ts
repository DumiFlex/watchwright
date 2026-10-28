import { describe, expect, it } from "vitest";
import type { HealthPage } from "../src/api";
import { CircleDot, FolderOpen } from "../src/icons";
import { DEFAULT_PAGES, hasPage, navFrom, pageIcon, pageOf } from "../src/pages";

const notes: HealthPage = { plugin: "notes", name: "notes", title: "Notes", path: "/notes", icon: "FileText", menu: "main", order: 25 };

describe("pages from plugins", () => {
  it("builds the menu in the server's order and marks the page the route is on", () => {
    const nav = navFrom(DEFAULT_PAGES, { name: "pack", id: "0a1b2c3d" });
    expect(nav.map((n) => n.label)).toEqual(["Runs", "Packs", "Compare", "New run", "Settings"]);
    expect(nav.filter((n) => n.main).map((n) => n.href)).toEqual(["#/", "#/packs", "#/compare"]);
    expect(nav.find((n) => n.current)?.value).toBe("packs");
    expect(navFrom(DEFAULT_PAGES, { name: "new", query: {} }).find((n) => n.current)?.value).toBe("new-run");
  });

  it("knows which page each route belongs to", () => {
    expect(pageOf({ name: "attempt", runId: "0a1b2c3d", attemptId: "0a1b2c3d4e5f" })).toBe("runs");
    expect(pageOf({ name: "edit", id: "0a1b2c3d", file: null, line: null })).toBe("packs");
    expect(pageOf({ name: "kit" })).toBeNull();
  });

  it("opens a page only when the server has its plugin", () => {
    const noCompare = DEFAULT_PAGES.filter((p) => p.name !== "compare");
    expect(hasPage(noCompare, { name: "compare", query: {} })).toBe(false);
    expect(hasPage(noCompare, { name: "runs", query: {} })).toBe(true);
    expect(hasPage([], { name: "kit" })).toBe(true);
    expect(navFrom([...DEFAULT_PAGES, notes].sort((a, b) => a.order - b.order), { name: "runs", query: {} }).map((n) => n.value)).toEqual(["runs", "packs", "notes", "compare", "new-run", "settings"]);
  });

  it("finds a page's icon by its Lucide name, with a dot for unknown names", () => {
    expect(pageIcon("FolderOpen")).toBe(FolderOpen);
    expect(pageIcon("NoSuchIcon")).toBe(CircleDot);
  });
});
