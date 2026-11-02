import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { checkActions, mountActions, type Action } from "../actions/registry.js";
import { BUILTIN_PLUGINS } from "../core/builtin.js";
import { checkPlugins, pagesOf, type PluginContext, type WatchwrightPlugin } from "../core/plugin.js";
import { randomBytes } from "node:crypto";
import { ACCESS_LEVELS, allows, refusal, type Access, type CallUser } from "../core/access.js";
import { ACTION_GATE, ACTIONS, LOGIN, LOGIN_OPTIONS, PAGES, SERVER_PORT } from "../core/keys.js";
import { withAccess } from "../core/route-access.js";
import { Services } from "../core/services.js";
import { EventLog } from "../events/log.js";
import type { Store } from "../store/db.js";
import { errorBody, type ErrorBody } from "./errors.js";
import { isAllowedHost, isAllowedOrigin, needsOriginCheck, publicAddresses } from "./guard.js";

export const API_PREFIX = "/api/v1";

const isApi = (url: string) => url === API_PREFIX || url.startsWith(`${API_PREFIX}/`) || url.startsWith(`${API_PREFIX}?`);

export interface ServerOptions {
  store: Store;
  /** The port the server listens on; the request guard only accepts this port in Host and Origin. */
  port: number;
  /** Folder with the built web app (index.html + assets). Missing: the API still works. */
  webRoot?: string | undefined;
  /** Plugins to mount, in order (default: the built-in ones). The store must hold their migrations. */
  plugins?: readonly WatchwrightPlugin[];
  logger?: boolean;
  /** Called with the plugin context before plugins are set up (tests use it to provide services). */
  prepare?: (ctx: PluginContext) => void;
  /** Shuts the process down, for `POST /stop` (the CLI's own shutdown). Without it the server can't stop itself. */
  stop?: () => void;
  /** Login on: every request needs a session or a token, except `public` routes. Needs the auth plugin. */
  login?: boolean;
  /** Addresses people reach the server at (`https://watchwright.home.lan`): the request guard allows their hosts and origins. */
  publicUrls?: readonly string[];
  /** Proxies whose X-Forwarded-* headers count (addresses or CIDR ranges), for --trust-proxy. */
  trustProxy?: readonly string[];
}

declare module "fastify" {
  interface FastifyInstance {
    /** The plugin context: store, event log and services. */
    watchwright: PluginContext;
    /**
     * Headers for the server's own requests through `inject` (adding packs at start, the demo):
     * they count as the server itself, which login lets through. The key is new on every start.
     */
    internalHeaders: Record<string, string>;
    /** Every route with the access level it declares (for the route inventory test and docs). */
    watchwrightRoutes: { method: string; url: string; access: Access | undefined }[];
  }
  interface FastifyRequest {
    /** Who is signed in: undefined when login is off (or the server calls itself), null when nobody is. */
    watchwrightUser?: CallUser | null;
  }
  interface FastifyContextConfig {
    /** Who may call this route when login is on (docs/plans/self-hosting.md, section 2.5). */
    access?: Access;
  }
}

const INTERNAL_HEADER = "x-watchwright-internal";

export async function buildServer({ store, port, webRoot, plugins = BUILTIN_PLUGINS, logger = false, prepare, stop, login = false, publicUrls = [], trustProxy = [] }: ServerOptions): Promise<FastifyInstance> {
  checkPlugins(plugins);
  const extra = publicAddresses(publicUrls);
  const app = Fastify({ logger, ...(trustProxy.length > 0 ? { trustProxy: [...trustProxy] } : {}) });
  const internalKey = randomBytes(24).toString("base64url");
  app.decorate("internalHeaders", { [INTERNAL_HEADER]: internalKey });
  const routeList: FastifyInstance["watchwrightRoutes"] = [];
  app.decorate("watchwrightRoutes", routeList);
  app.addHook("onRoute", (r) => {
    // Read later: a scope's own onRoute hook (withAccess) sets the level after this one runs.
    for (const method of [r.method].flat())
      routeList.push({
        method,
        url: r.url,
        get access() {
          return (r.config as { access?: Access } | undefined)?.access;
        },
      });
  });

  app.addHook("onRequest", async (req, reply) => {
    const upgrade = (req.headers.upgrade ?? "").toLowerCase() === "websocket";
    let refused: ErrorBody | null = null;
    let status = 403;
    if (!isAllowedHost(req.headers.host, port, extra)) {
      refused = errorBody("bad_host", extra.hosts.length > 0 ? "Requests must use this server's address." : "Requests must use 127.0.0.1, localhost or [::1] with this server's port.");
    } else if (needsOriginCheck(req.method, upgrade) && !isAllowedOrigin(req.headers.origin, port, extra)) {
      refused = errorBody("bad_origin", "Requests that change something must come from this server's own page.");
    } else if (login && isApi(req.url)) {
      const no = checkLogin(req);
      if (no) {
        refused = errorBody(no.code, no.message);
        status = no.status;
      }
    }
    if (!refused) {
      // An empty body is no body, whatever type it says it is (PowerShell and `curl -d ""` send a form type).
      const length = req.headers["content-length"];
      if (length === "0" || (length === undefined && req.headers["transfer-encoding"] === undefined)) delete req.headers["content-type"];
      return;
    }
    if (!upgrade) return reply.code(status).send(refused);
    // A refused upgrade gets a plain HTTP answer on the raw socket, which is then closed;
    // answering through `reply` leaves the socket open and blocks server shutdown.
    reply.hijack();
    const json = JSON.stringify(refused);
    req.raw.socket.end(
      `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\nConnection: close\r\n\r\n${json}`,
    );
    return reply;
  });

  app.setErrorHandler((err: { statusCode?: number; code?: string; message: string; validation?: unknown }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (err.validation) return reply.code(400).send(errorBody("invalid_input", err.message));
    const code = err.code && /^[a-z_]+$/.test(err.code) ? err.code : status === 500 ? "internal" : "bad_request";
    return reply.code(status).send(errorBody(code, err.message));
  });

  await app.register(fastifyWebsocket);

  const ctx: PluginContext = { store, plugins: plugins.map((p) => p.name), events: new EventLog(store.db), services: new Services(), stop: stop ?? null };
  ctx.services.provide(LOGIN_OPTIONS, { on: login, publicUrls: [...publicUrls] });
  ctx.services.provide(PAGES, pagesOf(plugins));
  ctx.services.provide(SERVER_PORT, port);
  prepare?.(ctx);
  app.decorate("watchwright", ctx);
  for (const plugin of plugins) await plugin.setup?.(ctx);
  if (login && !ctx.services.has(LOGIN)) throw new Error("Login needs the auth plugin, which isn't loaded.");
  const who = login ? ctx.services.get(LOGIN) : null;

  /** Who the request comes from (on the request), and why it can't go on, if it can't. */
  function checkLogin(req: FastifyRequest): { status: number; code: string; message: string } | null {
    if (req.headers[INTERNAL_HEADER] === internalKey) return null;
    const user = who!.identify({ cookie: req.headers.cookie, authorization: req.headers.authorization });
    req.watchwrightUser = user;
    const access = req.routeOptions.config.access;
    // A route that matched nothing is answered as unknown; one that matched must say who may call it.
    if (req.routeOptions.url === undefined) return null;
    if (access === undefined || !ACCESS_LEVELS.includes(access)) return { status: 403, code: "no_access_level", message: `The route ${req.routeOptions.url} doesn't say who may call it, so nobody may while login is on.` };
    return allows(access, user) ? null : refusal(access, user);
  }
  for (const plugin of plugins) await plugin.ready?.(ctx);
  app.addHook("onClose", async () => {
    for (const plugin of [...plugins].reverse()) await plugin.close?.(ctx);
  });

  const actions: Action[] = plugins.flatMap((p) => p.actions?.(ctx) ?? []);
  checkActions(actions);
  ctx.services.provide(ACTIONS, actions);
  await app.register(async (scope) => mountActions(scope, actions, () => (ctx.services.has(ACTION_GATE) ? ctx.services.get(ACTION_GATE) : null)), { prefix: API_PREFIX });
  for (const plugin of plugins) {
    const { routes } = plugin;
    if (routes) await app.register(async (scope) => routes(scope, ctx), { prefix: API_PREFIX });
  }

  const hasWeb = webRoot !== undefined && existsSync(path.join(webRoot, "index.html"));
  // wildcard: files are looked up per request, so a rebuilt web app is served without a restart.
  if (hasWeb) await withAccess(app, "public", (scope) => scope.register(fastifyStatic, { root: webRoot, wildcard: true }));

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
