import { describe, expect, it } from "vitest";
import { href, parseRoute, sectionOf, type Route } from "../src/router";

describe("router", () => {
  it("parses every route", () => {
    expect(parseRoute("")).toEqual({ name: "runs", query: {} });
    expect(parseRoute("#/")).toEqual({ name: "runs", query: {} });
    expect(parseRoute("#/?pack=0a1b2c3d&status=finished")).toEqual({ name: "runs", query: { pack: "0a1b2c3d", status: "finished" } });
    expect(parseRoute("#/new?pack=0a1b2c3d")).toEqual({ name: "new", query: { pack: "0a1b2c3d" } });
    expect(parseRoute("#/runs/0a1b2c3d")).toEqual({ name: "run", id: "0a1b2c3d" });
    expect(parseRoute("#/runs/0a1b2c3d/attempts/0a1b2c3d4e5f")).toEqual({ name: "attempt", runId: "0a1b2c3d", attemptId: "0a1b2c3d4e5f" });
    expect(parseRoute("#/runs/0a1b2c3d/attempts/xyz").name).toBe("runs");
    expect(parseRoute("#/runs/0a1b2c3d/attempts/0a1b2c3d4e5f?line=12")).toEqual({ name: "attempt", runId: "0a1b2c3d", attemptId: "0a1b2c3d4e5f", line: 12 });
    expect(parseRoute("#/runs/0a1b2c3d/attempts/0a1b2c3d4e5f?line=x")).toEqual({ name: "attempt", runId: "0a1b2c3d", attemptId: "0a1b2c3d4e5f" });
    expect(parseRoute("#/packs")).toEqual({ name: "packs", query: {} });
    expect(parseRoute("#/packs/0a1b2c3d")).toEqual({ name: "pack", id: "0a1b2c3d" });
    expect(parseRoute("#/packs/0a1b2c3d/edit")).toEqual({ name: "edit", id: "0a1b2c3d", file: null, line: null });
    expect(parseRoute("#/packs/0a1b2c3d/edit/tests/my%20file.yaml?line=12")).toEqual({ name: "edit", id: "0a1b2c3d", file: "tests/my file.yaml", line: 12 });
    expect(parseRoute("#/kit")).toEqual({ name: "kit" });
    expect(parseRoute("#/settings")).toEqual({ name: "settings" });
    expect(parseRoute("#/compare?runs=0a1b2c3d,1a1b2c3d")).toEqual({ name: "compare", query: { runs: "0a1b2c3d,1a1b2c3d" } });
  });

  it("shows the runs list for unknown or malformed addresses", () => {
    expect(parseRoute("#/runs/nope")).toEqual({ name: "runs", query: {} });
    expect(parseRoute("#/nowhere?pack=x")).toEqual({ name: "runs", query: {} });
    expect(parseRoute("#/?pack=")).toEqual({ name: "runs", query: {} });
  });

  it("builds the address back from a route", () => {
    const routes: Route[] = [
      { name: "runs", query: {} },
      { name: "runs", query: { pack: "0a1b2c3d", status: "finished,stopped" } },
      { name: "new", query: { pack: "0a1b2c3d" } },
      { name: "run", id: "0a1b2c3d" },
      { name: "attempt", runId: "0a1b2c3d", attemptId: "0a1b2c3d4e5f" },
      { name: "attempt", runId: "0a1b2c3d", attemptId: "0a1b2c3d4e5f", line: 7 },
      { name: "packs", query: {} },
      { name: "packs", query: { browse: "find" } },
      { name: "pack", id: "0a1b2c3d" },
      { name: "edit", id: "0a1b2c3d", file: null, line: null },
      { name: "edit", id: "0a1b2c3d", file: "tests/a b#.yaml", line: 4 },
      { name: "edit", id: "0a1b2c3d", file: "tests/new.yaml", line: 4, record: true },
      { name: "compare", query: { runs: "0a1b2c3d", show: "shot:home" } },
      { name: "kit" },
      { name: "settings" },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
    expect(href({ name: "runs", query: { pack: "" } })).toBe("#/");
  });

  it("knows which section a route is in", () => {
    expect(sectionOf({ name: "run", id: "0a1b2c3d" })).toBe("runs");
    expect(sectionOf({ name: "attempt", runId: "0a1b2c3d", attemptId: "0a1b2c3d4e5f" })).toBe("runs");
    expect(sectionOf({ name: "pack", id: "0a1b2c3d" })).toBe("packs");
    expect(sectionOf({ name: "compare", query: {} })).toBe("compare");
    expect(sectionOf({ name: "kit" })).toBeNull();
    expect(sectionOf({ name: "settings" })).toBeNull();
  });
});
