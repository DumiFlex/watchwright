import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 7420;
export const DEFAULT_HOST = "127.0.0.1";

/** Host names the server may bind to in step 1 (LAN access waits for token auth, see docs/plan.md). */
export const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

export interface DataDirInput {
  flag?: string | undefined;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

/** Where the store lives: --data, else WATCHWRIGHT_DATA, else the OS's usual place for app data. */
export function resolveDataDir({ flag, env = process.env, platform = process.platform, home = homedir() }: DataDirInput = {}): string {
  if (flag) return path.resolve(flag);
  if (env.WATCHWRIGHT_DATA) return path.resolve(env.WATCHWRIGHT_DATA);
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return path.win32.join(base, "Watchwright");
  }
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Watchwright");
  const xdg = env.XDG_DATA_HOME ?? path.posix.join(home, ".local", "share");
  return path.posix.join(xdg, "watchwright");
}
