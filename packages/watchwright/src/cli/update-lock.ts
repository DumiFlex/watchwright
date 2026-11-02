import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configDir } from "./credentials.js";

// While `watchwright update` replaces the package, it keeps a note in the config folder. The stdio
// MCP bridge reads it: a server that went away for an update comes back by itself, so the bridge
// waits for it instead of starting the old copy (which would hold the files npm is replacing).

export interface UpdateLock {
  pid: number;
  from: string;
  to: string;
  startedAt: string;
}

/** An update that hasn't been heard from in this long is over, whatever its note says. */
const STALE_MS = 10 * 60_000;

export function lockPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), "updating.json");
}

export function writeLock(lock: UpdateLock, env: NodeJS.ProcessEnv = process.env): void {
  mkdirSync(configDir(env), { recursive: true });
  writeFileSync(lockPath(env), JSON.stringify(lock));
}

export function removeLock(env: NodeJS.ProcessEnv = process.env): void {
  rmSync(lockPath(env), { force: true });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The update going on now, or null: none, or its process is gone, or it is too old. */
export function currentUpdate(env: NodeJS.ProcessEnv = process.env, now = Date.now()): UpdateLock | null {
  let lock: UpdateLock;
  try {
    lock = JSON.parse(readFileSync(lockPath(env), "utf8")) as UpdateLock;
  } catch {
    return null;
  }
  if (typeof lock.pid !== "number" || !alive(lock.pid) || now - Date.parse(lock.startedAt) > STALE_MS) return null;
  return lock;
}
