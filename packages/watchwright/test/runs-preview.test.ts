import { afterEach, describe, expect, it } from "vitest";
import type { RunPreview } from "../src/plugins/runs/engine.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Planning a run without starting it: no browser needed, only the pack build.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function withPack() {
  const packDir = tempDir("ww-pack-");
  writeFiles(packDir, {
    "pack.ts": `
import { pack } from "watchwright";
export default pack({ name: "Preview", site: { key: "preview" }, params: { model: { choices: ["a", "b"], default: "a" } }, tests: "./tests/*.ts" });`,
    "tests/all.ts": `
import { test } from "watchwright";
test("A", { title: "First" }, async () => {});
test("B", { title: "Second", needs: ["A"], runs: { by: "model", a: 2, b: 3 } }, async () => {});
test("P", { title: "Parent" }, async ({ child }) => { await child("K"); });
test("K", { title: "Kid", inside: "P" }, async () => {});
test("C", { title: "Third" }, async () => {});`,
  });
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  const added = await h.api<{ id: string }>("POST", "/packs", { path: packDir });
  expect(added.status).toBe(201);
  return { h, packId: added.data.id };
}

describe("run preview", () => {
  it("plans every attempt and says why tests join", async () => {
    const { h, packId } = await withPack();
    const res = await h.api<RunPreview>("POST", "/runs/preview", { packId, tests: ["B", "K"] });
    expect(res.status).toBe(200);
    expect(res.data.plan.map((p) => `${p.testId}#${p.number}/${p.of}`)).toEqual(["A#1/1", "B#1/2", "B#2/2", "P#1/1"]);
    expect(res.data.plan.find((p) => p.testId === "P")?.children).toEqual(["K"]);
    expect(res.data.attempts).toBe(4);
    expect(res.data.joined).toEqual([
      { testId: "A", reason: "needed", of: ["B"] },
      { testId: "P", reason: "parent", of: ["K"] },
    ]);
    expect(res.data.params).toEqual({ model: "a" });
    const pack = await h.api<{ run: unknown }>("GET", `/packs/${packId}`);
    expect(pack.data.run).toEqual({ pauseOnBroken: true, pauseLimitMinutes: 20, trace: "problems", video: true });
  });

  it("follows parameter values and the attempts override", async () => {
    const { h, packId } = await withPack();
    const byModel = await h.api<RunPreview>("POST", "/runs/preview", { packId, tests: ["B"], params: { model: "b" } });
    expect(byModel.data.attempts).toBe(4);
    const all = await h.api<RunPreview>("POST", "/runs/preview", { packId, attempts: 2 });
    expect(all.data.plan.map((p) => `${p.testId}#${p.number}`)).toEqual(["A#1", "A#2", "B#1", "B#2", "P#1", "P#2", "C#1", "C#2"]);
    expect(all.data.joined).toEqual([]);
  });

  it("refuses unknown tests and bad values with a readable error", async () => {
    const { h, packId } = await withPack();
    const unknown = await h.api("POST", "/runs/preview", { packId, tests: ["Z"] });
    expect(unknown.status).toBe(400);
    expect(unknown.error?.message).toMatch(/no test "Z"/);
    const bad = await h.api("POST", "/runs/preview", { packId, params: { model: "c" } });
    expect(bad.status).toBe(400);
    expect((await h.api("POST", "/runs/preview", { packId, attempts: 0 })).status).toBe(400);
  });
});
