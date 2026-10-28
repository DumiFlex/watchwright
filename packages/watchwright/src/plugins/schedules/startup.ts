import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Start at sign-in (docs/plans/groundwork.md, section 6): schedules only fire while the server runs,
// so on Windows Settings > Server can write a small .cmd file into the user's Startup folder that
// starts this server again (same port, same data folder, no browser). No compiled code and no
// PowerShell; turning it off deletes the file. macOS and Linux get the command for a LaunchAgent or
// a systemd user unit in the docs.

export interface StartupInfo {
  /** True where Watchwright can write the file itself (Windows). */
  supported: boolean;
  enabled: boolean;
  /** The file it writes, or null where it can't. */
  file: string | null;
  /** The command that starts this server again. */
  command: string;
}

export interface StartupPlace {
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows. */
  appData: string | undefined;
  /** The node program and the CLI script to run. */
  node: string;
  script: string;
}

export function hostPlace(): StartupPlace {
  return {
    platform: process.platform,
    appData: process.env["APPDATA"],
    node: process.execPath,
    script: fileURLToPath(new URL("../../cli/main.js", import.meta.url)),
  };
}

const quote = (s: string) => (/[\s"&^%]/.test(s) ? `"${s}"` : s);

export function startupCommand(place: StartupPlace, port: number, dataDir: string): string {
  return [place.node, place.script, "serve", "--port", String(port), "--data", dataDir, "--no-open"].map(quote).join(" ");
}

function fileOf(place: StartupPlace): string | null {
  if (place.platform !== "win32" || !place.appData) return null;
  return path.join(place.appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Watchwright.cmd");
}

export function startupInfo(place: StartupPlace, port: number, dataDir: string): StartupInfo {
  const file = fileOf(place);
  return { supported: file !== null, enabled: file !== null && existsSync(file), file, command: startupCommand(place, port, dataDir) };
}

/** The .cmd file: `start /min` so the server runs in a minimized window and the script's own window closes. */
export function startupScript(place: StartupPlace, port: number, dataDir: string): string {
  // In a .cmd file a single % starts a variable, so a % in a path is written twice.
  const command = startupCommand(place, port, dataDir).replaceAll("%", "%%");
  return ["@echo off", "rem Starts Watchwright when you sign in. Written by Settings > Server; turn it off there to delete this file.", `start "Watchwright" /min ${command}`, ""].join("\r\n");
}

export async function setStartup(place: StartupPlace, port: number, dataDir: string, enabled: boolean): Promise<StartupInfo> {
  const file = fileOf(place);
  if (!file) throw new Error("Start at sign-in is only built in on Windows. On macOS and Linux, use a LaunchAgent or a systemd user unit (see the docs).");
  if (enabled) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, startupScript(place, port, dataDir));
  } else {
    await rm(file, { force: true });
  }
  return startupInfo(place, port, dataDir);
}
