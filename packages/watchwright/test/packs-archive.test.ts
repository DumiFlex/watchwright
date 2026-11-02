import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzip, zip, ZipLimitError } from "../src/jobs/zip.js";
import { ArchiveError, folderName, packEntries, packFiles, unpackPack } from "../src/plugins/packs/archive.js";
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
    const dir = unpackPack(z(PACK), parent, "../My Shop!.zip");
    expect(dir).toBe(path.join(parent, "My Shop"));
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
