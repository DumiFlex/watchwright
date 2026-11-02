import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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
    return { status: res.statusCode, body: res.json() as { data?: Record<string, unknown>; error?: { code: string; message: string } } };
  };
  const signIn = async (name: string) => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signin", headers: { host: HOST, origin: `http://${HOST}` }, payload: { name, password: PASSWORD } });
    return String(res.headers["set-cookie"]).split(";")[0]!;
  };
  return { auth, call, signIn };
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
