import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FOLDERS, FolderError, cleanPath } from "../src/plugins/folders/folders.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

const PACK = `import { pack } from "watchwright";\nexport default pack({ name: "Found", site: { key: "found" } });\n`;

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function harness() {
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  return h;
}

describe("cleanPath", () => {
  const posix = { platform: "linux" as const, home: "/home/sam" };
  const win = { platform: "win32" as const, home: "C:\\Users\\sam" };

  it("strips the quotes Windows' Copy as path adds", () => {
    expect(cleanPath('"C:\\Users\\sam\\shop\\watchwright"', win)).toBe("C:\\Users\\sam\\shop\\watchwright");
    expect(cleanPath("  '/srv/shop'  ", posix)).toBe("/srv/shop");
  });

  it("takes file URLs, ~ and either slash, and drops a trailing separator", () => {
    expect(cleanPath("file:///srv/my%20shop/", posix)).toBe("/srv/my shop");
    expect(cleanPath("file:///C:/sites/shop", win)).toBe("C:\\sites\\shop");
    expect(cleanPath("~/sites/shop", posix)).toBe("/home/sam/sites/shop");
    expect(cleanPath("~\\sites", win)).toBe("C:\\Users\\sam\\sites");
    expect(cleanPath("C:/sites/shop/", win)).toBe("C:\\sites\\shop");
    expect(cleanPath("D:", win)).toBe("D:\\");
    expect(cleanPath("/", posix)).toBe("/");
    expect(cleanPath("C:\\", win)).toBe("C:\\");
  });

  it("refuses relative paths with the full path they would have meant", () => {
    expect(() => cleanPath("shop/watchwright", { ...posix, cwd: "/srv" })).toThrow(/relative path.*\/srv\/shop\/watchwright/);
    expect(() => cleanPath("\\sites", win)).toThrow(FolderError);
    expect(() => cleanPath('""', posix)).toThrow(/Give a folder path/);
  });
});

describe("folders plugin", () => {
  it("lists sub-folders only, sorted, with pack folders marked and hidden ones left out", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, { "shop/watchwright/pack.ts": PACK, "b-notes/readme.md": "x", "A-site/index.html": "x", "loose.txt": "x", ".git/HEAD": "x", "node_modules/x/index.js": "x" });
    const h = await harness();
    const res = await h.api<{ path: string; parent: string; marks: Record<string, string>; folders: { name: string; marks: Record<string, string> }[] }>("GET", `/folders?path=${encodeURIComponent(`"${root}"`)}`);
    expect(res.status).toBe(200);
    expect(res.data.path).toBe(root);
    expect(res.data.parent).toBe(path.dirname(root));
    expect(res.data.folders.map((f) => f.name)).toEqual(["A-site", "b-notes", "shop"]);
    const shop = await h.api<{ marks: Record<string, string>; folders: { name: string; marks: Record<string, string> }[] }>("GET", `/folders?path=${encodeURIComponent(path.join(root, "shop"))}`);
    expect(shop.data.folders).toEqual([{ name: "watchwright", path: path.join(root, "shop", "watchwright"), marks: { pack: "pack.ts" } }]);
    const pack = await h.api<{ marks: Record<string, string> }>("GET", `/folders?path=${encodeURIComponent(path.join(root, "shop", "watchwright"))}`);
    expect(pack.data.marks).toEqual({ pack: "pack.ts" });
    const hidden = await h.api<{ folders: { name: string }[] }>("GET", `/folders?path=${encodeURIComponent(root)}&hidden=true`);
    expect(hidden.data.folders.map((f) => f.name)).toContain(".git");
  });

  it("explains a missing folder, a file and a relative path", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, { "loose.txt": "x" });
    const h = await harness();
    expect((await h.api("GET", `/folders?path=${encodeURIComponent(path.join(root, "nope"))}`)).error?.code).toBe("not_found");
    expect((await h.api("GET", `/folders?path=${encodeURIComponent(path.join(root, "loose.txt"))}`)).error?.code).toBe("not_a_folder");
    expect((await h.api("GET", "/folders?path=relative%2Fpath")).error?.code).toBe("bad_path");
  });

  it("gives places to start from and remembers added pack folders, newest first", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, { "one/pack.ts": PACK, "two/pack.ts": PACK });
    const h = await harness();
    const before = await h.api<{ home: string; roots: string[]; recent: unknown[] }>("GET", "/folders/places");
    expect(before.data.roots.length).toBeGreaterThan(0);
    expect(before.data.recent).toEqual([]);
    await h.api("POST", "/packs", { path: path.join(root, "one") });
    await h.api("POST", "/packs", { path: pathToFileURL(path.join(root, "two")).href });
    const after = await h.api<{ recent: { path: string; exists: boolean }[] }>("GET", "/folders/places");
    expect(after.data.recent.map((r) => r.path)).toEqual([path.join(root, "two"), path.join(root, "one")]);
    expect(after.data.recent.every((r) => r.exists)).toBe(true);
    const cleared = await h.api<unknown[]>("DELETE", "/folders/recent");
    expect(cleared.data).toEqual([]);
  });

  it("opens only pack folders and the data folder, and never a file", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, { "shop/pack.ts": PACK, "elsewhere/x.txt": "x" });
    const h = await harness();
    await h.api("POST", "/packs", { path: path.join(root, "shop") });
    const launched: string[][] = [];
    const folders = h.app.watchwright.services.get(FOLDERS);
    const open = (p: string) => folders.open(p, (cmd, args) => launched.push([cmd, ...args]));
    mkdirSync(path.join(root, "shop", "tests"));
    expect(open(path.join(root, "shop", "tests"))).toBe(path.join(root, "shop", "tests"));
    expect(launched).toHaveLength(1);
    expect(() => open(path.join(root, "elsewhere"))).toThrow(/only opens/);
    expect(() => open(path.join(root, "shop", "pack.ts"))).toThrow(/no folder/);
    expect((await h.api("POST", "/folders/open", { path: path.join(root, "elsewhere") })).error?.code).toBe("not_allowed");
  });
});

describe("packs: starter", () => {
  it("writes a starter pack that loads, adds it and remembers its folder", async () => {
    const root = tempDir("ww-tree-");
    const h = await harness();
    const res = await h.api<{ name: string; dir: string; status: string; siteKey: string; tests: { id: string }[] }>("POST", "/packs/create", { path: path.join(root, "my-shop", "watchwright"), name: "My Shop", baseURL: "http://127.0.0.1:3000/" });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ name: "My Shop", dir: path.join(root, "my-shop", "watchwright"), status: "ok", siteKey: "my-shop" });
    expect(res.data.tests.map((t) => t.id)).toEqual(["HOME1"]);
    expect(readFileSync(path.join(res.data.dir, "README.md"), "utf8")).toContain("# My Shop");
    expect((await h.api<{ recent: { path: string }[] }>("GET", "/folders/places")).data.recent[0]?.path).toBe(res.data.dir);
  });

  it("never writes over a pack or a file, and wants an http address", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, { "has-pack/pack.ts": PACK, "has-readme/README.md": "mine" });
    const h = await harness();
    const body = (dir: string, baseURL = "http://localhost:8080/") => ({ path: path.join(root, dir), name: "X", baseURL });
    expect((await h.api("POST", "/packs/create", body("has-pack"))).error?.message).toMatch(/already has a pack/);
    expect((await h.api("POST", "/packs/create", body("has-readme"))).error?.message).toMatch(/README\.md/);
    expect(readFileSync(path.join(root, "has-readme", "README.md"), "utf8")).toBe("mine");
    expect((await h.api("POST", "/packs/create", body("fresh", "localhost:8080"))).error?.code).toBe("bad_starter");
  });
});

describe("packs: discover and move", () => {
  it("finds pack files a few levels down, skipping node_modules and hidden folders, and says which are added", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, {
      "shop/watchwright/pack.ts": PACK,
      "shop/watchwright/tests/inner/pack.ts": PACK, // inside a pack: not searched
      "blog/e2e/pack.mjs": PACK,
      "blog/node_modules/lib/pack.ts": PACK,
      ".hidden/pack.ts": PACK,
      "deep/a/b/c/d/e/pack.ts": PACK,
    });
    const h = await harness();
    const added = await h.api<{ id: string }>("POST", "/packs", { path: path.join(root, "shop", "watchwright") });
    const res = await h.api<{ root: string; found: { dir: string; packFile: string; packId: string | null }[]; truncated: boolean }>("POST", "/packs/discover", { path: root });
    expect(res.data.found).toEqual([
      { dir: path.join(root, "blog", "e2e"), packFile: "pack.mjs", packId: null },
      { dir: path.join(root, "shop", "watchwright"), packFile: "pack.ts", packId: added.data.id },
    ]);
    const deeper = await h.api<{ found: { dir: string }[] }>("POST", "/packs/discover", { path: root, depth: 6 });
    expect(deeper.data.found.map((f) => f.dir)).toContain(path.join(root, "deep", "a", "b", "c", "d", "e"));
  });

  it("moves a pack to its new folder and keeps its id, and refuses a folder another pack has", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, { "old/pack.ts": PACK, "new/pack.ts": PACK, "other/pack.ts": PACK });
    const h = await harness();
    const a = await h.api<{ id: string }>("POST", "/packs", { path: path.join(root, "old") });
    const b = await h.api<{ id: string }>("POST", "/packs", { path: path.join(root, "other") });
    const moved = await h.api<{ id: string; dir: string; missing: boolean; status: string }>("POST", `/packs/${a.data.id}/move`, { path: `"${path.join(root, "new")}"` });
    expect(moved.data).toMatchObject({ id: a.data.id, dir: path.join(root, "new"), missing: false, status: "ok" });
    const clash = await h.api("POST", `/packs/${b.data.id}/move`, { path: path.join(root, "new") });
    expect(clash.error?.message).toMatch(/already added/);
  });

  it("says when a pack's folder is gone", async () => {
    const root = tempDir("ww-tree-");
    writeFiles(root, { "shop/pack.ts": PACK });
    const h = await harness();
    const a = await h.api<{ id: string; missing: boolean }>("POST", "/packs", { path: path.join(root, "shop") });
    expect(a.data.missing).toBe(false);
    rmSync(path.join(root, "shop"), { recursive: true });
    expect((await h.api<{ missing: boolean }>("GET", `/packs/${a.data.id}`)).data.missing).toBe(true);
  });
});
