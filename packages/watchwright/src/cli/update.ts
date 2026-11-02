import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { howToUpdate, installKind, isNewer, latestVersion, VERSION_RE, type InstallKind } from "../plugins/updates/install.js";
import { VERSION } from "../version.js";
import { startInBackground } from "./background.js";
import { ApiError, Client, clientName, NoServer, serverUrl } from "./client.js";
import { currentUpdate, removeLock, writeLock } from "./update-lock.js";

// `watchwright update`: installs the newest Watchwright over a global npm install, also while the
// server runs and while an agent (Claude Desktop) holds `watchwright mcp` open. With a server up, the
// server does it (`updates.start`): it starts `watchwright update --worker` and stops, the worker
// waits for it to exit, runs npm and starts it again with the same options. Without one, this
// command runs npm itself. Nothing here loads the server's code, so this process holds no file npm
// replaces (docs: guide/updating).

export interface UpdateIo {
  out: (s: string) => void;
  err: (s: string) => void;
  /** Asks yes or no at the terminal; null when there is none. */
  confirm: (question: string) => Promise<boolean | null>;
}

export interface UpdateDeps {
  install: () => InstallKind;
  latest: () => Promise<string>;
  /** Runs `npm install -g watchwright@<version>`; resolves to its exit code. */
  npmInstall: (version: string, log: (s: string) => void) => Promise<number>;
  /** How long to wait for the server to come back, in ms. */
  backWithinMs: number;
}

const defaultDeps: UpdateDeps = { install: () => installKind(), latest: () => latestVersion(), npmInstall, backWithinMs: 5 * 60_000 };

export async function updateCommand(argv: string[], io: UpdateIo = processUpdateIo, deps: UpdateDeps = defaultDeps): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      check: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      now: { type: "boolean" },
      server: { type: "string" },
      version: { type: "string" },
      // The worker the server starts (not for people).
      worker: { type: "boolean" },
      pid: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      url: { type: "string" },
      data: { type: "string" },
      restart: { type: "string" },
    },
  });
  if (values.worker) return worker({ pid: Number(values.pid) || 0, from: values.from ?? VERSION, to: values.to ?? "", url: values.url ?? "", data: values.data ?? "", restart: values.restart }, io, deps);

  if (values.version !== undefined && !VERSION_RE.test(values.version)) {
    io.err(`--version takes a version such as 0.12.0, not "${values.version}".`);
    return 2;
  }
  let target = values.version;
  if (!target) {
    try {
      target = await deps.latest();
    } catch (err) {
      io.err(`Couldn't find the newest version: ${(err as Error).message}`);
      return 1;
    }
  }
  const base = serverUrl(values.server);
  const client = new Client(base, clientName(undefined));
  const health = await client.health();
  const current = health?.version ?? VERSION;
  const newer = values.version ? target !== current : isNewer(current, target);
  io.out(health ? `The server at ${base} runs Watchwright ${current}. The newest is ${target}.` : `This is Watchwright ${VERSION}. The newest is ${target}.`);
  if (!newer) {
    io.out("Nothing to update.");
    return 0;
  }
  if (values.check) {
    io.out(health ? "Update it with `watchwright update`, or with Update in Settings › Server." : `Update with \`watchwright update\`. ${deps.install() === "npm" ? "" : howToUpdate(deps.install())}`.trim());
    return 0;
  }

  if (health) {
    const yes = values.yes || (await io.confirm(`Update the server to ${target}? It stops for a minute and starts again with the same options.`));
    if (yes === null) {
      io.err("No terminal to ask on. Add --yes to update.");
      return 2;
    }
    if (!yes) return 1;
    try {
      await client.callName("updates.start", { version: target, now: values.now ?? false }, undefined, true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "unknown_action") {
        io.err(`The server runs ${current}, which can't update itself yet. Stop it (Settings › Server), run \`watchwright update\` again, then start it.`);
        return 1;
      }
      if (err instanceof ApiError && err.code === "runs_going") {
        io.err(`${err.message} Add --now to update now.`);
        return 1;
      }
      if (err instanceof ApiError || err instanceof NoServer) {
        io.err(err.message);
        return 1;
      }
      throw err;
    }
    io.out("Updating: the server stopped and comes back by itself…");
    const back = await waitForVersion(client, target, deps.backWithinMs);
    if (back === target) {
      io.out(`Watchwright ${target} is running at ${base}`);
      return 0;
    }
    const log = health.dataDir ? path.join(health.dataDir, "logs", "update.log") : "logs/update.log in the data folder";
    io.err(back ? `The server came back with ${back}, not ${target}: the update failed. See ${log}.` : `The server isn't back yet. See ${log}.`);
    return 1;
  }

  const kind = deps.install();
  if (kind !== "npm") {
    io.err(howToUpdate(kind));
    return 1;
  }
  if (currentUpdate()) {
    io.err("Another update is going on. Try again in a minute.");
    return 1;
  }
  writeLock({ pid: process.pid, from: VERSION, to: target, startedAt: new Date().toISOString() });
  try {
    const code = await deps.npmInstall(target, io.out);
    if (code !== 0) {
      io.err(`npm install failed (exit code ${code}). Watchwright ${VERSION} stays.`);
      return 1;
    }
  } finally {
    removeLock();
  }
  io.out(`Watchwright ${target} is installed. Start it with \`watchwright serve\`.`);
  return 0;
}

/** Waits for the server to answer again; resolves to its version, or null when it didn't within `ms`. */
async function waitForVersion(client: Client, want: string, ms: number): Promise<string | null> {
  const end = Date.now() + ms;
  let seen: string | null = null;
  let wentDown = false;
  while (Date.now() < end) {
    const h = await client.health(1500);
    if (!h) wentDown = true;
    else {
      seen = h.version;
      if (h.version === want) return want;
      // Back with the old version and no update going on: it failed.
      if (wentDown && !currentUpdate()) return seen;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return seen;
}

export interface WorkerOptions {
  /** The server process to wait for. */
  pid: number;
  from: string;
  to: string;
  url: string;
  data: string;
  /** serve's options as JSON, to start the server again; none: don't start it. */
  restart: string | undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function exited(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !alive(pid);
}

/** The worker: waits for the server to exit, installs, starts it again. Its output is the update log. */
export async function worker(o: WorkerOptions, io: UpdateIo, deps: UpdateDeps): Promise<number> {
  const stamp = () => new Date().toISOString();
  const log = (s: string) => io.out(`${stamp()} ${s}`);
  writeLock({ pid: process.pid, from: o.from, to: o.to, startedAt: stamp() });
  let ok = false;
  let message = "";
  try {
    log(`Updating Watchwright ${o.from} to ${o.to}.`);
    if (o.pid && !(await exited(o.pid, 60_000))) {
      log(`The server (process ${o.pid}) didn't stop within a minute; ending it.`);
      try {
        process.kill(o.pid);
      } catch {
        // gone meanwhile
      }
      await exited(o.pid, 10_000);
    }
    // Let the server's helpers (esbuild, browsers) end and let go of their files.
    await new Promise((r) => setTimeout(r, 1500));
    let code = await deps.npmInstall(o.to, log);
    if (code !== 0) {
      log(`npm install failed (exit code ${code}); trying once more in 5 seconds.`);
      await new Promise((r) => setTimeout(r, 5000));
      code = await deps.npmInstall(o.to, log);
    }
    ok = code === 0;
    message = ok ? `Updated to ${o.to}.` : `npm install failed (exit code ${code}); ${o.from} stays.`;
    log(message);
  } catch (err) {
    message = `The update failed: ${err instanceof Error ? err.message : String(err)}`;
    log(message);
  } finally {
    if (o.data) {
      try {
        mkdirSync(path.join(o.data, "logs"), { recursive: true });
        writeFileSync(path.join(o.data, "logs", "update.json"), JSON.stringify({ from: o.from, to: o.to, ok, message, at: stamp() }));
      } catch {
        // the log says it anyway
      }
    }
    if (o.restart !== undefined) {
      let args: string[] = [];
      try {
        const parsed = JSON.parse(o.restart) as unknown;
        if (Array.isArray(parsed)) args = parsed.map(String);
      } catch {
        // start it with the defaults
      }
      const health = async () => {
        const h = await fetch(`${o.url}api/v1/health`, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.json() as Promise<{ data?: { name?: string; version?: string } }>)
          .catch(() => null);
        return h?.data?.name === "watchwright" ? (h.data.version ?? "") : null;
      };
      const started = await startInBackground({ argv: args, url: o.url, dataDir: o.data, up: health, waitMs: 60_000 });
      log(started.ok ? `Watchwright ${started.version} is running again (process ${started.pid}).` : `Watchwright didn't start again. Its log (${started.log}) ends with:\n${started.output}`);
    }
    removeLock();
  }
  return ok ? 0 : 1;
}

/** `npm install -g watchwright@<version>`, its output line by line to `log`. */
export function npmInstall(version: string, log: (s: string) => void): Promise<number> {
  if (!VERSION_RE.test(version)) return Promise.resolve(2);
  const win = process.platform === "win32";
  const child = win
    ? spawn(`npm.cmd install -g watchwright@${version}`, { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("npm", ["install", "-g", `watchwright@${version}`], { stdio: ["ignore", "pipe", "pipe"] });
  const lines = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) log(line);
  };
  child.stdout.on("data", lines);
  child.stderr.on("data", lines);
  return new Promise((resolve) => {
    child.on("error", (err) => {
      log(`Couldn't run npm: ${err.message}`);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export const processUpdateIo: UpdateIo = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  async confirm(question) {
    if (!process.stdin.isTTY) return null;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  },
};
