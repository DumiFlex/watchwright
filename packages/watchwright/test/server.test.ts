import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { definePlugin, migrationsOf, type WatchwrightPlugin } from "../src/core/plugin.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";
import { VERSION } from "../src/version.js";

const PORT = 7420;
const HOST = `127.0.0.1:${PORT}`;
const open: { app: FastifyInstance; store: Store }[] = [];
const dirs: string[] = [];

async function make(opts: { webRoot?: string; port?: number; plugins?: WatchwrightPlugin[] } = {}) {
  const plugins = opts.plugins ?? BUILTIN_PLUGINS;
  const store = openStore(":memory:", migrationsOf(plugins));
  const app = await buildServer({ store, port: opts.port ?? PORT, webRoot: opts.webRoot, plugins });
  open.push({ app, store });
  return app;
}

afterEach(async () => {
  for (const { app, store } of open.splice(0)) {
    await app.close();
    store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

describe("server", () => {
  it("answers /api/v1/health", async () => {
    const app = await make();
    const res = await app.inject({ url: "/api/v1/health", headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        name: "watchwright",
        version: VERSION,
        dataDir: ":memory:",
        plugins: [
          { name: "core", schemaVersion: 2 },
          { name: "settings", schemaVersion: 1 },
          { name: "live", schemaVersion: 0 },
          { name: "folders", schemaVersion: 1 },
          { name: "packs", schemaVersion: 1 },
          { name: "runs", schemaVersion: 4 },
          { name: "reviews", schemaVersion: 1 },
        ],
      },
    });
  });

  it("refuses a foreign Host header", async () => {
    const app = await make();
    const res = await app.inject({ url: "/api/v1/health", headers: { host: "rebind.example:7420" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("bad_host");
  });

  it("mounts a plugin's routes and migrations next to the core", async () => {
    const notes = definePlugin({
      name: "notes",
      migrations: [{ id: 1, name: "init", sql: "CREATE TABLE notes_items (id INTEGER PRIMARY KEY, text TEXT NOT NULL);" }],
      routes(app, { store }) {
        app.get("/notes", async () => ({ data: store.db.prepare("SELECT text FROM notes_items").all() }));
      },
    });
    const app = await make({ plugins: [...BUILTIN_PLUGINS, notes] });
    const res = await app.inject({ url: "/api/v1/notes", headers: { host: HOST } });
    expect(res.json()).toEqual({ data: [] });
    const health = await app.inject({ url: "/api/v1/health", headers: { host: HOST } });
    expect(health.json().data.plugins.at(-1)).toEqual({ name: "notes", schemaVersion: 1 });
  });

  it("refuses badly named or duplicate plugins", async () => {
    await expect(make({ plugins: [...BUILTIN_PLUGINS, definePlugin({ name: "Bad Name" })] })).rejects.toThrow(/lowercase/);
    await expect(make({ plugins: [...BUILTIN_PLUGINS, definePlugin({ name: "core" })] })).rejects.toThrow(/Two plugins/);
  });

  it("refuses a change from another origin", async () => {
    const app = await make();
    const res = await app.inject({ method: "POST", url: "/api/v1/health", headers: { host: HOST, origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("bad_origin");
  });

  it("answers unknown API routes with the error envelope", async () => {
    const app = await make();
    const res = await app.inject({ url: "/api/v1/nope?x=1", headers: { host: HOST } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "not_found", message: "No API route GET /api/v1/nope" } });
  });

  it("serves the web app and falls back to index.html for app routes", async () => {
    const webRoot = mkdtempSync(path.join(tmpdir(), "ww-web-"));
    dirs.push(webRoot);
    writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>Watchwright</title>");
    mkdirSync(path.join(webRoot, "assets"));
    writeFileSync(path.join(webRoot, "assets", "app.js"), "console.info('hi')");
    const app = await make({ webRoot });
    const asset = await app.inject({ url: "/assets/app.js", headers: { host: HOST } });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("hi");
    const route = await app.inject({ url: "/runs/123", headers: { host: HOST } });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain("<title>Watchwright</title>");
  });

  it("says how to build when the web app is missing", async () => {
    const app = await make({ webRoot: path.join(tmpdir(), "ww-does-not-exist") });
    const res = await app.inject({ url: "/", headers: { host: HOST } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("pnpm build");
  });

  it("greets on the live WebSocket and refuses other origins", async () => {
    const port = await freePort();
    const app = await make({ port });
    await app.listen({ port, host: "127.0.0.1" });
    const url = `ws://127.0.0.1:${port}/api/v1/live`;

    const hello = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(url, { origin: `http://127.0.0.1:${port}` });
      ws.once("message", (msg) => {
        resolve(JSON.parse(String(msg)));
        ws.close();
      });
      ws.once("error", reject);
    });
    expect(hello).toEqual({ type: "hello", data: { version: VERSION, head: 0 } });

    const refused = (opts: WebSocket.ClientOptions) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url, opts);
        ws.once("unexpected-response", (req, res) => {
          resolve(res.statusCode ?? 0);
          req.destroy();
        });
        ws.once("open", () => resolve(101));
      });
    expect(await refused({ origin: "https://evil.example" })).toBe(403);
    expect(await refused({ headers: { host: `rebind.example:${port}` } })).toBe(403);
  });
});
