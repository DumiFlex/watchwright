import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { AUTH_STORE } from "../src/plugins/auth/plugin.js";
import { isCodeFile } from "../src/plugins/editor/files.js";
import { buildServer } from "../src/server/app.js";
import { packFile, webAddress } from "../src/session/addresses.js";
import { openStore, type Store } from "../src/store/db.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";

// Pack code runs on the server, so with login on only admins change it
// (docs/research/teams-and-audience-dashboards.md); users keep YAML tests and data files, which
// reach only web addresses and files inside the pack folder.

const HOST = "127.0.0.1:7420";
const PASSWORD = "correct horse battery";

const open: { app: FastifyInstance; store: Store }[] = [];
afterEach(async () => {
  for (const { app, store } of open.splice(0)) {
    await app.close();
    store.close();
  }
  cleanTempDirs();
});

async function make() {
  const store = openStore(":memory:", migrationsOf(BUILTIN_PLUGINS));
  const app = await buildServer({ store, port: 7420, plugins: BUILTIN_PLUGINS, login: true });
  open.push({ app, store });
  const auth = app.watchwright.services.get(AUTH_STORE);
  const call = async (method: "GET" | "POST" | "DELETE", url: string, cookie: string, body?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: { host: HOST, origin: `http://${HOST}`, cookie }, ...(body === undefined ? {} : { payload: body as object }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are checked field by field
    return { status: res.statusCode, body: res.json() as { data?: Record<string, any>; error?: { code: string; message: string; detail?: unknown } } };
  };
  const signIn = async (name: string) => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signin", headers: { host: HOST, origin: `http://${HOST}` }, payload: { name, password: PASSWORD } });
    return String(res.headers["set-cookie"]).split(";")[0]!;
  };
  return { app, auth, call, signIn };
}

const PASSWORDS = { ada: "admin", uma: "user", ulf: "user" } as const;

async function withPack() {
  const t = await make();
  for (const [name, role] of Object.entries(PASSWORDS)) await t.auth.add({ name, password: PASSWORD, role });
  const admin = await t.signIn("ada");
  const user = await t.signIn("uma");
  const other = await t.signIn("ulf");
  const dir = tempDir("ww-pack-");
  writeFiles(dir, {
    "pack.yaml": "name: Mixed\nsite: { key: mixed, baseURL: http://127.0.0.1:9/ }\n",
    "tests/home.yaml": "id: H1\ntitle: Home\nsteps:\n  - goto: /\n",
    "lib/wait.ts": "export const WAIT = 100;\n",
  });
  const id = String((await t.call("POST", "/packs", admin, { path: dir })).body.data!.id);
  return { ...t, admin, user, other, dir, id };
}

describe("who changes pack code", () => {
  it("tells code and build files from YAML and data", () => {
    for (const f of ["pack.ts", "tests/a.mts", "lib/x.cjs", "a.jsx", "helpers.js", "package.json", "tsconfig.json", "tsconfig.build.json", "jsconfig.json", ".npmrc", "pnpm-lock.yaml", "sub/package-lock.json"]) expect(isCodeFile(f), f).toBe(true);
    for (const f of ["pack.yaml", "tests/home.yaml", "data/users.json", "README.md", "notes.txt", "rubric.yml", "list.csv"]) expect(isCodeFile(f), f).toBe(false);
  });

  it("lets users change YAML and data, and only admins code and packs", async () => {
    const { auth, call, signIn } = await make();
    await auth.add({ name: "ada", password: PASSWORD, role: "admin" });
    await auth.add({ name: "uma", password: PASSWORD, role: "user" });
    const admin = await signIn("ada");
    const user = await signIn("uma");
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": "name: Mixed\nsite: { key: mixed, baseURL: http://127.0.0.1:9/ }\n",
      "tests/home.yaml": "id: H1\ntitle: Home\nsteps:\n  - goto: /\n",
      "notes.txt": "plain",
    });

    expect((await call("POST", "/packs", user, { path: dir })).status).toBe(403);
    const added = await call("POST", "/packs", admin, { path: dir });
    expect(added.status).toBe(201);
    const id = String(added.body.data!.id);

    const yaml = await call("POST", `/packs/${id}/file`, user, { path: "tests/home.yaml", text: "id: H1\ntitle: Home again\nsteps:\n  - goto: /\n" });
    expect(yaml.status).toBe(200);
    expect((await call("POST", `/packs/${id}/files`, user, { path: "data/list.csv", text: "a,b\n" })).status).toBe(201);

    for (const [method, url, body] of [
      ["POST", `/packs/${id}/file`, { path: "tests/evil.ts", text: "export {};\n" }],
      ["POST", `/packs/${id}/files`, { path: "lib/x.js", text: "" }],
      ["POST", `/packs/${id}/file`, { path: "package.json", text: "{}" }],
      ["POST", `/packs/${id}/file/rename`, { from: "notes.txt", to: "tests/notes.ts" }],
    ] as const) {
      const r = await call(method, url, user, body);
      expect(r.status, url).toBe(403);
      expect(r.body.error?.code).toBe("code_admin_only");
    }
    expect((await call("POST", `/packs/${id}/convert`, user, { file: "tests/home.yaml" })).status).toBe(403);
    expect((await call("POST", `/packs/${id}/file`, admin, { path: "tests/ok.ts", text: "export {};\n" })).status).toBe(200);
    const del = await call("DELETE", `/packs/${id}/file?path=tests%2Fok.ts`, user);
    expect(del.body.error?.code).toBe("code_admin_only");
  });
});

describe("what YAML tests and recordings reach", () => {
  it("opens only web addresses", () => {
    expect(webAddress("/form", "http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000/form");
    expect(webAddress("https://example.com/x")).toBe("https://example.com/x");
    expect(webAddress("about:blank")).toBe("about:blank");
    for (const bad of ["file:///etc/passwd", "chrome://settings", "view-source:http://x/", "javascript:alert(1)"]) expect(() => webAddress(bad, "http://127.0.0.1:3000/"), bad).toThrow(/Only http/);
    expect(() => webAddress("/x")).toThrow(/web address/);
    // A pack whose base is a file address can't open its files either.
    expect(() => webAddress("passwd", "file:///etc/")).toThrow(/Only http/);
  });

  it("uploads only files inside the pack folder", () => {
    const dir = tempDir("ww-pack-");
    const outside = tempDir("ww-out-");
    writeFileSync(path.join(outside, "secret.txt"), "no");
    mkdirSync(path.join(dir, "files"));
    writeFileSync(path.join(dir, "files", "photo.txt"), "ok");
    symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
    expect(packFile(dir, "files/photo.txt")).toBe(path.join(dir, "files", "photo.txt"));
    for (const bad of [path.join(outside, "secret.txt"), `../${path.basename(outside)}/secret.txt`, "link.txt", "missing.txt"]) expect(() => packFile(dir, bad), bad).toThrow();
  });
});

describe("proposed changes", () => {
  it("lets a user propose code and an admin apply it after reading the diff", async () => {
    const { call, admin, user, other, dir, id, app } = await withPack();
    const seen: string[] = [];
    app.watchwright.events.subscribe((e) => void (e.type.startsWith("proposal.") && seen.push(e.type)));
    const read = await call("GET", `/packs/${id}/file?path=lib%2Fwait.ts`, user);
    const made = await call("POST", `/packs/${id}/proposals`, user, {
      note: "Wait longer",
      files: [
        { path: "lib/wait.ts", text: "export const WAIT = 500;\n", stamp: read.body.data!.stamp },
        { path: "lib/new.ts", text: "export {};\n", stamp: "" },
      ],
    });
    expect(made.status).toBe(201);
    const pid = String(made.body.data!.id);
    expect(made.body.data).toMatchObject({ status: "waiting", by: "uma", note: "Wait longer", paths: ["lib/new.ts", "lib/wait.ts"], packName: "Mixed" });
    expect(readFileSync(path.join(dir, "lib/wait.ts"), "utf8")).toBe("export const WAIT = 100;\n");

    const got = await call("GET", `/proposals/${pid}`, admin);
    expect(got.body.data!.files).toEqual([
      { path: "lib/new.ts", base: null, text: "export {};\n", current: null, changedSince: false },
      { path: "lib/wait.ts", base: "export const WAIT = 100;\n", text: "export const WAIT = 500;\n", current: "export const WAIT = 100;\n", changedSince: false },
    ]);
    expect((await call("GET", "/proposals?status=waiting", other)).body.data!.waiting).toBe(1);

    expect((await call("POST", `/proposals/${pid}/apply`, user, {})).status).toBe(403);
    expect((await call("DELETE", `/proposals/${pid}`, other)).status).toBe(403);
    const applied = await call("POST", `/proposals/${pid}/apply`, admin, { reply: "Thanks" });
    expect(applied.status).toBe(200);
    expect(applied.body.data!.proposal).toMatchObject({ status: "applied", answeredBy: "ada", reply: "Thanks" });
    expect(readFileSync(path.join(dir, "lib/wait.ts"), "utf8")).toBe("export const WAIT = 500;\n");
    expect(readFileSync(path.join(dir, "lib/new.ts"), "utf8")).toBe("export {};\n");
    expect((await call("POST", `/proposals/${pid}/decline`, admin, {})).body.error?.code).toBe("not_waiting");
    expect(seen).toEqual(["proposal.created", "proposal.applied"]);
  });

  it("won't apply over a file that moved on, unless asked to", async () => {
    const { call, admin, user, dir, id } = await withPack();
    const pid = String((await call("POST", `/packs/${id}/proposals`, user, { files: [{ path: "lib/wait.ts", text: "export const WAIT = 1;\n" }] })).body.data!.id);
    writeFileSync(path.join(dir, "lib/wait.ts"), "export const WAIT = 200;\n");
    expect((await call("GET", `/proposals/${pid}`, admin)).body.data!.files[0].changedSince).toBe(true);
    const stale = await call("POST", `/proposals/${pid}/apply`, admin, {});
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "stale", detail: { paths: ["lib/wait.ts"] } });
    expect((await call("POST", `/proposals/${pid}/apply`, admin, { force: true })).status).toBe(200);
    expect(readFileSync(path.join(dir, "lib/wait.ts"), "utf8")).toBe("export const WAIT = 1;\n");
  });

  it("refuses a stale or empty proposal, and lets its owner change or withdraw it", async () => {
    const { call, admin, user, id } = await withPack();
    expect((await call("POST", `/packs/${id}/proposals`, user, { files: [{ path: "lib/wait.ts", text: "x", stamp: "0000000000000000" }] })).body.error?.code).toBe("stale");
    expect((await call("POST", `/packs/${id}/proposals`, user, { files: [{ path: "lib/wait.ts", text: "export const WAIT = 100;\n" }] })).body.error?.message).toMatch(/Nothing to propose/);
    expect((await call("POST", `/packs/${id}/proposals`, user, { files: [{ path: "../out.ts", text: "x" }] })).status).toBe(400);
    const pid = String((await call("POST", `/packs/${id}/proposals`, user, { files: [{ path: "lib/wait.ts", delete: true }] })).body.data!.id);
    const changed = await call("POST", `/proposals/${pid}`, user, { note: "Not needed any more" });
    expect(changed.body.data).toMatchObject({ note: "Not needed any more", paths: ["lib/wait.ts"] });
    expect((await call("GET", `/proposals/${pid}`, admin)).body.data!.files[0]).toMatchObject({ text: null });
    expect((await call("DELETE", `/proposals/${pid}`, user)).body.data).toMatchObject({ status: "withdrawn" });
    const pid2 = String((await call("POST", `/packs/${id}/proposals`, user, { files: [{ path: "lib/wait.ts", text: "y" }] })).body.data!.id);
    expect((await call("POST", `/proposals/${pid2}/decline`, admin, { reply: "Keep 100" })).body.data).toMatchObject({ status: "declined", reply: "Keep 100" });
  });
});
