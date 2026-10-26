import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { BUILTIN_PLUGINS } from "../core/core-plugin.js";
import { checkPlugins, type WatchwrightPlugin } from "../core/plugin.js";
import type { Store } from "../store/db.js";
import { errorBody, type ErrorBody } from "./errors.js";
import { isAllowedHost, isAllowedOrigin, needsOriginCheck } from "./guard.js";

export const API_PREFIX = "/api/v1";

export interface ServerOptions {
  store: Store;
  /** The port the server listens on; the request guard only accepts this port in Host and Origin. */
  port: number;
  /** Folder with the built web app (index.html + assets). Missing: the API still works. */
  webRoot?: string | undefined;
  /** Plugins to mount, in order (default: the built-in ones). The store must hold their migrations. */
  plugins?: readonly WatchwrightPlugin[];
  logger?: boolean;
}

export async function buildServer({ store, port, webRoot, plugins = BUILTIN_PLUGINS, logger = false }: ServerOptions): Promise<FastifyInstance> {
  checkPlugins(plugins);
  const app = Fastify({ logger });

  app.addHook("onRequest", async (req, reply) => {
    const upgrade = (req.headers.upgrade ?? "").toLowerCase() === "websocket";
    let refused: ErrorBody | null = null;
    if (!isAllowedHost(req.headers.host, port)) {
      refused = errorBody("bad_host", "Requests must use 127.0.0.1, localhost or [::1] with this server's port.");
    } else if (needsOriginCheck(req.method, upgrade) && !isAllowedOrigin(req.headers.origin, port)) {
      refused = errorBody("bad_origin", "Requests that change something must come from this server's own page.");
    }
    if (!refused) return;
    if (!upgrade) return reply.code(403).send(refused);
    // A refused upgrade gets a plain HTTP answer on the raw socket, which is then closed;
    // answering through `reply` leaves the socket open and blocks server shutdown.
    reply.hijack();
    const json = JSON.stringify(refused);
    req.raw.socket.end(
      `HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\nConnection: close\r\n\r\n${json}`,
    );
    return reply;
  });

  app.setErrorHandler((err: { statusCode?: number; code?: string; message: string }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send(errorBody(err.code ?? (status === 500 ? "internal" : "bad_request"), err.message));
  });

  await app.register(fastifyWebsocket);

  const names = plugins.map((p) => p.name);
  for (const plugin of plugins) {
    const { routes } = plugin;
    if (routes) await app.register(async (scope) => routes(scope, { store, plugins: names }), { prefix: API_PREFIX });
  }

  const hasWeb = webRoot !== undefined && existsSync(path.join(webRoot, "index.html"));
  if (hasWeb) await app.register(fastifyStatic, { root: webRoot, wildcard: false });

  // Registered after every API route: unknown API paths get a JSON error, anything else is the web app.
  app.setNotFoundHandler((req, reply) => {
    if (req.url === API_PREFIX || req.url.startsWith(`${API_PREFIX}/`)) {
      return reply.code(404).send(errorBody("not_found", `No API route ${req.method} ${req.url.split("?")[0]}`));
    }
    if (hasWeb && req.method === "GET") return reply.sendFile("index.html");
    return reply.code(404).type("text/plain").send("The web app isn't built. Run `pnpm build`, or `pnpm dev` for the dev server.");
  });

  return app;
}
