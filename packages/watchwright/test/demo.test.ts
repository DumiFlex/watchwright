import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoSource, placeDemoPack, startDemoRun } from "../src/cli/demo.js";
import type { ApiCall, PackReply } from "../src/cli/serve.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

afterEach(cleanTempDirs);

const okPack: PackReply = { data: { id: "0a1b2c3d", name: "TodoMVC demo", path: "/x/pack.yaml", status: "ok", error: null } };

describe("watchwright demo", () => {
  it("finds the TodoMVC pack", () => {
    const source = demoSource();
    expect(source).not.toBeNull();
    expect(readFileSync(path.join(source!, "pack.yaml"), "utf8")).toContain("name: TodoMVC demo");
  });

  it("copies the pack into the data folder once and keeps later changes", () => {
    const data = tempDir();
    const dir = placeDemoPack(demoSource()!, data);
    expect(dir).toBe(path.join(data, "demo", "todomvc"));
    expect(existsSync(path.join(dir, "tests", "adding.yaml"))).toBe(true);
    writeFileSync(path.join(dir, "pack.yaml"), "name: Changed\n");
    placeDemoPack(demoSource()!, data);
    expect(readFileSync(path.join(dir, "pack.yaml"), "utf8")).toBe("name: Changed\n");
  });

  it("starts a run of the pack and opens its page", async () => {
    const calls: unknown[] = [];
    const api: ApiCall = (method, p, body) => {
      calls.push([method, p, body]);
      return Promise.resolve({ data: { id: "9f8e7d6c" } });
    };
    expect(await startDemoRun(api, [okPack])).toBe("#/runs/9f8e7d6c");
    expect(calls).toEqual([["POST", "/runs", { packId: "0a1b2c3d", label: "Demo" }]]);
  });

  it("opens the pack when the run can't start, and nothing when the pack doesn't load", async () => {
    const refused: ApiCall = () => Promise.resolve({ error: { message: "busy" } });
    expect(await startDemoRun(refused, [okPack])).toBe("#/packs/0a1b2c3d");
    expect(await startDemoRun(refused, [{ data: { ...okPack.data!, status: "error", error: "bad" } }])).toBeNull();
    expect(await startDemoRun(refused, [])).toBeNull();
  });
});
