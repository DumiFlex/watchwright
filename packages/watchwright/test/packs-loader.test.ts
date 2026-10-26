import { utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPack, packChanged, PackLoadError } from "../src/plugins/packs/loader.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";

afterEach(cleanTempDirs);

const PACK = `
import { pack } from "watchwright";
export default pack({ name: "Demo", site: { key: "demo", baseURL: "http://127.0.0.1:1/" }, params: { lang: { choices: ["en", "de"], default: "en" } } });
`;

describe("pack loader", () => {
  it("bundles a TypeScript pack and collects its tests in file order", async () => {
    const dir = tempDir();
    writeFiles(dir, {
      "pack.ts": PACK,
      "tests/b.ts": `import { test } from "watchwright"; test("B1", { title: "Second file" }, async () => {});`,
      "tests/a.ts": `import { test } from "watchwright"; import { label } from "../lib/label"; const n: number = 1; test("A" + n, { title: label }, async () => {}); test("A2", async () => {});`,
      "lib/label.ts": `export const label: string = "From a helper";`,
    });
    const pack = await loadPack(dir, tempDir());
    expect(pack.options.name).toBe("Demo");
    expect(pack.tests.map((t) => [t.id, t.file, t.meta.title])).toEqual([
      ["A1", "tests/a.ts", "From a helper"],
      ["A2", "tests/a.ts", undefined],
      ["B1", "tests/b.ts", "Second file"],
    ]);
    expect(packChanged(pack)).toBe(false);
  });

  it("notices changed, added and imported files", async () => {
    const dir = tempDir();
    writeFiles(dir, { "pack.ts": PACK, "tests/a.ts": `import { test } from "watchwright"; import "../lib/x"; test("A1", async () => {});`, "lib/x.ts": "export {};" });
    const pack = await loadPack(dir, tempDir());
    const later = new Date(Date.now() + 5000);
    writeFileSync(path.join(dir, "lib", "x.ts"), "export const y = 1;");
    utimesSync(path.join(dir, "lib", "x.ts"), later, later);
    expect(packChanged(pack)).toBe(true);
    const again = await loadPack(dir, tempDir());
    writeFiles(dir, { "tests/new.ts": `import { test } from "watchwright"; test("N1", async () => {});` });
    expect(packChanged(again)).toBe(true);
    expect((await loadPack(dir, tempDir())).tests.map((t) => t.id)).toEqual(["A1", "N1"]);
  });

  it("explains a pack that doesn't build", async () => {
    const dir = tempDir();
    writeFiles(dir, { "pack.ts": PACK, "tests/a.ts": `import { test } from "watchwright"; test("A1", async () => { const = ; });` });
    const err = await loadPack(dir, tempDir()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PackLoadError);
    expect((err as PackLoadError).problems[0]).toMatch(/tests\/a\.ts:1/);
  });

  it("refuses a folder without a pack file, and a pack file without pack()", async () => {
    await expect(loadPack(tempDir(), tempDir())).rejects.toThrow(/has no pack file/);
    const dir = tempDir();
    writeFiles(dir, { "pack.ts": "export default 1;" });
    await expect(loadPack(dir, tempDir())).rejects.toThrow(/doesn't call pack/);
  });

  it("checks the pack's options", async () => {
    const dir = tempDir();
    writeFiles(dir, { "pack.ts": `import { pack } from "watchwright"; export default pack({ name: "", site: { key: "has space" }, flags: { x: "bad" } } as never);` });
    const err = (await loadPack(dir, tempDir()).catch((e: unknown) => e)) as PackLoadError;
    expect(err.problems).toEqual([expect.stringMatching(/name/), expect.stringMatching(/site.key/), expect.stringMatching(/Flag "x"/)]);
  });

  it("refuses duplicate test ids", async () => {
    const dir = tempDir();
    writeFiles(dir, { "pack.ts": PACK, "tests/a.ts": `import { test } from "watchwright"; test("A1", async () => {}); test("A1", async () => {});` });
    await expect(loadPack(dir, tempDir())).rejects.toThrow(/Two tests have the id "A1"/);
  });
});
