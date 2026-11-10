import { utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { folderStamp } from "../src/plugins/packs/registry.js";
import { PACK_WATCH } from "../src/plugins/packs/watch.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Packs edited outside Watchwright (an editor, git, an agent) are built again by the packs
// plugin's check, so the page shows new tests, parameters and tasks without a press.

const PACK = "name: Shop\nsite: { key: shop, baseURL: http://127.0.0.1:9/ }\n";
const TEST_A = "tests:\n  - id: A\n    steps:\n      - reload\n";

type PackJson = { id: string; status: string; error: string | null; params: Record<string, unknown>; tests: { id: string }[] };

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

/** Writes a file with a modification time later than any before, so the stamp sees it even on a coarse clock. */
let tick = 0;
function save(file: string, text: string) {
  writeFileSync(file, text);
  const t = new Date(Date.now() + ++tick * 5000);
  utimesSync(file, t, t);
}

async function setup(files: Record<string, string>) {
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  const dir = path.join(tempDir("ww-src-"), "shop");
  writeFiles(dir, files);
  const pack = (await h.api<PackJson>("POST", "/packs", { path: dir })).data;
  const watch = h.app.watchwright.services.get(PACK_WATCH);
  const get = async () => (await h.api<PackJson>("GET", `/packs/${pack.id}`)).data;
  const count = (type: string) => h.app.watchwright.events.after(0).filter((e) => e.type === type && (e.data as { by?: string }).by === "files").length;
  return { h, dir, pack, watch, get, count };
}

describe("rebuilding packs changed outside Watchwright", () => {
  it("picks up new parameters and tests, and leaves an unchanged pack alone", async () => {
    const { dir, pack, watch, get, count } = await setup({ "pack.yaml": PACK, "tests/a.yaml": TEST_A });
    expect(pack.status).toBe("ok");
    await watch.tick();
    expect(count("pack.loaded")).toBe(0);

    save(path.join(dir, "pack.yaml"), `${PACK}params: { who: { default: ada } }\n`);
    save(path.join(dir, "tests", "b.yaml"), "tests:\n  - id: B\n    steps:\n      - reload\n");
    await watch.tick();
    const after = await get();
    expect(Object.keys(after.params)).toEqual(["who"]);
    expect(after.tests.map((t) => t.id)).toEqual(["A", "B"]);
    expect(count("pack.loaded")).toBe(1);
    await watch.tick();
    expect(count("pack.loaded")).toBe(1);
  });

  it("tries a broken save once, then again when it is fixed", async () => {
    const { dir, watch, get, count } = await setup({ "pack.yaml": PACK, "tests/a.yaml": TEST_A });
    save(path.join(dir, "tests", "a.yaml"), "tests:\n  - id: A\n    steps: [\n");
    await watch.tick();
    expect((await get()).status).toBe("error");
    await watch.tick();
    await watch.tick();
    expect(count("pack.reload_failed")).toBe(1);

    save(path.join(dir, "tests", "a.yaml"), TEST_A);
    await watch.tick();
    expect((await get()).status).toBe("ok");
    expect(count("pack.loaded")).toBe(1);
  });

  it("brings back a pack that never loaded once its folder changes", async () => {
    const { dir, pack, watch, get, count } = await setup({ "pack.yaml": "name: Shop\n", "tests/a.yaml": TEST_A });
    expect(pack.status).toBe("error");
    await watch.tick();
    expect(count("pack.reload_failed")).toBe(0);

    save(path.join(dir, "pack.yaml"), PACK);
    await watch.tick();
    const after = await get();
    expect(after.status).toBe("ok");
    expect(after.tests.map((t) => t.id)).toEqual(["A"]);
  });

  it("does nothing while the setting is off", async () => {
    const { h, dir, watch, get } = await setup({ "pack.yaml": PACK, "tests/a.yaml": TEST_A });
    expect((await h.api("POST", "/settings", { values: { "packs.watch": false } })).status).toBe(200);
    save(path.join(dir, "pack.yaml"), `${PACK}params: { who: { default: ada } }\n`);
    await watch.tick();
    expect((await get()).params).toEqual({});
    expect((await h.api("POST", "/settings", { values: { "packs.watch": true } })).status).toBe(200);
    await watch.tick();
    expect(Object.keys((await get()).params)).toEqual(["who"]);
  });
});

describe("folderStamp", () => {
  it("changes with the pack's files but not with node_modules or hidden folders", () => {
    const dir = tempDir("ww-stamp-");
    writeFiles(dir, { "pack.yaml": "x", "node_modules/a/index.js": "a", ".git/HEAD": "h" });
    const before = folderStamp(dir);
    save(path.join(dir, "node_modules", "a", "index.js"), "changed");
    save(path.join(dir, ".git", "HEAD"), "changed");
    expect(folderStamp(dir)).toBe(before);
    save(path.join(dir, "pack.yaml"), "y");
    expect(folderStamp(dir)).not.toBe(before);
  });
});
