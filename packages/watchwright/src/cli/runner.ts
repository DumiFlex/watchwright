import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { allows, DEFAULT_ALLOW, parseAllow } from "../plugins/runners/allow.js";
import { Mux } from "../plugins/runners/mux.js";
import { decode, encode, OPEN, OPENED, readOpen, REFUSED, type Control } from "../plugins/runners/protocol.js";
import { VERSION } from "../version.js";
import { UsageError } from "./args.js";
import { configDir, serverKey, writePrivateJson } from "./credentials.js";

// `watchwright runner` (docs/plans/self-hosting.md, section 6): runs on the machine that can reach
// the site (a PC with the app on localhost) and connects out to a Watchwright server, which sends
// the browser connections of runs that pick this runner through it. It opens only what its own
// allow list names (default: loopback). Pairing (`--pair CODE`) trades the code from Settings ›
// Runners for a token kept in the config folder; after that `watchwright runner` reconnects alone.

export interface RunnerConfig {
  servers: Record<string, { id: string; name: string; token: string; allow: string[]; savedAt: string }>;
  /** The server paired last, which `watchwright runner` without --server connects to. */
  last?: string;
}

export function runnerConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), "runner.json");
}

export function readRunnerConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const file = runnerConfigPath(env);
  if (!existsSync(file)) return { servers: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<RunnerConfig> | null;
    return { servers: parsed?.servers && typeof parsed.servers === "object" ? parsed.servers : {}, ...(typeof parsed?.last === "string" ? { last: parsed.last } : {}) };
  } catch {
    return { servers: {} };
  }
}

const HELP = `watchwright runner [--server <address>] [--pair <code>] [--allow <list>]

Lets a Watchwright server reach sites through this machine: runs that pick this runner (Reach the
site from, or site.network in the pack) open their connections here. Add the runner in the
server's Settings › Runners, which shows the command with a pair code; after pairing,
\`watchwright runner\` alone connects again. It runs until you stop it (Ctrl+C).

  --server   The server's address (default: the one paired last).
  --pair     A pair code from Settings › Runners (works once, for 15 minutes).
  --allow    What the server may open here, separated by commas: loopback (any port on this
             machine; the default), host:port or host:*. Saved for next time. The server can't
             change it.`;

export interface RunnerLog {
  info(line: string): void;
  warn(line: string): void;
}

const consoleLog: RunnerLog = { info: (l) => console.log(l), warn: (l) => console.error(l) };

class RunnerError extends Error {}

/** Trades a pair code for the runner's token and saves it. */
export async function pairRunner(base: string, code: string, allow: string[] | undefined, env: NodeJS.ProcessEnv = process.env): Promise<{ name: string; allow: string[] }> {
  let res: Response;
  try {
    res = await fetch(new URL("api/v1/runners/pair", base), {
      method: "POST",
      headers: { "content-type": "application/json", "x-watchwright-client": "runner" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RunnerError(`No Watchwright answers at ${base}.`);
  }
  const json = (await res.json().catch(() => null)) as { data?: { id: string; name: string; allow: string[]; token: string }; error?: { message: string } } | null;
  if (!json) throw new RunnerError(`Something that isn't Watchwright answers at ${base}.`);
  if (json.error || !json.data) throw new RunnerError(json.error?.message ?? "Pairing failed.");
  const d = json.data;
  const cfg = readRunnerConfig(env);
  const key = serverKey(base);
  const list = allow ?? d.allow;
  cfg.servers[key] = { id: d.id, name: d.name, token: d.token, allow: list, savedAt: new Date().toISOString() };
  cfg.last = key;
  writePrivateJson(runnerConfigPath(env), cfg);
  return { name: d.name, allow: list };
}

export interface RunnerHandle {
  /** Resolves once the server said hello the first time (or rejects when it refused the runner). */
  ready: Promise<{ name: string }>;
  /** Resolves when it stops for good: null when closed here, else why the server ended it. */
  ended: Promise<string | null>;
  /** Stops for good: closes the connection and every connection it carries. */
  close(): void;
}

/** Back-off between reconnects: 1 s, doubling to 30 s. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
const PING_MS = 30_000;
const SILENT_MS = 75_000;
/** A connection that isn't open after this long is given up and tried again. */
const CONNECT_MS = 15_000;

/** Connects to the server and carries connections until closed, reconnecting when the link drops. */
export function connectRunner(opts: { base: string; token: string; allow: string[]; log?: RunnerLog }): RunnerHandle {
  const log = opts.log ?? consoleLog;
  const url = new URL("api/v1/runners/connect", opts.base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  let closed = false;
  let failures = 0;
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let settle: { resolve: (v: { name: string }) => void; reject: (e: Error) => void } | null = null;
  const ready = new Promise<{ name: string }>((resolve, reject) => (settle = { resolve, reject }));
  ready.catch(() => undefined);
  let end: (why: string | null) => void = () => undefined;
  const ended = new Promise<string | null>((resolve) => (end = resolve));

  const connect = () => {
    if (closed) return;
    const sock = new WebSocket(url);
    ws = sock;
    sock.binaryType = "arraybuffer";
    const mux = new Mux((frame) => sock.readyState === WebSocket.OPEN && sock.send(frame));
    let named: string | null = null;
    let heard = Date.now();
    let refused = false;
    const started = Date.now();
    let pinged = Date.now();
    // Also what keeps the process alive while a connection is being made (Node's WebSocket doesn't).
    const ping = setInterval(() => {
      const now = Date.now();
      if (sock.readyState === WebSocket.CONNECTING && now - started > CONNECT_MS) {
        sock.close();
        return gone(1006, "");
      }
      if (sock.readyState !== WebSocket.OPEN) return;
      if (now - heard > SILENT_MS) return sock.close(4002, "silent");
      if (now - pinged >= PING_MS) {
        pinged = now;
        sock.send(JSON.stringify({ type: "ping" } satisfies Control));
      }
    }, 5000);

    sock.addEventListener("open", () => {
      sock.send(JSON.stringify({ type: "auth", token: opts.token, version: VERSION, allow: opts.allow, platform: `${process.platform}-${process.arch}` } satisfies Control));
    });
    sock.addEventListener("message", (ev: MessageEvent) => {
      heard = Date.now();
      if (typeof ev.data === "string") {
        let msg: Control;
        try {
          msg = JSON.parse(ev.data) as Control;
        } catch {
          return;
        }
        if (msg.type === "hello") {
          named = msg.name;
          failures = 0;
          log.info(`Connected to ${opts.base} as ${msg.name}. It may open: ${opts.allow.join(", ")}.`);
          settle?.resolve({ name: msg.name });
          settle = null;
        } else if (msg.type === "refused") {
          refused = true;
          log.warn(`The server refused this runner: ${msg.message}`);
          settle?.reject(new RunnerError(msg.message));
          settle = null;
          closed = true;
          end(msg.message);
        }
        return;
      }
      const f = decode(Buffer.from(ev.data as ArrayBuffer));
      if (!f) return;
      if (f.type === OPEN) {
        const target = readOpen(f.payload);
        if (!target || !allows(opts.allow, target.host, target.port)) {
          const what = target ? `${target.host}:${target.port}` : "a bad address";
          log.warn(`Refused ${what}: not in this runner's allow list (${opts.allow.join(", ")}).`);
          sock.send(encode(REFUSED, f.stream, Buffer.from(`${what} isn't in the runner's allow list (${opts.allow.join(", ")}). Change it on that machine with watchwright runner --allow.`)));
          return;
        }
        const socket = net.connect({ host: target.host.replace(/^\[(.*)\]$/, "$1"), port: target.port, allowHalfOpen: true });
        socket.setNoDelay(true);
        socket.pause();
        socket.once("connect", () => {
          socket.removeAllListeners("error");
          if (sock.readyState !== WebSocket.OPEN) return void socket.destroy();
          sock.send(encode(OPENED, f.stream));
          mux.attach(f.stream, socket);
        });
        socket.once("error", (err: NodeJS.ErrnoException) => {
          const why = err.code === "ECONNREFUSED" ? `nothing listens on ${target.host}:${target.port} on the runner's machine` : `${target.host}:${target.port}: ${err.code ?? err.message}`;
          if (sock.readyState === WebSocket.OPEN) sock.send(encode(REFUSED, f.stream, Buffer.from(why)));
        });
        return;
      }
      mux.handle(f);
    });
    // Node's WebSocket fires only `error` (no `close`) when it can't connect, and a stuck attempt is
    // given up by the timer above: each ends here once.
    let down = false;
    const gone = (code: number, reason: string) => {
      if (down) return;
      down = true;
      clearInterval(ping);
      mux.closeAll();
      if (ws === sock) ws = null;
      if (code === 4001) {
        // Removed on the server: this token won't work again.
        log.warn(reason || "This runner was removed on the server.");
        closed = true;
        settle?.reject(new RunnerError(reason || "This runner was removed on the server."));
        settle = null;
        end(reason || "This runner was removed on the server.");
      }
      if (closed || refused) return;
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!;
      failures++;
      if (named) log.warn(`Lost the connection to ${opts.base}. Trying again in ${Math.round(wait / 1000)} s.`);
      else if (failures === 1 || failures % 10 === 0) log.warn(`Can't reach ${opts.base}. Trying again every ${Math.round(wait / 1000)} s or so.`);
      named = null;
      retry = setTimeout(connect, wait);
    };
    sock.addEventListener("close", (ev: { code: number; reason: string }) => gone(ev.code, ev.reason));
    sock.addEventListener("error", () => {
      if (sock.readyState !== WebSocket.OPEN) gone(1006, "");
    });
  };
  connect();
  return {
    ready,
    ended,
    close() {
      closed = true;
      end(null);
      if (retry) clearTimeout(retry);
      ws?.close(1000, "runner stopped");
    },
  };
}

export async function runnerCommand(argv: string[], env: NodeJS.ProcessEnv = process.env, log: RunnerLog = consoleLog): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { server: { type: "string" }, pair: { type: "string" }, allow: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  let allow: string[] | undefined;
  try {
    allow = values.allow !== undefined ? parseAllow(values.allow) : undefined;
  } catch (err) {
    throw new UsageError(`--allow: ${err instanceof Error ? err.message : String(err)}`);
  }
  const cfg = readRunnerConfig(env);
  const given = values.server ?? env.WATCHWRIGHT_URL;
  let base = given ? (given.endsWith("/") ? given : `${given}/`) : cfg.last ? `${cfg.last}/` : null;
  if (!base) throw new UsageError("Which server? Add this runner in the server's Settings › Runners and run the command it shows (watchwright runner --server … --pair …).");
  try {
    new URL(base);
  } catch {
    throw new UsageError(`--server must be an address like https://watchwright.example.com, not "${given}".`);
  }
  base = `${serverKey(base)}/`;
  try {
    if (values.pair) {
      const p = await pairRunner(base, values.pair, allow, env);
      log.info(`Paired as ${p.name}. The token is saved in ${runnerConfigPath(env)}.`);
    }
    const saved = readRunnerConfig(env).servers[serverKey(base)];
    if (!saved) throw new RunnerError(`This machine isn't paired with ${base} yet. Add the runner in its Settings › Runners and run the command shown there.`);
    if (allow && allow.join() !== saved.allow.join()) {
      const next = readRunnerConfig(env);
      next.servers[serverKey(base)] = { ...saved, allow };
      writePrivateJson(runnerConfigPath(env), next);
      saved.allow = allow;
    }
    log.info(`Runner ${saved.name} on ${os.hostname()}, for ${base}`);
    const handle = connectRunner({ base, token: saved.token, allow: saved.allow.length ? saved.allow : [...DEFAULT_ALLOW], log });
    const stop = () => handle.close();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await handle.ready;
    // Runs until stopped here (0) or ended by the server, when it was removed (1).
    return (await handle.ended) === null ? 0 : 1;
  } catch (err) {
    if (err instanceof RunnerError) {
      log.warn(err.message);
      return 1;
    }
    throw err;
  }
}
