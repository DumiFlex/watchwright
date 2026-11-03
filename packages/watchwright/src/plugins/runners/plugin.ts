import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { ActionError, defineAction } from "../../actions/registry.js";
import { LOGIN_OPTIONS, SERVER_PORT } from "../../core/keys.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { errorBody } from "../../server/errors.js";
import { VERSION } from "../../version.js";
import { DEFAULT_ALLOW, parseAllow } from "./allow.js";
import { RunnerHub, type RunnerProxy, type RunnerStatus } from "./hub.js";
import type { Control } from "./protocol.js";
import { PAIR_MINUTES, RUNNERS_SERVICE_SQL, RUNNERS_SQL, RunnersStore, type RunnerInfo } from "./store.js";

// Runners (docs/plans/self-hosting.md, section 6): a server in Docker or on another machine can't
// reach a site that only listens on someone's PC. `watchwright runner` on that PC connects out to
// the server, and runs that pick it (run option `network`, pack field `site.network`) send their
// browser's connections through it. Only what the PC's own allow list names can be opened.

export interface Runners {
  store: RunnersStore;
  hub: RunnerHub;
  /** A runner by name or id, with whether it is connected now. */
  find(nameOrId: string): (RunnerInfo & RunnerStatus) | null;
  /** A proxy for one run through the named runner; throws when there is no such runner or it is offline. */
  proxy(nameOrId: string, onRefused: (message: string) => void): Promise<RunnerProxy>;
}

export const RUNNERS = serviceKey<Runners>("runners.service");

export class RunnerUnavailable extends Error {}

const NAME = { type: "string", minLength: 1, maxLength: 60, pattern: "^[^\\x00-\\x1f]+$", description: "A name people recognise, like Office PC; runs pick the runner by it." } as const;
const ID = { type: "string", pattern: "^[0-9a-f]{8}$" } as const;
const SERVER = { type: "string", maxLength: 300, description: "The address the runner reaches this server at, for the command (default: the server's public URL)." } as const;

/** What to run on a runner's machine to remove it there by hand. */
const UNINSTALL = "npx watchwright runner uninstall --forget";

/** Pair attempts one address may make in a minute: a code is 9 characters of 30, so guessing is hopeless anyway. */
const PAIR_PER_MINUTE = 20;
/** The runner has this long to send `auth` after connecting. */
const AUTH_MS = 10_000;

export const runnersPlugin = definePlugin({
  name: "runners",
  migrations: [
    { id: 1, name: "init", sql: RUNNERS_SQL },
    { id: 2, name: "service", sql: RUNNERS_SERVICE_SQL },
  ],
  setup({ store, events, services }) {
    const s = new RunnersStore(store.db);
    const hub = new RunnerHub(events);
    const find = (key: string) => {
      const r = s.get(key);
      return r ? { ...r, ...hub.status(r.id) } : null;
    };
    services.provide(RUNNERS, {
      store: s,
      hub,
      find,
      async proxy(key, onRefused) {
        const r = find(key);
        if (!r) throw new RunnerUnavailable(`No runner "${key}". Add one in Admin › Runners.`);
        if (!r.online) throw new RunnerUnavailable(`The runner "${r.name}" is offline. Start it on its machine with: watchwright runner`);
        return hub.proxy(r.id, onRefused);
      },
    });
  },
  close({ services }) {
    services.get(RUNNERS).hub.close();
  },
  actions: ({ services }) => {
    const runners = () => services.get(RUNNERS);
    /** The commands that pair a runner, with the server's address: in a terminal, and set up to start by itself. */
    const commands = (code: string, server: string | undefined) => {
      const opts = services.get(LOGIN_OPTIONS);
      const port = services.has(SERVER_PORT) ? services.get(SERVER_PORT) : 7420;
      const base = (server?.trim() || opts.publicUrls[0] || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
      return {
        command: `npx watchwright@${VERSION} runner --server ${base} --pair ${code}`,
        installCommand: `npx watchwright@${VERSION} runner install --server ${base} --pair ${code}`,
      };
    };
    const out = (r: RunnerInfo) => ({ ...r, ...runners().hub.status(r.id) });
    return [
      defineAction({
        name: "runners.list",
        pack: "none",
        title: "The runners (machines runs can reach sites from), with whether each is connected now",
        method: "GET",
        path: "/runners",
        handler: () => runners().store.list().map(out),
      }),
      defineAction<{ name: string; allow?: string; server?: string }>({
        name: "runners.add",
        pack: "none",
        title: "Add a runner: answers a pair code and the command to run on that machine (the code works once, for 15 minutes)",
        method: "POST",
        path: "/runners",
        status: 201,
        input: {
          type: "object",
          properties: {
            name: NAME,
            allow: { type: "string", maxLength: 1000, description: "What it may open on its machine: loopback (any port on localhost, the default), host:port or host:*, separated by commas. The machine can narrow it." },
            server: SERVER,
          },
          required: ["name"],
        },
        handler: ({ name, allow, server }, call) => {
          const n = name.trim();
          if (!n) throw new ActionError("bad_input", "Give the runner a name.", 400);
          let list: string[];
          try {
            list = allow === undefined ? [...DEFAULT_ALLOW] : parseAllow(allow);
          } catch (err) {
            throw new ActionError("bad_input", err instanceof Error ? err.message : String(err), 400);
          }
          if (runners().store.get(n)) throw new ActionError("exists", `There is already a runner called ${n}.`, 409);
          const r = runners().store.add(n, list, call.user?.name ?? call.client);
          const pair = runners().store.pairCode(r.id);
          return { runner: out(r), ...pair, minutes: PAIR_MINUTES, ...commands(pair.code, server) };
        },
      }),
      defineAction<{ id: string; server?: string }>({
        name: "runners.pair-code",
        pack: "none",
        title: "A new pair code for a runner, to set it up on another machine or again (its current token keeps working until the code is used)",
        method: "POST",
        path: "/runners/:id/pair-code",
        input: { type: "object", properties: { id: ID, server: SERVER }, required: ["id"] },
        handler: ({ id, server }) => {
          const r = runners().store.get(id);
          if (!r) throw new ActionError("not_found", `No runner ${id}.`, 404);
          const pair = runners().store.pairCode(r.id);
          return { runner: out(r), ...pair, minutes: PAIR_MINUTES, ...commands(pair.code, server) };
        },
      }),
      defineAction<{ id: string }>({
        name: "runners.remove",
        pack: "none",
        title: "Remove a runner: it disconnects and its token stops working; a connected runner also removes itself from its machine (its token there and its start-up entry)",
        method: "DELETE",
        path: "/runners/:id",
        destructive: true,
        explain: ({ id }) => `Remove the runner ${runners().store.get(id)?.name ?? id}`,
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: async ({ id }) => {
          if (!runners().store.remove(id)) throw new ActionError("not_found", `No runner ${id}.`, 404);
          const { online, cleaned } = await runners().hub.drop(id);
          return { removed: id, online, cleaned, uninstallCommand: UNINSTALL };
        },
      }),
    ];
  },
  routes(app, { services }) {
    const { store, hub } = services.get(RUNNERS);

    const hits = new Map<string, { n: number; at: number }>();
    const limited = (req: FastifyRequest, reply: FastifyReply): boolean => {
      const now = Date.now();
      const h = hits.get(req.ip);
      if (!h || now - h.at > 60_000) {
        if (hits.size > 10_000) hits.clear();
        hits.set(req.ip, { n: 1, at: now });
        return false;
      }
      if (++h.n <= PAIR_PER_MINUTE) return false;
      void reply.code(429).header("retry-after", Math.ceil((h.at + 60_000 - now) / 1000)).send(errorBody("too_many_requests", "Too many tries. Wait a minute."));
      return true;
    };

    // Pairing: the code from the page, traded once for the runner's token (`watchwright runner --pair`).
    app.post<{ Body: { code?: unknown } }>("/runners/pair", { config: { access: "public" } }, async (req, reply) => {
      if (limited(req, reply)) return reply;
      const code = typeof req.body?.code === "string" ? req.body.code : "";
      const paired = code ? store.pair(code) : null;
      if (!paired) return reply.code(404).send(errorBody("bad_code", "That pair code doesn't work: it was used, it expired (codes last 15 minutes) or it was mistyped. Make a new one in Admin › Runners."));
      return { data: { id: paired.runner.id, name: paired.runner.name, allow: paired.runner.allow, token: paired.token } };
    });

    // The runner's connection. The first message must be `auth` with its token; then binary frames (protocol.ts).
    app.get("/runners/connect", { websocket: true, config: { access: "public" } }, (socket: WebSocket) => {
      const refuse = (message: string) => {
        socket.send(JSON.stringify({ type: "refused", message } satisfies Control));
        socket.close(4003, "refused");
      };
      const timer = setTimeout(() => refuse("No auth message came."), AUTH_MS);
      socket.once("message", (raw: Buffer, isBinary: boolean) => {
        clearTimeout(timer);
        let msg: Partial<Extract<Control, { type: "auth" }>> | null;
        try {
          msg = isBinary ? null : (JSON.parse(raw.toString("utf8")) as Partial<Extract<Control, { type: "auth" }>>);
        } catch {
          msg = null;
        }
        if (!msg || msg.type !== "auth" || typeof msg.token !== "string") return refuse('Send {"type":"auth", "token": …} first.');
        const runner = store.byToken(msg.token);
        if (!runner) {
          socket.send(
            JSON.stringify({ type: "refused", reason: "unknown_token", message: "This runner's token doesn't work: the runner was removed or paired again. Pair it again with a new code from Admin › Runners." } satisfies Control),
          );
          return socket.close(4003, "refused");
        }
        let allow: string[];
        try {
          allow = parseAllow(Array.isArray(msg.allow) ? msg.allow.filter((a): a is string => typeof a === "string") : DEFAULT_ALLOW);
        } catch (err) {
          return refuse(err instanceof Error ? err.message : String(err));
        }
        const version = typeof msg.version === "string" ? msg.version.slice(0, 40) : "unknown";
        const platform = typeof msg.platform === "string" ? msg.platform.slice(0, 40) : "unknown";
        const service = typeof msg.service === "string" ? msg.service.slice(0, 20) : undefined;
        store.seen(runner.id, { allow, version, platform, ...(service ? { service } : {}) });
        hub.attach(socket, { ...runner, allow }, { allow, version, platform });
        socket.send(JSON.stringify({ type: "hello", name: runner.name, version: VERSION } satisfies Control));
      });
    });
  },
});
