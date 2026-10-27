import { afterEach, describe, expect, it } from "vitest";
import type { Preset, RunSummary } from "../src/plugins/runs/repo.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Presets, run labels and "Run again". Presets and labels need no browser; starting runs does.

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
export default pack({ name: "Presets", site: { key: "presets" }, params: { lang: { choices: ["en", "de"], default: "en" }, query: { default: "boots" } }, tests: "./tests/*.ts" });`,
    "tests/all.ts": `
import { test } from "watchwright";
test("A", { title: "First" }, async () => {});
test("B", { title: "Second" }, async () => {});`,
  });
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  const added = await h.api<{ id: string }>("POST", "/packs", { path: packDir });
  expect(added.status).toBe(201);
  return { h, packId: added.data.id };
}

const browsers = hasChromium || requireBrowsers;

describe("presets", () => {
  it("saves, replaces by name, lists, renames and deletes", async () => {
    const { h, packId } = await withPack();
    const saved = await h.api<Preset>("POST", "/presets", { packId, name: " full, German ", params: { lang: "de" }, video: false });
    expect(saved.status).toBe(201);
    expect(saved.data).toMatchObject({ packId, name: "full, German", choices: { params: { lang: "de" }, video: false } });
    // Saving the same name again replaces the choices and keeps the id.
    const again = await h.api<Preset>("POST", "/presets", { packId, name: "full, German", tests: ["A"] });
    expect(again.data.id).toBe(saved.data.id);
    expect(again.data.choices).toEqual({ tests: ["A"] });
    await h.api("POST", "/presets", { packId, name: "Another" });
    expect((await h.api<Preset[]>("GET", `/presets?pack=${packId}`)).data.map((p) => p.name)).toEqual(["Another", "full, German"]);

    const clash = await h.api("POST", `/presets/${saved.data.id}`, { name: "Another" });
    expect(clash.status).toBe(409);
    const renamed = await h.api<Preset>("POST", `/presets/${saved.data.id}`, { name: "German" });
    expect(renamed.data.name).toBe("German");

    expect((await h.api("DELETE", `/presets/${saved.data.id}`)).status).toBe(200);
    expect((await h.api("DELETE", `/presets/${saved.data.id}`)).status).toBe(404);
    expect((await h.api<Preset[]>("GET", "/presets")).data.map((p) => p.name)).toEqual(["Another"]);
  });

  it("refuses a start from a preset the pack doesn't have", async () => {
    const { h, packId } = await withPack();
    const res = await h.api("POST", "/runs", { packId, preset: "nope" });
    expect(res.status).toBe(404);
    expect(res.error?.message).toContain('"nope"');
  });

  it("declares the New run setting", async () => {
    const { h } = await withPack();
    const res = await h.api<{ values: Record<string, unknown> }>("GET", "/settings");
    expect(res.data.values["runs.newRunFrom"]).toBe("latest");
  });
});

describe.skipIf(!browsers)("labels and run again", () => {
  it("starts from a preset with overrides, labels a run and runs it again", async () => {
    const { h, packId } = await withPack();
    await h.api("POST", "/presets", { packId, name: "German", tests: ["A"], params: { lang: "de", query: "hat" }, video: false });
    const first = await h.api<RunSummary>("POST", "/runs", { packId, preset: "German", params: { lang: "de", query: "scarf" }, label: " nightly " });
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ tests: ["A"], params: { lang: "de", query: "scarf" }, options: { video: false }, label: "nightly" });
    await h.waitFor((e) => e.type === "run.finished" && e.runId === first.data.id, 60_000);

    const labeled = await h.api<RunSummary>("POST", `/runs/${first.data.id}/label`, { label: "nightly, German" });
    expect(labeled.data.label).toBe("nightly, German");

    const again = await h.api<RunSummary>("POST", `/runs/${first.data.id}/again`, {});
    expect(again.status).toBe(201);
    expect(again.data.id).not.toBe(first.data.id);
    expect(again.data).toMatchObject({ packId, tests: ["A"], params: { lang: "de", query: "scarf" }, options: { video: false }, label: "nightly, German" });
    await h.waitFor((e) => e.type === "run.finished" && e.runId === again.data.id, 60_000);

    expect((await h.api("POST", "/runs/ffffffff/again", {})).status).toBe(404);
  }, 120_000);
});
