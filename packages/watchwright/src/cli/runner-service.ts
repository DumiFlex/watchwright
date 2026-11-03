import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installKind, type InstallKind } from "../plugins/updates/install.js";
import { VERSION } from "../version.js";
import { configDir } from "./credentials.js";

// A runner that starts by itself (docs/research/runner-service.md): `watchwright runner install`
// writes a start-up entry that runs `watchwright runner` with no window, and `uninstall` removes it.
// Windows: a .cmd in the Startup folder (at sign-in, no admin, nothing compiled), which starts the
// runner in the background. Linux: a systemd unit (a user unit, or a system unit as root). macOS:
// a LaunchAgent. One entry per machine, for one server. Only node: imports: the runner command
// must not load the server's code.

export type ServiceKind = "windows" | "systemd" | "launchd";

/** How a runner process says it was started, in WATCHWRIGHT_RUNNER_SERVICE and in its `auth` message. */
export const SERVICE_ENV = "WATCHWRIGHT_RUNNER_SERVICE";
export const LABEL = "dev.watchwright.runner";
export const UNIT = "watchwright-runner.service";

export interface Host {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** 0 for root. */
  uid: number;
  /** The node program and the CLI script that run this command. */
  node: string;
  script: string;
  kind: InstallKind;
  /** Runs a program and answers its exit status and output; never throws. */
  run(cmd: string, args: string[]): { status: number | null; out: string };
  exists(file: string): boolean;
}

export function thisHost(env: NodeJS.ProcessEnv = process.env): Host {
  return {
    platform: process.platform,
    env,
    home: os.homedir(),
    uid: typeof process.getuid === "function" ? process.getuid() : -1,
    node: process.execPath,
    script: process.argv[1] ?? fileURLToPath(new URL("./main.js", import.meta.url)),
    kind: installKind(),
    run(cmd, args) {
      const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
      return { status: r.error ? null : r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
    },
    exists: existsSync,
  };
}

/** What the start-up entry is, on this system; null where none is built in (Linux without systemd). */
export function serviceKind(h: Host): ServiceKind | null {
  if (h.platform === "win32") return "windows";
  if (h.platform === "darwin") return "launchd";
  // systemd's own test (sd_booted): systemctl may be installed where systemd isn't running (containers, WSL without it).
  if (h.platform === "linux" && h.exists("/run/systemd/system")) return "systemd";
  return null;
}

/** Where the entry is written. */
export function serviceFile(h: Host, kind: ServiceKind): string {
  switch (kind) {
    case "windows":
      return path.join(h.env.APPDATA || path.join(h.home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Watchwright runner.cmd");
    case "systemd":
      return h.uid === 0 ? path.join("/etc/systemd/system", UNIT) : path.join(h.env.XDG_CONFIG_HOME || path.join(h.home, ".config"), "systemd", "user", UNIT);
    case "launchd":
      return path.join(h.home, "Library", "LaunchAgents", `${LABEL}.plist`);
  }
}

/** npx's script next to this node, when it's there: a start-up entry can't count on PATH. */
function npxScript(h: Host): string | null {
  const dir = path.dirname(h.node);
  const tries = [
    h.env.npm_execpath ? path.join(path.dirname(h.env.npm_execpath), "npx-cli.js") : null,
    path.join(dir, "node_modules", "npm", "bin", "npx-cli.js"),
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  return tries.find((t): t is string => t !== null && h.exists(t)) ?? null;
}

/**
 * The program and arguments that run `watchwright runner <args>`: the node and script that run this
 * command, or, from npx's cache (which may be cleared), npx with this same version.
 */
export function runnerProgram(h: Host, args: string[]): string[] {
  if (h.kind !== "npx") return [h.node, h.script, "runner", ...args];
  const npx = npxScript(h);
  return [...(npx ? [h.node, npx] : ["npx"]), "--yes", `watchwright@${VERSION}`, "runner", ...args];
}

/** A PATH that starts with this node's folder: start-up entries on Linux and macOS get a short PATH. */
export function servicePath(h: Host): string {
  const parts = [path.dirname(h.node), "/usr/local/bin", "/usr/bin", "/bin"];
  if (h.platform === "darwin") parts.splice(1, 0, "/opt/homebrew/bin");
  return [...new Set(parts)].join(":");
}

const cmdQuote = (s: string) => (/[\s"&^%()<>|]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
const shQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);
/** systemd's ExecStart quoting: double quotes, with \ and " escaped; a % written twice. */
const unitQuote = (s: string) => (/^[\w@+=:,./-]+$/.test(s) ? s : `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).replaceAll("%", "%%");
const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The entry's file, for one server. */
export function serviceContent(h: Host, kind: ServiceKind, server: string): string {
  const cfg = configDir(h.env);
  switch (kind) {
    case "windows": {
      // `runner start` starts the runner as its own process with no window and returns; `start /min`
      // keeps those few seconds in a minimized window that then closes. A % in a .cmd starts a variable.
      const command = runnerProgram(h, ["start", "--server", server]).map(cmdQuote).join(" ").replaceAll("%", "%%");
      return [
        "@echo off",
        "rem Starts the Watchwright runner when you sign in. Written by `watchwright runner install`;",
        "rem `watchwright runner uninstall` deletes this file.",
        `set "WATCHWRIGHT_CONFIG_DIR=${cfg.replaceAll("%", "%%")}"`,
        `start "Watchwright runner" /min ${command}`,
        "",
      ].join("\r\n");
    }
    case "systemd": {
      const system = h.uid === 0;
      return [
        "# Written by `watchwright runner install`; `watchwright runner uninstall` removes it.",
        "[Unit]",
        "Description=Watchwright runner (lets a Watchwright server reach sites through this machine)",
        ...(system ? ["Wants=network-online.target", "After=network-online.target"] : []),
        "",
        "[Service]",
        `ExecStart=${runnerProgram(h, ["--server", server]).map(unitQuote).join(" ")}`,
        `Environment=${unitQuote(`PATH=${servicePath(h)}`)}`,
        `Environment=${unitQuote(`WATCHWRIGHT_CONFIG_DIR=${cfg}`)}`,
        `Environment=${SERVICE_ENV}=systemd`,
        // A runner that removed itself exits with 0 and stays stopped.
        "Restart=on-failure",
        "RestartSec=5",
        "",
        "[Install]",
        `WantedBy=${system ? "multi-user.target" : "default.target"}`,
        "",
      ].join("\n");
    }
    case "launchd": {
      const log = runnerLogFile(h.env);
      const args = runnerProgram(h, ["--server", server]).map((a) => `    <string>${xml(a)}</string>`);
      const env = { PATH: servicePath(h), WATCHWRIGHT_CONFIG_DIR: cfg, [SERVICE_ENV]: "launchd" };
      return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        "<!-- Written by `watchwright runner install`; `watchwright runner uninstall` removes it. -->",
        '<plist version="1.0">',
        "<dict>",
        `  <key>Label</key><string>${LABEL}</string>`,
        "  <key>ProgramArguments</key>",
        "  <array>",
        ...args,
        "  </array>",
        "  <key>EnvironmentVariables</key>",
        "  <dict>",
        ...Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`),
        "  </dict>",
        "  <key>RunAtLoad</key><true/>",
        // Back after a crash; not after it removed itself (exit 0).
        "  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
        `  <key>StandardOutPath</key><string>${xml(log)}</string>`,
        `  <key>StandardErrorPath</key><string>${xml(log)}</string>`,
        "</dict>",
        "</plist>",
        "",
      ].join("\n");
    }
  }
}

export function runnerLogFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), "logs", "runner.log");
}

function pidFile(env: NodeJS.ProcessEnv): string {
  return path.join(configDir(env), "runner.pid");
}

interface PidNote {
  pid: number;
  server: string;
  startedAt: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The background runner started by `runner start` (or the Windows entry), when it still runs. */
export function backgroundRunner(env: NodeJS.ProcessEnv = process.env): PidNote | null {
  try {
    const note = JSON.parse(readFileSync(pidFile(env), "utf8")) as Partial<PidNote>;
    return typeof note.pid === "number" && note.pid !== process.pid && alive(note.pid) ? (note as PidNote) : null;
  } catch {
    return null;
  }
}

/** Notes this process as the background runner (the child `runner start` started). */
export function notePid(env: NodeJS.ProcessEnv, server: string): () => void {
  const file = pidFile(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ pid: process.pid, server, startedAt: new Date().toISOString() } satisfies PidNote));
  return () => {
    try {
      const note = JSON.parse(readFileSync(file, "utf8")) as Partial<PidNote>;
      if (note.pid === process.pid) rmSync(file, { force: true });
    } catch {
      // gone already
    }
  };
}

/** The log keeps one older file; past this size the current one becomes `runner.old.log`. */
const LOG_LIMIT = 2 * 1024 * 1024;

function openLog(file: string): number {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (existsSync(file) && statSync(file).size > LOG_LIMIT) renameSync(file, file.replace(/\.log$/, ".old.log"));
  } catch {
    // another process holds it (Windows): keep appending
  }
  return openSync(file, "a");
}

/** Starts `watchwright runner --server <server>` as its own process with no window; resolves once it has run a moment (or exited). */
export async function startBackground(h: Host, server: string, waitMs = 1500): Promise<{ ok: true; pid: number; log: string } | { ok: false; log: string; output: string }> {
  const log = runnerLogFile(h.env);
  const fd = openLog(log);
  const child = spawn(h.node, [h.script, "runner", "--server", server], {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...h.env, [SERVICE_ENV]: h.env[SERVICE_ENV] || "background" },
  });
  closeSync(fd);
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  child.unref();
  const end = Date.now() + waitMs;
  while (!exited && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  if (exited) {
    let output = "";
    try {
      output = readFileSync(log, "utf8").trimEnd().split(/\r?\n/).slice(-8).join("\n");
    } catch {
      // no log
    }
    return { ok: false, log, output };
  }
  return { ok: true, pid: child.pid ?? 0, log };
}

/** Stops the background runner, if one runs. */
export function stopBackground(env: NodeJS.ProcessEnv): boolean {
  const r = backgroundRunner(env);
  if (!r) return false;
  try {
    process.kill(r.pid);
  } catch {
    return false;
  }
  rmSync(pidFile(env), { force: true });
  return true;
}

export interface ServiceState {
  /** The start-up entry built in here, or null. */
  kind: ServiceKind | null;
  installed: boolean;
  file: string | null;
  /** The server the entry connects to. */
  server: string | null;
  running: boolean;
}

const SERVER_IN = /runner(?: start)? --server (?:"([^"]+)"|'([^']+)'|(\S+?))(?:<\/string>|\s|$)/;

/** The server an entry's file connects to. */
export function serverOf(content: string): string | null {
  const plist = content.match(/<string>--server<\/string>\s*<string>([^<]+)<\/string>/);
  if (plist) return plist[1]!;
  const m = content.match(SERVER_IN);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

const userFlag = (h: Host) => (h.uid === 0 ? [] : ["--user"]);
const launchTarget = (h: Host) => `gui/${h.uid}`;

export function serviceState(h: Host): ServiceState {
  const kind = serviceKind(h);
  const file = kind ? serviceFile(h, kind) : null;
  const installed = !!file && h.exists(file);
  let server: string | null = null;
  if (installed && file) {
    try {
      server = serverOf(readFileSync(file, "utf8"));
    } catch {
      server = null;
    }
  }
  let running = !!backgroundRunner(h.env);
  if (installed && kind === "systemd") running = h.run("systemctl", [...userFlag(h), "is-active", "--quiet", UNIT]).status === 0;
  if (installed && kind === "launchd") running = /\bpid = \d+/.test(h.run("launchctl", ["print", `${launchTarget(h)}/${LABEL}`]).out);
  return { kind, installed, file, server, running };
}

export class ServiceError extends Error {}

/** Writes the start-up entry for `server` and starts it now. Answers lines to show. */
export async function installService(h: Host, server: string): Promise<string[]> {
  const kind = serviceKind(h);
  if (!kind) {
    throw new ServiceError(
      "This system has no systemd, so there is no start-up entry to write. Start the runner in the background with `watchwright runner start` from whatever starts programs here (an init script, cron's @reboot).",
    );
  }
  const file = serviceFile(h, kind);
  const before = serviceState(h);
  if (before.installed) await uninstallService(h, { quiet: true });
  stopBackground(h.env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serviceContent(h, kind, server));
  const lines = [`Wrote ${file}.`];
  if (h.kind === "npx") lines.push(`It starts watchwright@${VERSION} through npx (downloaded again if npx's cache is cleared).`);
  switch (kind) {
    case "windows": {
      const started = await startBackground(h, server);
      if (!started.ok) {
        rmSync(file, { force: true });
        throw new ServiceError(`The runner stopped right away, so the start-up entry was removed again. Its log (${started.log}) ends with:\n${started.output}`);
      }
      lines.push(`The runner runs now with no window, and starts again each time you sign in. Its log is ${started.log}.`);
      break;
    }
    case "systemd": {
      const u = userFlag(h);
      h.run("systemctl", [...u, "daemon-reload"]);
      const r = h.run("systemctl", [...u, "enable", "--now", UNIT]);
      if (r.status !== 0) {
        h.run("systemctl", [...u, "disable", UNIT]);
        rmSync(file, { force: true });
        throw new ServiceError(`systemctl ${[...u, "enable", "--now", UNIT].join(" ")} failed${r.out ? `:\n${r.out}` : "."}`);
      }
      lines.push(`The runner runs now and starts again at ${h.uid === 0 ? "boot" : "sign-in"}. Its log: journalctl ${[...u, "-u", UNIT].join(" ")}`);
      if (h.uid !== 0) {
        const user = h.env.USER || os.userInfo().username;
        const linger = h.run("loginctl", ["enable-linger", user]);
        lines.push(
          linger.status === 0
            ? "Lingering is on for your user, so it also starts at boot before anyone signs in."
            : `To start it at boot before anyone signs in, run: sudo loginctl enable-linger ${shQuote(user)}`,
        );
      }
      break;
    }
    case "launchd": {
      h.run("launchctl", ["bootout", `${launchTarget(h)}/${LABEL}`]);
      const r = h.run("launchctl", ["bootstrap", launchTarget(h), file]);
      if (r.status !== 0 && h.run("launchctl", ["load", "-w", file]).status !== 0) {
        rmSync(file, { force: true });
        throw new ServiceError(`launchctl couldn't load ${file}${r.out ? `:\n${r.out}` : "."}`);
      }
      lines.push(`The runner runs now and starts again each time you sign in. Its log is ${runnerLogFile(h.env)}.`);
      break;
    }
  }
  return lines;
}

/**
 * Removes the start-up entry and stops the runner it started. `self`: called by that runner after
 * the server removed it, so it doesn't stop itself through the service manager (it exits next).
 */
export async function uninstallService(h: Host, opts: { self?: boolean; quiet?: boolean } = {}): Promise<string[]> {
  const kind = serviceKind(h);
  const file = kind ? serviceFile(h, kind) : null;
  const lines: string[] = [];
  if (kind && file && h.exists(file)) {
    if (kind === "systemd") {
      const u = userFlag(h);
      // From inside the unit, `--now` would wait for this very process to stop.
      h.run("systemctl", [...u, "disable", ...(opts.self ? [] : ["--now"]), UNIT]);
      rmSync(file, { force: true });
      h.run("systemctl", [...u, "daemon-reload"]);
    } else if (kind === "launchd") {
      if (!opts.self) h.run("launchctl", ["bootout", `${launchTarget(h)}/${LABEL}`]);
      rmSync(file, { force: true });
    } else {
      rmSync(file, { force: true });
    }
    lines.push(`Removed ${file}.`);
  }
  if (!opts.self && stopBackground(h.env)) lines.push("Stopped the runner that was running in the background.");
  if (!lines.length && !opts.quiet) lines.push("No runner start-up entry here.");
  return lines;
}
