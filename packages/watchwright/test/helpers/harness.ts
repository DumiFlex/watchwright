import { existsSync } from "node:fs";
import { createServer as netServer } from "node:net";
import type { FastifyInstance } from "fastify";
import { chromium, firefox } from "playwright";
import { BUILTIN_PLUGINS } from "../../src/core/builtin.js";
import { migrationsOf } from "../../src/core/plugin.js";
import type { WwEvent } from "../../src/events/log.js";
import { ENGINE } from "../../src/plugins/runs/plugin.js";
import { buildServer } from "../../src/server/app.js";
import { openStore } from "../../src/store/db.js";

// A real server on a temp data folder, for engine tests.

export const hasChromium = existsSync(chromium.executablePath());
export const hasFirefox = existsSync(firefox.executablePath());
/** CI sets this so missing browsers fail the run instead of skipping the engine tests. */
export const requireBrowsers = process.env.WATCHWRIGHT_REQUIRE_BROWSERS === "1";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = netServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

export interface Harness {
  app: FastifyInstance;
  port: number;
  host: string;
  api<T = unknown>(method: "GET" | "POST" | "DELETE", url: string, body?: unknown): Promise<{ status: number; data: T; error?: { code: string; message: string; detail?: unknown } }>;
  /** Waits for the first event after `after` (default: the start) that matches. */
  waitFor(match: (e: WwEvent) => boolean, timeoutMs?: number, after?: number): Promise<WwEvent>;
  close(): Promise<void>;
}

export async function startHarness(dataDir: string, opts: { listen?: boolean } = {}): Promise<Harness> {
  const port = await freePort();
  const store = openStore(dataDir, migrationsOf(BUILTIN_PLUGINS));
  const app = await buildServer({ store, port, plugins: BUILTIN_PLUGINS });
  if (opts.listen) await app.listen({ port, host: "127.0.0.1" });
  const host = `127.0.0.1:${port}`;
  let closed = false;
  return {
    app,
    port,
    host,
    async api(method, url, body) {
      const res = await app.inject({ method, url: `/api/v1${url}`, headers: { host }, ...(body === undefined ? {} : { payload: body as object }) });
      const json = res.json() as { data?: never; error?: { code: string; message: string; detail?: unknown } };
      return { status: res.statusCode, data: json.data as never, ...(json.error ? { error: json.error } : {}) };
    },
    async waitFor(match, timeoutMs = 30_000, after = 0) {
      const { events } = app.watchwright;
      const end = Date.now() + timeoutMs;
      let cursor = after;
      for (;;) {
        const left = end - Date.now();
        if (left <= 0) throw new Error(`Timed out waiting for an event. Last events: ${JSON.stringify(events.after(Math.max(0, events.head() - 8)).map((e) => [e.type, e.data]))}`);
        const list = await events.wait(cursor, Math.min(left, 1000));
        for (const e of list) {
          if (match(e)) return e;
          cursor = e.seq;
        }
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      store.close();
    },
  };
}

export function engineOf(h: Harness) {
  return h.app.watchwright.services.get(ENGINE);
}
