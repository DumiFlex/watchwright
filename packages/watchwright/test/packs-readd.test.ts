import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { zip } from "../src/jobs/zip.js";
import { AUTH_STORE } from "../src/plugins/auth/plugin.js";
import { replacePack } from "../src/plugins/packs/archive.js";
import { RUNS_REPO } from "../src/plugins/runs/plugin.js";
import type { RunStatus } from "../src/plugins/runs/repo.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// A pack removed from Watchwright leaves its folder on the server. It can be added again (and
// gets its runs back), updated by uploading a zip onto its folder, or removed with its files.

const yamlPack = (name: string) => ({ "pack.yaml": `name: ${name}\nsite: { key: shop, baseURL: http://127.0.0.1:9/ }\n`, "tests/a.yaml": "tests:\n  - id: A\n    steps:\n      - reload\n" });
const z = (files: Record<string, string>) => zip(Object.entries(files).map(([name, text]) => ({ name, data: Buffer.from(text) })));

const harnesses: Harness[] = [];
const servers: { app: FastifyInstance; store: Store }[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  for (const { app, store } of servers.splice(0)) {
    await app.close();
    store.close();
  }
  cleanTempDirs();
});

type PackJson = { id: string; dir: string; name: string; status: string; missing: boolean; tests: { id: string }[] };

function insertRun(h: Harness, pack: { id: string; dir: string }, id: string, status: RunStatus = "finished") {
  h.app.watchwright.services.get(RUNS_REPO).insertRun({ id, pack_id: pack.id, pack_name: "Shop", pack_path: path.join(pack.dir, "pack.yaml"), site_key: "shop", job_kind: "test", tests: "[]", params: "{}", options: "{}", status, started_by: "web", created_at: new Date().toISOString() });
}

describe("replacing a pack folder with a zip", () => {
  it("puts the zip's files in place, keeps installed dependencies, and leaves nothing behind", () => {
    const parent = tempDir("ww-repl-");
    writeFiles(path.join(parent, "shop"), { ...yamlPack("Old"), "tests/stale.yaml": "tests: []\n", "node_modules/x/index.js": "x", ".git/HEAD": "ref", "sub/node_modules/y.js": "y" });
    const { dir, packs } = replacePack(z({ ...yamlPack("New"), "sub/keep.txt": "k" }), parent, "shop");
    expect(dir).toBe(path.join(parent, "shop"));
    expect(packs).toEqual([dir]);
    expect(readFileSync(path.join(dir, "pack.yaml"), "utf8")).toContain("name: New");
    expect(existsSync(path.join(dir, "tests", "stale.yaml"))).toBe(false);
    expect(existsSync(path.join(dir, "node_modules", "x", "index.js"))).toBe(true);
    expect(existsSync(path.join(dir, ".git", "HEAD"))).toBe(true);
    expect(existsSync(path.join(dir, "sub", "node_modules", "y.js"))).toBe(true);
    expect(readFileSync(path.join(parent, "shop", "sub", "keep.txt"), "utf8")).toBe("k");
    // Only the folder: no upload or old copies beside it.
    expect(readdirSync(parent).sort()).toEqual(["shop"]);
  });

  it("leaves the folder as it was when the zip isn't a pack, and makes a folder that isn't there", () => {
    const parent = tempDir("ww-repl-");
    writeFiles(path.join(parent, "shop"), yamlPack("Old"));
    expect(() => replacePack(z({ "notes.txt": "hi" }), parent, "shop")).toThrow(/no pack file/);
    expect(readFileSync(path.join(parent, "shop", "pack.yaml"), "utf8")).toContain("name: Old");
    writeFileSync(path.join(parent, "file"), "x");
    expect(() => replacePack(z(yamlPack("New")), parent, "file")).toThrow(/is a file/);
    expect(replacePack(z(yamlPack("New")), parent, "fresh").dir).toBe(path.join(parent, "fresh"));
  });
});

describe("adding a removed pack again", () => {
  it("gives it its old id back, so its runs are its own again", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const dir = path.join(tempDir("ww-src-"), "shop");
    writeFiles(dir, yamlPack("Shop"));
    const first = (await h.api<PackJson>("POST", "/packs", { path: dir })).data;
    insertRun(h, first, "aaaa0001");
    expect((await h.api("DELETE", `/packs/${first.id}`)).status).toBe(200);
    expect(existsSync(dir)).toBe(true);

    const again = (await h.api<PackJson>("POST", "/packs", { path: dir })).data;
    expect(again.id).toBe(first.id);
    const runs = await h.api<{ id: string }[]>("GET", `/runs?packId=${first.id}`);
    expect(runs.data.map((r) => r.id)).toContain("aaaa0001");

    // Another pack already took the id: the re-added one gets a new id.
    const other = path.join(tempDir("ww-src-"), "shop2");
    writeFiles(other, yamlPack("Shop 2"));
    const second = (await h.api<PackJson>("POST", "/packs", { path: other })).data;
    insertRun(h, { id: again.id, dir: other }, "aaaa0002");
    await h.api("DELETE", `/packs/${second.id}`);
    expect((await h.api<PackJson>("POST", "/packs", { path: other })).data.id).not.toBe(again.id);
  });
});

describe("uploading onto a folder that's there", () => {
  it("says what's in the folder, then replaces it on request and keeps the pack's id", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const parent = tempDir("ww-dest-");
    const upload = (files: Record<string, string>, query = "") =>
      h.app.inject({ method: "POST", url: `/api/v1/packs/upload?name=shop&folder=${encodeURIComponent(parent)}${query}`, headers: { host: h.host, "content-type": "application/zip" }, payload: z(files) });

    const made = await upload(yamlPack("Shop"));
    expect(made.statusCode).toBe(201);
    const pack = (made.json() as { data: PackJson }).data;

    const refused = await upload({ ...yamlPack("Shop v2"), "tests/b.yaml": "tests:\n  - id: B\n    steps:\n      - reload\n" });
    expect(refused.statusCode).toBe(409);
    const err = (refused.json() as { error: { code: string; message: string; detail: { dir: string; packs: { id: string; name: string }[]; busy: string | null } } }).error;
    expect(err.code).toBe("exists");
    expect(err.detail).toEqual({ dir: path.join(parent, "shop"), packs: [{ id: pack.id, name: "Shop", dir: path.join(parent, "shop") }], busy: null });
    // A zip that isn't a pack says that first.
    expect((await upload({ "notes.txt": "x" })).statusCode).toBe(400);

    const replaced = await upload({ ...yamlPack("Shop v2"), "tests/b.yaml": "tests:\n  - id: B\n    steps:\n      - reload\n" }, "&replace=1");
    expect(replaced.statusCode).toBe(201);
    const updated = (replaced.json() as { data: PackJson }).data;
    expect(updated).toMatchObject({ id: pack.id, name: "Shop v2", status: "ok" });
    expect(updated.tests.map((t) => t.id).sort()).toEqual(["A", "B"]);

    // A run of the pack going on: the folder stays as it is.
    insertRun(h, pack, "bbbb0001", "running");
    const busy = await upload(yamlPack("Shop v3"), "&replace=1");
    expect(busy.statusCode).toBe(409);
    expect((busy.json() as { error: { code: string } }).error.code).toBe("pack_busy");
    expect(readFileSync(path.join(parent, "shop", "pack.yaml"), "utf8")).toContain("Shop v2");
  });

  it("updates the leftover folder of a removed pack, which comes back with its id", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const parent = tempDir("ww-dest-");
    const dir = path.join(parent, "shop");
    writeFiles(dir, yamlPack("Shop"));
    const pack = (await h.api<PackJson>("POST", "/packs", { path: dir })).data;
    insertRun(h, pack, "cccc0001");
    await h.api("DELETE", `/packs/${pack.id}`);
    const res = await h.app.inject({ method: "POST", url: `/api/v1/packs/upload?name=shop&folder=${encodeURIComponent(parent)}&replace=1`, headers: { host: h.host, "content-type": "application/zip" }, payload: z(yamlPack("Shop new")) });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: PackJson }).data).toMatchObject({ id: pack.id, name: "Shop new" });
  });
});

describe("removing a pack with its files", () => {
  it("deletes the folder, but not one that holds another pack or a running pack's files", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const root = path.join(tempDir("ww-src-"), "bench");
    writeFiles(root, { ...yamlPack("Bench"), "smoke/pack.yaml": "name: Smoke\nsite: { key: shop }\n" });
    const bench = (await h.api<PackJson>("POST", "/packs", { path: root })).data;
    const smoke = (await h.api<PackJson>("POST", "/packs", { path: path.join(root, "smoke") })).data;

    const shared = await h.api("DELETE", `/packs/${bench.id}?deleteFiles=true`);
    expect(shared.status).toBe(409);
    expect(shared.error?.code).toBe("folder_shared");
    expect(shared.error?.message).toContain('"Smoke"');

    insertRun(h, smoke, "dddd0001", "paused");
    expect((await h.api("DELETE", `/packs/${smoke.id}?deleteFiles=true`)).error?.code).toBe("pack_busy");
    expect(existsSync(path.join(root, "smoke"))).toBe(true);
    h.app.watchwright.services.get(RUNS_REPO).updateRun("dddd0001", { status: "stopped" });

    const gone = await h.api<{ removed: string; deleted: string }>("DELETE", `/packs/${smoke.id}?deleteFiles=true`);
    expect(gone.data).toEqual({ removed: smoke.id, deleted: path.join(root, "smoke") });
    expect(existsSync(path.join(root, "smoke"))).toBe(false);
    expect((await h.api("DELETE", `/packs/${bench.id}?deleteFiles=true`)).status).toBe(200);
    expect(existsSync(root)).toBe(false);
    // Its runs stay.
    expect((await h.api<{ id: string }[]>("GET", "/runs")).data.map((r) => r.id)).toContain("dddd0001");
  });

  it("won't delete a folder that holds the server's places", async () => {
    const root = tempDir("ww-roots-");
    const packs = path.join(root, "packs");
    mkdirSync(packs);
    writeFiles(packs, yamlPack("Top"));
    process.env.WATCHWRIGHT_FOLDERS = packs;
    try {
      const h = await startHarness(tempDir("ww-data-"));
      harnesses.push(h);
      const top = (await h.api<PackJson>("POST", "/packs", { path: packs })).data;
      const res = await h.api("DELETE", `/packs/${top.id}?deleteFiles=true`);
      expect(res.status).toBe(403);
      expect(existsSync(path.join(packs, "pack.yaml"))).toBe(true);
    } finally {
      delete process.env.WATCHWRIGHT_FOLDERS;
    }
  });

  it("lets only admins delete files, with login on", async () => {
    const host = "127.0.0.1:7420";
    const store = openStore(tempDir("ww-data-"), migrationsOf(BUILTIN_PLUGINS));
    const app = await buildServer({ store, port: 7420, plugins: BUILTIN_PLUGINS, login: true });
    servers.push({ app, store });
    const auth = app.watchwright.services.get(AUTH_STORE);
    const cookie: Record<string, string> = {};
    for (const [name, role] of [["ada", "admin"], ["uma", "user"]] as const) {
      await auth.add({ name, password: "correct horse battery", role });
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/signin", headers: { host, origin: `http://${host}` }, payload: { name, password: "correct horse battery" } });
      cookie[name] = String(res.headers["set-cookie"]).split(";")[0]!;
    }
    const as = (who: string, method: "POST" | "DELETE", url: string, payload?: object) => app.inject({ method, url: `/api/v1${url}`, headers: { host, origin: `http://${host}`, cookie: cookie[who]! }, ...(payload ? { payload } : {}) });
    const dir = path.join(tempDir("ww-src-"), "shop");
    writeFiles(dir, yamlPack("Shop"));
    const id = ((await as("ada", "POST", "/packs", { path: dir })).json() as { data: PackJson }).data.id;
    const refused = await as("uma", "DELETE", `/packs/${id}?deleteFiles=true`);
    expect(refused.statusCode).toBe(403);
    expect(existsSync(dir)).toBe(true);
    expect((await as("ada", "DELETE", `/packs/${id}?deleteFiles=true`)).statusCode).toBe(200);
    expect(existsSync(dir)).toBe(false);
  });
});
