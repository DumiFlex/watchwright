import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { updateCommand, worker, type UpdateDeps, type UpdateIo } from "../src/cli/update.js";
import { currentUpdate, lockPath, removeLock, writeLock } from "../src/cli/update-lock.js";
import { howToUpdate, installKind, isNewer, latestVersion } from "../src/plugins/updates/install.js";
import { restartPlan, UPDATE_CHECKER, UpdateChecker, type UpdateStatus } from "../src/plugins/updates/plugin.js";
import { RUNS_REPO } from "../src/plugins/runs/plugin.js";
import { SETTINGS } from "../src/plugins/settings/plugin.js";
import { buildServer } from "../src/server/app.js";
import { openStore } from "../src/store/db.js";
import { VERSION } from "../src/version.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { freePort } from "./helpers/harness.js";

const closers: (() => Promise<void> | void)[] = [];
const envBefore = { ...process.env };
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
  process.env = { ...envBefore };
  cleanTempDirs();
});

/** A stand-in for npm's registry that answers `latest` with this version. */
async function fakeRegistry(version: string | null): Promise<string> {
  const server: Server = createServer((req, res) => {
    if (version === null || req.url !== "/watchwright/latest") {
      res.writeHead(404).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "watchwright", version }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => new Promise<void>((r) => server.close(() => r())));
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

async function server(opts: { latest?: string; stop?: () => void; env?: Record<string, string>; install?: "npm" } = {}) {
  Object.assign(process.env, opts.env ?? {});
  const dataDir = tempDir("ww-data-");
  const store = openStore(dataDir, migrationsOf(BUILTIN_PLUGINS));
  const lookups: string[] = [];
  const checker = new UpdateChecker(async () => {
    lookups.push("asked");
    if (!opts.latest) throw new Error("npm's registry didn't answer.");
    return opts.latest;
  }, opts.install ? () => "npm" : undefined);
  const port = await freePort();
  const app = await buildServer({ store, port, plugins: BUILTIN_PLUGINS, prepare: (ctx) => ctx.services.provide(UPDATE_CHECKER, checker), ...(opts.stop ? { stop: opts.stop } : {}) });
  closers.push(async () => {
    await app.close();
    store.close();
  });
  const api = async <T>(method: "GET" | "POST", url: string, body?: object) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` }, ...(body ? { payload: body } : {}) });
    const json = res.json() as { data?: T; error?: { code: string; message: string } };
    return { status: res.statusCode, data: json.data as T, error: json.error };
  };
  return { app, api, lookups, dataDir, port };
}

describe("versions and installs", () => {
  it("compares versions, a pre-release older than its release", () => {
    expect(isNewer("0.11.1", "0.12.0")).toBe(true);
    expect(isNewer("0.11.1", "0.11.1")).toBe(false);
    expect(isNewer("0.12.0", "0.11.9")).toBe(false);
    expect(isNewer("0.12.0-beta.1", "0.12.0")).toBe(true);
    expect(isNewer("0.12.0", "0.12.0-beta.1")).toBe(false);
    expect(isNewer("0.12.0-beta.2", "0.12.0-beta.10")).toBe(true);
    expect(isNewer("1.9.0", "1.10.0")).toBe(true);
  });

  it("tells a global npm install from Docker, npx and the rest", () => {
    const root = tempDir("ww-global-");
    const pkg = path.join(root, "watchwright");
    expect(installKind({ env: { WATCHWRIGHT_INSTALL: "docker" }, root: pkg, globalRoot: () => root })).toBe("docker");
    expect(installKind({ env: {}, root: path.join(root, "_npx", "abc", "node_modules", "watchwright"), globalRoot: () => root })).toBe("npx");
    expect(installKind({ env: {}, root: pkg, globalRoot: () => root })).toBe("npm");
    expect(installKind({ env: {}, root: path.join(root, "project", "node_modules", "watchwright"), globalRoot: () => root })).toBe("other");
    expect(installKind({ env: {}, root: pkg, globalRoot: () => null })).toBe("other");
    expect(howToUpdate("docker")).toContain("Re-pull image");
    expect(howToUpdate("docker")).toContain("docker compose pull");
  });

  it("asks the registry for the latest version, and says when it doesn't answer", async () => {
    expect(await latestVersion({ WATCHWRIGHT_NPM_REGISTRY: await fakeRegistry("0.12.0") })).toBe("0.12.0");
    await expect(latestVersion({ WATCHWRIGHT_NPM_REGISTRY: await fakeRegistry(null) })).rejects.toThrow(/answered 404 without a version/);
    await expect(latestVersion({ WATCHWRIGHT_NPM_REGISTRY: `http://127.0.0.1:${await freePort()}` }, 2000)).rejects.toThrow(/didn't answer/);
  });

  it("starts the server again with its own options, at an address it answers here", () => {
    expect(restartPlan(["serve", "C:/packs/a", "--port", "7500", "--host", "0.0.0.0", "--auth", "--background"], {})).toEqual({
      args: ["C:/packs/a", "--port", "7500", "--host", "0.0.0.0", "--auth"],
      url: "http://127.0.0.1:7500/",
    });
    expect(restartPlan(["demo", "--no-open"], {})).toEqual({ args: ["--no-open"], url: "http://127.0.0.1:7420/" });
    expect(restartPlan(["serve", "--port=7600"], { WATCHWRIGHT_HOST: "::1" }).url).toBe("http://[::1]:7600/");
  });
});

describe("the updates plugin", () => {
  it("says a newer version is out and, in Docker, how to update instead of updating", async () => {
    const s = await server({ latest: "99.0.0", env: { WATCHWRIGHT_INSTALL: "docker" } });
    const res = await s.api<UpdateStatus>("GET", "/updates");
    expect(res.data).toMatchObject({ version: VERSION, latest: "99.0.0", newer: true, install: "docker", canUpdate: false, check: true, last: null });
    expect(res.data.how).toContain("Update the stack");
    const start = await s.api("POST", "/updates", {});
    expect(start.status).toBe(409);
    expect(start.error?.code).toBe("cant_update");
  });

  it("asks npm once on its own and again when told to; not at all with the check off", async () => {
    const s = await server({ latest: VERSION, env: { WATCHWRIGHT_INSTALL: "docker" } });
    expect((await s.api<UpdateStatus>("GET", "/updates")).data.newer).toBe(false);
    await s.api("GET", "/updates");
    expect(s.lookups).toHaveLength(1);
    await s.api("GET", "/updates?refresh=true");
    expect(s.lookups).toHaveLength(2);

    const off = await server({ latest: "99.0.0", env: { WATCHWRIGHT_INSTALL: "docker" } });
    off.app.watchwright.services.get(SETTINGS).set({ "updates.check": false });
    const res = await off.api<UpdateStatus>("GET", "/updates");
    expect(res.data).toMatchObject({ latest: null, newer: false, check: false });
    expect(off.lookups).toHaveLength(0);
  });

  it("says why a check failed", async () => {
    const s = await server({ env: { WATCHWRIGHT_INSTALL: "docker" } });
    const res = await s.api<UpdateStatus>("GET", "/updates");
    expect(res.data.error).toContain("didn't answer");
    expect(res.data.checkedAt).not.toBeNull();
  });

  it("can't update a server it can't stop and start again", async () => {
    const s = await server({ latest: "99.0.0" });
    const res = await s.api<UpdateStatus>("GET", "/updates");
    expect(res.data.canUpdate).toBe(false);
    expect((await s.api("POST", "/updates", {})).error?.code).toBe("cant_update");
  });

  it("doesn't update while runs go unless told to go ahead", async () => {
    let stopped = 0;
    const s = await server({ latest: "99.0.0", install: "npm", stop: () => stopped++ });
    expect((await s.api<UpdateStatus>("GET", "/updates")).data).toMatchObject({ canUpdate: true, install: "npm" });
    s.app.watchwright.services.get(RUNS_REPO).insertRun({ id: "0000abcd", pack_id: "0000beef", pack_name: "Shop", pack_path: s.dataDir, site_key: "shop", job_kind: "test", tests: "[]", params: "{}", options: "{}", status: "running", started_by: "web", created_at: new Date().toISOString() });
    const res = await s.api("POST", "/updates", {});
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("runs_going");
    expect(res.error?.message).toContain("A run is going");
    expect(stopped).toBe(0);
  });

  it("shows how the last update went", async () => {
    const s = await server({ latest: "99.0.0", env: { WATCHWRIGHT_INSTALL: "docker" } });
    const io = quietIo();
    await worker({ pid: 0, from: "0.11.1", to: "0.12.0", url: "", data: s.dataDir, restart: undefined }, io, deps({ code: 1 }));
    const res = await s.api<UpdateStatus>("GET", "/updates");
    expect(res.data.last).toMatchObject({ from: "0.11.1", to: "0.12.0", ok: false });
    expect(res.data.last?.message).toContain("npm install failed");
  });
});

function quietIo(answer: boolean | null = true): UpdateIo & { said: string[] } {
  const said: string[] = [];
  return { said, out: (s) => said.push(s), err: (s) => said.push(s), confirm: async () => answer };
}

function deps(o: { code?: number; latest?: string; kind?: "npm" | "docker" | "npx" | "other" } = {}): UpdateDeps & { installs: string[] } {
  const installs: string[] = [];
  return {
    installs,
    install: () => o.kind ?? "npm",
    latest: async () => o.latest ?? "99.0.0",
    npmInstall: async (v) => {
      installs.push(v);
      // The update is going on while npm runs.
      expect(currentUpdate()).not.toBeNull();
      return o.code ?? 0;
    },
    backWithinMs: 2000,
  };
}

describe("watchwright update", () => {
  it("with no server running, runs npm itself and leaves no note behind", async () => {
    process.env.WATCHWRIGHT_CONFIG_DIR = tempDir("ww-config-");
    const io = quietIo();
    const d = deps();
    expect(await updateCommand(["--server", String(await freePort())], io, d)).toBe(0);
    expect(d.installs).toEqual(["99.0.0"]);
    expect(io.said.join("\n")).toContain("99.0.0 is installed");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("says what to do for installs npm doesn't own, and nothing when it is up to date", async () => {
    process.env.WATCHWRIGHT_CONFIG_DIR = tempDir("ww-config-");
    const port = String(await freePort());
    const docker = quietIo();
    expect(await updateCommand(["--server", port], docker, deps({ kind: "docker" }))).toBe(1);
    expect(docker.said.join("\n")).toContain("docker compose pull");
    const same = quietIo();
    const d = deps({ latest: VERSION });
    expect(await updateCommand(["--server", port], same, d)).toBe(0);
    expect(same.said.join("\n")).toContain("Nothing to update");
    const check = quietIo();
    expect(await updateCommand(["--server", port, "--check"], check, deps())).toBe(0);
    expect(d.installs).toEqual([]);
  });

  it("asks the running server to update itself; a Docker one says how instead", async () => {
    process.env.WATCHWRIGHT_CONFIG_DIR = tempDir("ww-config-");
    const s = await server({ latest: "99.0.0", env: { WATCHWRIGHT_INSTALL: "docker" } });
    const port = s.port;
    await s.app.listen({ port, host: "127.0.0.1" });
    const io = quietIo();
    expect(await updateCommand(["--server", String(port), "--yes"], io, deps())).toBe(1);
    // The server here is a Docker one, so it says how instead.
    expect(io.said.join("\n")).toContain("Re-pull image");
    const no = quietIo(null);
    expect(await updateCommand(["--server", String(port)], no, deps())).toBe(2);
    expect(no.said.join("\n")).toContain("--yes");
  });

  it("the worker installs, tries npm once more when it fails, and writes how it went", async () => {
    process.env.WATCHWRIGHT_CONFIG_DIR = tempDir("ww-config-");
    const data = tempDir("ww-data-");
    const io = quietIo();
    const d = deps({ code: 1 });
    expect(await worker({ pid: 0, from: "0.11.1", to: "0.12.0", url: "", data, restart: undefined }, io, d)).toBe(1);
    expect(d.installs).toEqual(["0.12.0", "0.12.0"]);
    const ok = deps();
    expect(await worker({ pid: 0, from: "0.11.1", to: "0.12.0", url: "", data, restart: undefined }, io, ok)).toBe(0);
    expect(JSON.parse(readFileSync(path.join(data, "logs", "update.json"), "utf8"))).toMatchObject({ ok: true, to: "0.12.0" });
    expect(currentUpdate()).toBeNull();
  }, 20_000);

  it("forgets a note whose process is gone", () => {
    process.env.WATCHWRIGHT_CONFIG_DIR = tempDir("ww-config-");
    writeLock({ pid: process.pid, from: "a", to: "b", startedAt: new Date().toISOString() });
    expect(currentUpdate()).not.toBeNull();
    writeLock({ pid: 2 ** 22 + 12345, from: "a", to: "b", startedAt: new Date().toISOString() });
    expect(currentUpdate()).toBeNull();
    writeLock({ pid: process.pid, from: "a", to: "b", startedAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(currentUpdate()).toBeNull();
    removeLock();
  });
});
