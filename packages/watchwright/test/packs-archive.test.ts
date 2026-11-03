import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzip, zip, ZipLimitError } from "../src/jobs/zip.js";
import { ArchiveError, folderName, packEntries, packFiles, packFolders, unpackPack } from "../src/plugins/packs/archive.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Packs as .zip files: download a pack's folder, upload a zip into a new folder and add it.

const PACK = { "pack.yaml": "name: Shop\nsite: { key: shop, baseURL: http://127.0.0.1:9/ }\n", "tests/a.yaml": "tests:\n  - id: A\n    steps:\n      - reload\n", "README.md": "# Shop\n" };
const z = (files: Record<string, string>) => zip(Object.entries(files).map(([name, text]) => ({ name, data: Buffer.from(text) })));

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

describe("pack zips", () => {
  it("packs a folder under its name, without dependencies, VCS folders or links", () => {
    const dir = path.join(tempDir("ww-arch-"), "shop");
    writeFiles(dir, { ...PACK, "node_modules/x/index.js": "x", ".git/HEAD": "ref", ".env.example": "A=1" });
    symlinkSync("/etc/passwd", path.join(dir, "link"));
    expect(packEntries(dir).map((e) => e.name)).toEqual(["shop/.env.example", "shop/README.md", "shop/pack.yaml", "shop/tests/a.yaml"]);
  });

  it("takes a pack file at the top or inside one top folder", () => {
    expect(packFiles(z(PACK)).map((f) => f.name).sort()).toEqual(["README.md", "pack.yaml", "tests/a.yaml"]);
    const wrapped = Object.fromEntries(Object.entries(PACK).map(([k, v]) => [`shop-main/${k}`, v]));
    expect(packFiles(z({ ...wrapped, "__MACOSX/shop-main/._pack.yaml": "junk" })).map((f) => f.name).sort()).toEqual(["README.md", "pack.yaml", "tests/a.yaml"]);
    expect(() => packFiles(z({ "notes.txt": "hi" }))).toThrow(/no pack file/);
    expect(() => packFiles(Buffer.from("not a zip"))).toThrow(ArchiveError);
  });

  it("brings files the pack imports from outside its folder, at their place beside it", () => {
    const root = tempDir("ww-arch-");
    writeFiles(root, { "bench/shared.ts": "s", "bench/lib/util.ts": "u", "bench/other.ts": "not imported", "bench/smoke/pack.ts": "p", "bench/smoke/tests/a.ts": "a" });
    const smoke = path.join(root, "bench", "smoke");
    const outside = [path.join(root, "bench", "shared.ts"), path.join(root, "bench", "lib", "util.ts")];
    expect(packEntries(smoke, outside).map((e) => e.name)).toEqual(["bench/lib/util.ts", "bench/shared.ts", "bench/smoke/pack.ts", "bench/smoke/tests/a.ts"]);
    expect(packEntries(smoke).map((e) => e.name)).toEqual(["smoke/pack.ts", "smoke/tests/a.ts"]);
  });

  it("finds the packs in a zip: at the top, beside shared files, and a pack's direct subfolders", () => {
    const names = (files: string[]) => packFolders(files.map((name) => ({ name, data: Buffer.from("") })));
    expect(names(["pack.ts", "tests/a.ts"])).toEqual([""]);
    expect(names(["shared.ts", "smoke/pack.ts", "smoke/tests/a.ts"])).toEqual(["smoke"]);
    expect(names(["pack.ts", "smoke/pack.ts", "tests/fixtures/pack.ts", "node_modules/x/pack.js"])).toEqual(["", "smoke"]);
    expect(names(["a/pack.yaml", "b/pack.ts", "b/c/pack.ts", "b/c/d/pack.ts"])).toEqual(["a", "b", "b/c"]);
    // A zip of bench/ as Download .zip makes it for bench/smoke: the top folder is dropped.
    const files = packFiles(z({ "bench/shared.ts": "s", "bench/smoke/pack.yaml": "p" })).map((f) => f.name);
    expect(files.sort()).toEqual(["shared.ts", "smoke/pack.yaml"]);
  });

  it("refuses paths that leave the folder", () => {
    for (const bad of ["../evil.js", "a/../../evil.js", "/etc/evil", "C:/evil.js", "a\\..\\..\\evil.js"]) {
      expect(() => packFiles(z({ ...PACK, [bad]: "x" })), bad).toThrow(/outside its folder/);
    }
  });

  it("stops unpacking past its limits", () => {
    const big = zip([{ name: "big.txt", data: Buffer.alloc(1024 * 1024) }]);
    expect(() => unzip(big, { maxBytes: 1000 })).toThrow(ZipLimitError);
    expect(() => unzip(z({ a: "1", b: "2", c: "3" }), { maxEntries: 2 })).toThrow(ZipLimitError);
    expect(unzip(big, { maxBytes: 2 * 1024 * 1024 })[0]!.data.length).toBe(1024 * 1024);
  });

  it("unpacks into a new folder only, with a cleaned name", () => {
    const parent = tempDir("ww-arch-");
    const { dir, packs } = unpackPack(z(PACK), parent, "../My Shop!.zip");
    expect(dir).toBe(path.join(parent, "My Shop"));
    expect(packs).toEqual([dir]);
    expect(readFileSync(path.join(dir, "tests", "a.yaml"), "utf8")).toBe(PACK["tests/a.yaml"]);
    expect(() => unpackPack(z(PACK), parent, "My Shop")).toThrow(/already exists/);
    expect(() => folderName("...")).toThrow(/name/);
  });
});

describe("pack zips through the API", () => {
  it("downloads a pack and uploads it again as a new pack", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const src = path.join(tempDir("ww-src-"), "shop");
    writeFiles(src, PACK);
    const added = await h.api<{ id: string }>("POST", "/packs", { path: src });
    const down = await h.app.inject({ method: "GET", url: `/api/v1/packs/${added.data.id}/download`, headers: { host: h.host } });
    expect(down.statusCode).toBe(200);
    expect(down.headers["content-type"]).toBe("application/zip");
    expect(down.headers["content-disposition"]).toContain('filename="shop.zip"');
    expect(unzip(down.rawPayload).map((e) => e.name).sort()).toEqual(["shop/README.md", "shop/pack.yaml", "shop/tests/a.yaml"]);

    const parent = tempDir("ww-dest-");
    const upload = (body: Buffer, query: string) =>
      h.app.inject({ method: "POST", url: `/api/v1/packs/upload?${query}`, headers: { host: h.host, origin: `http://${h.host}`, "content-type": "application/zip" }, payload: body });
    const up = await upload(down.rawPayload, `name=shop-copy&folder=${encodeURIComponent(parent)}`);
    expect(up.statusCode).toBe(201);
    const pack = (up.json() as { data: { id: string; dir: string; name: string; tests: unknown[] } }).data;
    expect(pack, JSON.stringify(pack)).toMatchObject({ dir: path.join(parent, "shop-copy"), name: "Shop" });
    expect(pack.tests).toHaveLength(1);
    expect(pack.id).not.toBe(added.data.id);

    expect((await upload(down.rawPayload, `name=shop-copy&folder=${encodeURIComponent(parent)}`)).statusCode).toBe(409);
    const evil = await upload(z({ ...PACK, "../evil.js": "x" }), `name=evil&folder=${encodeURIComponent(parent)}`);
    expect(evil.statusCode).toBe(400);
    expect(existsSync(path.join(parent, "evil"))).toBe(false);
    expect(existsSync(path.join(parent, "evil.js"))).toBe(false);
    const json = await h.app.inject({ method: "POST", url: "/api/v1/packs/upload", headers: { host: h.host, "content-type": "application/json" }, payload: {} });
    expect(json.statusCode).toBe(415);
    expect((await h.app.inject({ method: "GET", url: "/api/v1/packs/abcdef12/download", headers: { host: h.host } })).statusCode).toBe(404);
  });

  it("downloads a pack with the shared files it imports, and the upload adds every pack in it", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const root = tempDir("ww-src-");
    const pk = (name: string) => `import { pack } from "watchwright"; import { site } from "../shared.js"; export default pack({ name: "${name}", site });`;
    writeFiles(root, {
      "bench/shared.ts": `export const site = { key: "bench", baseURL: "http://127.0.0.1:9/" };`,
      "bench/unused.ts": "export {};",
      "bench/smoke/pack.ts": pk("Smoke"),
      "bench/smoke/tests/a.ts": `import { test } from "watchwright"; test("S1", async () => {});`,
    });
    const added = await h.api<{ id: string; status: string }>("POST", "/packs", { path: path.join(root, "bench", "smoke") });
    expect(added.data.status).toBe("ok");
    const down = await h.app.inject({ method: "GET", url: `/api/v1/packs/${added.data.id}/download`, headers: { host: h.host } });
    expect(down.statusCode).toBe(200);
    expect(down.headers["content-disposition"]).toContain('filename="bench-smoke.zip"');
    expect(unzip(down.rawPayload).map((e) => e.name).sort()).toEqual(["bench/shared.ts", "bench/smoke/pack.ts", "bench/smoke/tests/a.ts"]);

    const parent = tempDir("ww-dest-");
    const upload = (body: Buffer, name: string) =>
      h.app.inject({ method: "POST", url: `/api/v1/packs/upload?name=${name}&folder=${encodeURIComponent(parent)}`, headers: { host: h.host, "content-type": "application/zip" }, payload: body });
    const up = await upload(down.rawPayload, "bench-smoke");
    expect(up.statusCode).toBe(201);
    const pack = (up.json() as { data: { dir: string; name: string; status: string; tests: unknown[] } }).data;
    expect(pack).toMatchObject({ dir: path.join(parent, "bench-smoke", "smoke"), name: "Smoke", status: "ok" });
    expect(pack.tests).toHaveLength(1);

    // A zip of a pack folder that holds another pack adds both.
    const both = await upload(z({ "pack.ts": pk("Bench").replace("../shared.js", "./shared.js"), "shared.ts": `export const site = { key: "bench" };`, "smoke/pack.ts": pk("Smoke 2") }), "bench2");
    expect(both.statusCode).toBe(201);
    const list = await h.api<{ name: string; dir: string; status: string }[]>("GET", "/packs");
    expect(list.data.filter((p) => p.dir.startsWith(path.join(parent, "bench2"))).map((p) => [p.name, p.status])).toEqual([
      ["Bench", "ok"],
      ["Smoke 2", "ok"],
    ]);
  });

  it("keeps uploads inside the folders a server allows", async () => {
    const root = tempDir("ww-roots-");
    const packs = path.join(root, "packs");
    mkdirSync(packs);
    process.env.WATCHWRIGHT_FOLDERS = packs;
    try {
      const h = await startHarness(tempDir("ww-data-"));
      harnesses.push(h);
      const send = (query: string) =>
        h.app.inject({ method: "POST", url: `/api/v1/packs/upload?${query}`, headers: { host: h.host, "content-type": "application/zip" }, payload: z(PACK) });
      expect((await send(`name=x&folder=${encodeURIComponent(root)}`)).statusCode).toBe(403);
      const ok = await send("name=shop");
      expect(ok.statusCode).toBe(201);
      expect(existsSync(path.join(packs, "shop", "pack.yaml"))).toBe(true);
    } finally {
      delete process.env.WATCHWRIGHT_FOLDERS;
    }
  });
});
