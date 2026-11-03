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
import {
  backgroundRunner,
  installService,
  notePid,
  SERVICE_ENV,
  ServiceError,
  serviceState,
  startBackground,
  stopBackground,
  thisHost,
  uninstallService,
  UNIT,
  type Host,
} from "./runner-service.js";

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

const HELP = `watchwright runner [install | uninstall | status | start | stop] [--server <address>] [--pair <code>] [--allow <list>]

Lets a Watchwright server reach sites through this machine: runs that pick this runner (Reach the
site from, or site.network in the pack) open their connections here. Add the runner in the
server's Admin › Runners, which shows the command with a pair code; after pairing,
\`watchwright runner\` alone connects again.

  (none)     Runs in this terminal until you stop it (Ctrl+C).
  install    Starts by itself from now on, with no window: at sign-in on Windows and macOS, with
             systemd on Linux (at boot as root). Also starts it now. Takes --pair to pair first.
  uninstall  Stops it and removes the start-up entry. --forget also deletes the saved tokens.
  status     The servers this machine is paired with, the start-up entry, running or not.
  start      Starts it now in the background (through the start-up entry when there is one).
  stop       Stops the background runner (the start-up entry stays).

  --server   The server's address (default: the one paired last).
  --pair     A pair code from Admin › Runners (works once, for 15 minutes).
  --allow    What the server may open here, separated by commas: loopback (any port on this
             machine; the default), host:port or host:*. Saved for next time. The server can't
             change it.
  --forget   With uninstall: also delete the saved tokens (of --server only, when given).

When the server removes this runner it removes itself here too: it forgets the token and its
start-up entry.`;

export interface RunnerLog {
  info(line: string): void;
  warn(line: string): void;
}

const consoleLog: RunnerLog = { info: (l) => console.log(l), warn: (l) => console.error(l) };
/** In a log file or the journal: each line with its time. */
const stampedLog: RunnerLog = { info: (l) => console.log(`${new Date().toISOString()} ${l}`), warn: (l) => console.error(`${new Date().toISOString()} ${l}`) };

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
export function connectRunner(opts: {
  base: string;
  token: string;
  allow: string[];
  log?: RunnerLog;
  /** How it was started, told to the server: windows, systemd, launchd, background or none. */
  service?: string;
  /** Called when the server removed this runner (now, or while it was offline): forget the token, remove the start-up entry. Answers whether there was an entry. */
  onRemoved?: () => Promise<boolean>;
}): RunnerHandle {
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

  let removing: Promise<boolean> | null = null;
  /** Cleans up after the server removed this runner, once. */
  const removedHere = (): Promise<boolean> =>
    (removing ??= (opts.onRemoved ?? (async () => false))().catch((err: unknown) => {
      log.warn(`Couldn't remove this runner's start-up entry: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }));

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
      sock.send(
        JSON.stringify({ type: "auth", token: opts.token, version: VERSION, allow: opts.allow, platform: `${process.platform}-${process.arch}`, service: opts.service ?? "none" } satisfies Control),
      );
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
          closed = true;
          const finish = () => {
            settle?.reject(new RunnerError(msg.message));
            settle = null;
            end(msg.message);
          };
          // The token will never work again: forget it here too.
          if (msg.reason === "unknown_token" && opts.onRemoved) void removedHere().finally(finish);
          else finish();
        } else if (msg.type === "removed") {
          closed = true;
          log.warn(msg.message || "This runner was removed on the server.");
          void removedHere().then((service) => {
            if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "cleaned", service } satisfies Control));
          });
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
        const why = reason || "This runner was removed on the server.";
        if (!removing) log.warn(why);
        closed = true;
        void removedHere().finally(() => {
          settle?.reject(new RunnerError(why));
          settle = null;
          end(why);
        });
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

/** Forgets a server's token here; with `server` null, every one. */
export function forgetServers(env: NodeJS.ProcessEnv, server: string | null): string[] {
  const cfg = readRunnerConfig(env);
  const gone = Object.keys(cfg.servers).filter((k) => server === null || k === server);
  for (const k of gone) delete cfg.servers[k];
  if (cfg.last && gone.includes(cfg.last)) delete cfg.last;
  if (gone.length) writePrivateJson(runnerConfigPath(env), cfg);
  return gone;
}

/** After the server removed this runner: forget its token and remove the start-up entry when it was for that server. */
export async function cleanUpRemoved(h: Host, server: string, log: RunnerLog): Promise<boolean> {
  forgetServers(h.env, server);
  const st = serviceState(h);
  let had = false;
  if (st.installed && (!st.server || serverKey(st.server) === server)) {
    await uninstallService(h, { self: true });
    had = true;
  }
  log.info(`Forgot this runner's token for ${server}${had ? " and removed its start-up entry" : ""}.`);
  return had;
}

const SUBCOMMANDS = ["install", "uninstall", "status", "start", "stop"] as const;
type Sub = (typeof SUBCOMMANDS)[number];

export async function runnerCommand(argv: string[], env: NodeJS.ProcessEnv = process.env, log?: RunnerLog, host?: Host): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { server: { type: "string" }, pair: { type: "string" }, allow: { type: "string" }, forget: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const sub = positionals[0] as Sub | undefined;
  if (positionals.length > 1 || (sub !== undefined && !SUBCOMMANDS.includes(sub))) throw new UsageError(`watchwright runner takes one of ${SUBCOMMANDS.join(", ")}, or nothing; not "${positionals.join(" ")}".`);
  const service = env[SERVICE_ENV];
  log ??= service ? stampedLog : consoleLog;
  const h = host ?? thisHost(env);

  if (sub === "status") return status(h, log);
  if (sub === "stop") return stop(h, log);
  if (sub === "uninstall") {
    for (const l of await uninstallService(h)) log.info(l);
    if (values.forget) {
      const gone = forgetServers(env, values.server ? serverKey(values.server) : null);
      log.info(gone.length ? `Forgot the tokens for ${gone.join(", ")}.` : "No saved runner tokens here.");
    }
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
  const st = sub === "start" ? serviceState(h) : null;
  let base = given ? (given.endsWith("/") ? given : `${given}/`) : st?.installed && st.server ? `${st.server}/` : cfg.last ? `${cfg.last}/` : null;
  if (!base) throw new UsageError("Which server? Add this runner in the server's Admin › Runners and run the command it shows (watchwright runner install --server … --pair …).");
  try {
    new URL(base);
  } catch {
    throw new UsageError(`--server must be an address like https://watchwright.example.com, not "${given}".`);
  }
  base = `${serverKey(base)}/`;
  const key = serverKey(base);
  try {
    if (values.pair) {
      const p = await pairRunner(base, values.pair, allow, env);
      log.info(`Paired as ${p.name}. The token is saved in ${runnerConfigPath(env)}.`);
    }
    const saved = readRunnerConfig(env).servers[key];
    if (!saved) throw new RunnerError(`This machine isn't paired with ${base} yet. Add the runner in its Admin › Runners and run the command shown there.`);
    if (allow && allow.join() !== saved.allow.join()) {
      const next = readRunnerConfig(env);
      next.servers[key] = { ...saved, allow };
      writePrivateJson(runnerConfigPath(env), next);
      saved.allow = allow;
    }

    if (sub === "install") {
      for (const l of await installService(h, key)) log.info(l);
      log.info(`Runner ${saved.name} for ${key}. See it with \`watchwright runner status\`; remove it here with \`watchwright runner uninstall\`.`);
      return 0;
    }
    if (sub === "start") return start(h, key, st!, log);

    // In this process: a terminal, or the process a start-up entry or `runner start` runs.
    const other = backgroundRunner(env);
    if (other && service !== "systemd" && service !== "launchd") {
      throw new RunnerError(`A runner already runs in the background here (process ${other.pid}, for ${other.server}). Stop it with \`watchwright runner stop\` first.`);
    }
    const unnote = service === "background" || service === "windows" ? notePid(env, key) : () => undefined;
    log.info(`Runner ${saved.name} on ${os.hostname()}, for ${base}`);
    const handle = connectRunner({
      base,
      token: saved.token,
      allow: saved.allow.length ? saved.allow : [...DEFAULT_ALLOW],
      log,
      service: service ?? "none",
      onRemoved: () => cleanUpRemoved(h, key, log),
    });
    const stopIt = () => handle.close();
    process.once("SIGINT", stopIt);
    process.once("SIGTERM", stopIt);
    try {
      await handle.ready;
      // Runs until stopped here (0) or ended by the server, when it was removed: 0 for a start-up
      // entry (so systemd and launchd leave it stopped), else 1.
      return (await handle.ended) === null || service ? 0 : 1;
    } finally {
      unnote();
    }
  } catch (err) {
    if (err instanceof RunnerError || err instanceof ServiceError) {
      log.warn(err.message);
      return service ? 0 : 1;
    }
    throw err;
  }
}

async function start(h: Host, server: string, st: ReturnType<typeof serviceState>, log: RunnerLog): Promise<number> {
  if (st.running) {
    log.info("The runner already runs.");
    return 0;
  }
  const entry = st.installed && (!st.server || serverKey(st.server) === server);
  if (entry && st.kind === "systemd") {
    const r = h.run("systemctl", [...(h.uid === 0 ? [] : ["--user"]), "start", UNIT]);
    if (r.status !== 0) throw new ServiceError(`systemctl start ${UNIT} failed${r.out ? `:\n${r.out}` : "."}`);
    log.info("Started the runner.");
    return 0;
  }
  if (entry && st.kind === "launchd") {
    const r = h.run("launchctl", ["kickstart", `gui/${h.uid}/dev.watchwright.runner`]);
    if (r.status !== 0) throw new ServiceError(`launchctl kickstart failed${r.out ? `:\n${r.out}` : "."}`);
    log.info("Started the runner.");
    return 0;
  }
  const started = await startBackground({ ...h, env: { ...h.env, [SERVICE_ENV]: entry ? "windows" : "background" } }, server);
  if (!started.ok) throw new ServiceError(`The runner stopped right away. Its log (${started.log}) ends with:\n${started.output}`);
  log.info(`The runner runs in the background (process ${started.pid}). Its log is ${started.log}; stop it with \`watchwright runner stop\`.`);
  return 0;
}

function stop(h: Host, log: RunnerLog): number {
  const st = serviceState(h);
  if (st.installed && st.kind === "systemd") {
    h.run("systemctl", [...(h.uid === 0 ? [] : ["--user"]), "stop", UNIT]);
    log.info("Stopped the runner. It starts again at the next boot or sign-in; `watchwright runner uninstall` stops that.");
    return 0;
  }
  if (st.installed && st.kind === "launchd") {
    h.run("launchctl", ["kill", "SIGTERM", `gui/${h.uid}/dev.watchwright.runner`]);
    log.info("Stopped the runner. It starts again at the next sign-in; `watchwright runner uninstall` stops that.");
    return 0;
  }
  if (stopBackground(h.env)) {
    log.info(st.installed ? "Stopped the runner. It starts again at the next sign-in; `watchwright runner uninstall` stops that." : "Stopped the runner.");
    return 0;
  }
  log.info("No runner runs in the background here.");
  return 0;
}

function status(h: Host, log: RunnerLog): number {
  const cfg = readRunnerConfig(h.env);
  const servers = Object.entries(cfg.servers);
  if (!servers.length) log.info("This machine isn't paired with a server. Add a runner in the server's Admin › Runners and run the command shown there.");
  for (const [k, s] of servers) log.info(`Paired with ${k} as ${s.name}${cfg.last === k ? " (the default)" : ""}; may open ${s.allow.join(", ") || DEFAULT_ALLOW.join(", ")}.`);
  const st = serviceState(h);
  const when = st.kind === "systemd" ? (h.uid === 0 ? "at boot" : "at sign-in") : "at sign-in";
  if (st.installed) log.info(`Starts by itself ${when}, for ${st.server ?? "the default server"} (${st.file}).`);
  else log.info(st.kind ? "No start-up entry: it runs only when started. `watchwright runner install` sets one up." : "No start-up entry (no systemd here).");
  const bg = backgroundRunner(h.env);
  log.info(st.running ? `Running now${bg ? ` (process ${bg.pid})` : ""}.` : "Not running now.");
  return 0;
}
