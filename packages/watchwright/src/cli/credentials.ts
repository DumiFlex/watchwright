import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The API tokens `watchwright login` saved, one per server, in the user's config folder
// (docs/plans/self-hosting.md, section 3). The file is readable by its owner only. The CLI and the
// stdio MCP bridge send the saved token for their server; WATCHWRIGHT_TOKEN wins over it.

export interface SavedLogin {
  token: string;
  /** The token's id on the server, so `watchwright logout` can remove it there too. */
  tokenId: string;
  /** Who it signs in as. */
  user: string;
  savedAt: string;
}

interface CredentialsFile {
  servers: Record<string, SavedLogin>;
}

/** The config folder: WATCHWRIGHT_CONFIG_DIR, else %APPDATA%\watchwright on Windows, else $XDG_CONFIG_HOME/watchwright or ~/.config/watchwright. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WATCHWRIGHT_CONFIG_DIR) return env.WATCHWRIGHT_CONFIG_DIR;
  if (process.platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "watchwright");
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "watchwright");
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDir(env), "credentials.json");
}

/** The key a server's login is saved under: its origin, so `http://host:7420` and `http://host:7420/` match. */
export function serverKey(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    return base.replace(/\/+$/, "");
  }
}

function read(env: NodeJS.ProcessEnv): CredentialsFile {
  const file = credentialsPath(env);
  if (!existsSync(file)) return { servers: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CredentialsFile> | null;
    return {
      servers: parsed && typeof parsed.servers === "object" && parsed.servers ? parsed.servers : {},
    };
  } catch {
    return { servers: {} };
  }
}

function write(data: CredentialsFile, env: NodeJS.ProcessEnv): void {
  const file = credentialsPath(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Written beside it and renamed, so a crash never leaves half a file; owner-only from the start.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows keeps the folder's permissions, which are the user's own under %APPDATA%.
  }
}

export function savedLogin(base: string, env: NodeJS.ProcessEnv = process.env): SavedLogin | null {
  return read(env).servers[serverKey(base)] ?? null;
}

export function saveLogin(base: string, login: SavedLogin, env: NodeJS.ProcessEnv = process.env): void {
  const data = read(env);
  data.servers[serverKey(base)] = login;
  write(data, env);
}

/** Forgets a server's login; false when there was none. */
export function forgetLogin(base: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const data = read(env);
  const key = serverKey(base);
  if (!data.servers[key]) return false;
  delete data.servers[key];
  write(data, env);
  return true;
}

/** The token to send to a server: WATCHWRIGHT_TOKEN, else the one `watchwright login` saved for it, else none. */
export function tokenFor(base: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const given = env.WATCHWRIGHT_TOKEN?.trim();
  if (given) return given;
  return savedLogin(base, env)?.token ?? null;
}
