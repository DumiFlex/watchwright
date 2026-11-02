import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `watchwright serve --background`: starts the server as its own process with no window (on
// Windows, no console stays open), its output in a log file in the data folder, and returns once
// it answers. The server keeps running after the command and its terminal close; stop it from
// Settings > Server in the web app.

/** The log keeps one older file; past this size the current one becomes `server.old.log`. */
const LOG_LIMIT = 5 * 1024 * 1024;

export function serverLogFile(dataDir: string): string {
  return path.join(dataDir, "logs", "server.log");
}

/** The arguments the background server gets: serve's own, without `--background`, never opening a browser. */
export function backgroundArgs(argv: string[]): string[] {
  const args = argv.filter((a) => a !== "--background");
  return args.includes("--no-open") ? args : [...args, "--no-open"];
}

/** Opens the log for appending, moving a full one aside first. */
function openLog(file: string): number {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (existsSync(file) && statSync(file).size > LOG_LIMIT) renameSync(file, file.replace(/\.log$/, ".old.log"));
  } catch {
    // another process holds it (Windows): keep appending
  }
  return openSync(file, "a");
}

/** The last lines of the log, to show why the server didn't come up. */
function tail(file: string, lines: number): string {
  try {
    return readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export interface BackgroundStart {
  /** serve's arguments as given (with `--background`). */
  argv: string[];
  url: string;
  dataDir: string;
  /** Answers with the server's version once it is up, null while it isn't. */
  up: () => Promise<string | null>;
  /** How long to wait for it to answer. */
  waitMs?: number;
  /** The program and script to start; this process's by default. */
  node?: string;
  main?: string;
}

/** Starts the server in the background; resolves once it answers (with its process id) or when it gave up or exited. */
export async function startInBackground(o: BackgroundStart): Promise<{ ok: true; pid: number; version: string; log: string } | { ok: false; log: string; output: string }> {
  const log = serverLogFile(o.dataDir);
  const fd = openLog(log);
  const main = o.main ?? process.argv[1] ?? fileURLToPath(new URL("./main.js", import.meta.url));
  const child = spawn(o.node ?? process.execPath, [...(o.node ? [] : process.execArgv), main, "serve", ...backgroundArgs(o.argv)], {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  closeSync(fd);
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  child.unref();

  const end = Date.now() + (o.waitMs ?? 30_000);
  while (!exited && Date.now() < end) {
    const version = await o.up();
    if (version !== null) return { ok: true, pid: child.pid ?? 0, version, log };
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!exited) child.kill();
  return { ok: false, log, output: tail(log, 15) };
}
