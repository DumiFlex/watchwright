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

  it("points stack traces at the pack's own files, not the build cache", async () => {
    process.setSourceMapsEnabled(true); // as the CLI does
    const dir = tempDir();
    writeFiles(dir, { "pack.ts": PACK, "tests/a.ts": `import { test } from "watchwright";\ntest("A1", async () => {\n  throw new Error("boom");\n});` });
    const pack = await loadPack(dir, tempDir());
    const err = await (pack.tests[0]!.body as unknown as () => Promise<void>)().catch((e: Error) => e);
    // Windows stacks name the file with forward slashes.
    const slashes = (s: string) => s.replaceAll("\\", "/");
    expect(slashes((err as Error).stack ?? "")).toContain(`${slashes(path.join(dir, "tests", "a.ts"))}:3:9`);
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

  it("lists files it imports from outside its folder, and says so when they're missing", async () => {
    const root = tempDir();
    const smoke = path.join(root, "bench", "smoke");
    const pk = `import { pack } from "watchwright"; import { label } from "../shared.js"; import "./local.js"; export default pack({ name: label, site: { key: "demo" } });`;
    writeFiles(root, { "bench/shared.ts": `import { more } from "./more.js"; export const label: string = "Shared" + more;`, "bench/more.ts": `export const more = "!";`, "bench/smoke/pack.ts": pk, "bench/smoke/local.ts": "export {};" });
    const loaded = await loadPack(smoke, tempDir());
    expect(loaded.options.name).toBe("Shared!");
    expect(loaded.outside).toEqual([path.join(root, "bench", "more.ts"), path.join(root, "bench", "shared.ts")]);

    // Only the pack's folder made it to the server.
    const alone = path.join(tempDir(), "smoke");
    writeFiles(alone, { "pack.ts": pk, "local.ts": "export {};" });
    const err = (await loadPack(alone, tempDir()).catch((e: unknown) => e)) as PackLoadError;
    expect(err).toBeInstanceOf(PackLoadError);
    expect(err.message).toMatch(/^The pack imports files from outside its folder that aren't on this server\./);
    expect(err.problems).toEqual([`pack.ts:1:58 imports "../shared.js" from outside the pack's folder, and it isn't in ${path.dirname(alone)}.`]);
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

  it("refuses test ids that can't be folders on Windows: a case-only clash, a device name, a trailing dot", async () => {
    const dir = tempDir();
    writeFiles(dir, {
      "pack.ts": PACK,
      "tests/a.ts": `import { test } from "watchwright"; test("login", async () => {}); test("Login", async () => {}); test("con", async () => {}); test("LPT1.x", async () => {}); test("v1.", async () => {}); test("console", async () => {});`,
    });
    const err = (await loadPack(dir, tempDir()).catch((e: unknown) => e)) as PackLoadError;
    expect(err).toBeInstanceOf(PackLoadError);
    expect(err.problems).toEqual([
      `"login" and "Login" differ only in case: on Windows their results would go to one folder. Rename one.`,
      `"con" is a name Windows keeps for a device, so it can't be a folder there. Rename it.`,
      `"LPT1.x" is a name Windows keeps for a device, so it can't be a folder there. Rename it.`,
      `"v1." ends with a dot, which Windows drops from folder names. Rename it.`,
    ]);
  });
});
