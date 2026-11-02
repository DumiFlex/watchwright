import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// How this copy of Watchwright was installed, and the newest version on npm. Only node: imports
// here: the `watchwright update` command and the server's updates plugin both use it, and the
// command must not load the server (docs: guide/updating).

/**
 * `npm`: a global npm install (`npm install -g watchwright`), which `watchwright update` replaces.
 * `docker`: the Docker image; a new version is a new image. `npx`: npx's cache, which takes the
 * newest version by itself. `other`: a project's dependency or a checkout of the repository.
 */
export type InstallKind = "npm" | "docker" | "npx" | "other";

/** The package's own folder (the one with package.json), from this file in src/ or dist/. */
export function packageRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** npm's global node_modules folder, or null when npm doesn't answer. */
export function npmGlobalRoot(): string | null {
  const win = process.platform === "win32";
  const out = spawnSync(win ? "npm.cmd root -g" : "npm", win ? [] : ["root", "-g"], { encoding: "utf8", shell: win, windowsHide: true, timeout: 15_000 });
  const root = out.status === 0 ? out.stdout.trim().split(/\r?\n/).pop() : undefined;
  return root || null;
}

export interface InstallFacts {
  env: NodeJS.ProcessEnv;
  root: string;
  /** npm's global node_modules folder; asked only when needed. */
  globalRoot: () => string | null;
}

export function installKind(facts: InstallFacts = { env: process.env, root: packageRoot(), globalRoot: npmGlobalRoot }): InstallKind {
  if (facts.env.WATCHWRIGHT_INSTALL === "docker") return "docker";
  const root = real(facts.root);
  if (root.split(/[\\/]/).includes("_npx")) return "npx";
  const global = facts.globalRoot();
  if (global && real(path.join(global, "watchwright")) === root) return "npm";
  return "other";
}

/** What to do instead of `watchwright update`, for installs it can't update. */
export function howToUpdate(kind: InstallKind): string {
  switch (kind) {
    case "npm":
      return "Run `watchwright update`, or press Update in Settings › Server.";
    case "docker":
      return "Pull the new image and recreate the container. Portainer: open the stack and press Update the stack with Re-pull image on. Docker Compose: `docker compose pull && docker compose up -d`.";
    case "npx":
      return "npx starts the newest version by itself: run `npx watchwright@latest`.";
    case "other":
      return "This copy isn't a global npm install (it's a project's dependency or a checkout), so update it the way it was installed, such as `npm install watchwright@latest` in that project.";
  }
}

/** Where versions are looked up: WATCHWRIGHT_NPM_REGISTRY, else npm's registry setting, else npmjs.org. */
export function registryUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.WATCHWRIGHT_NPM_REGISTRY || env.npm_config_registry || "https://registry.npmjs.org/";
  return url.endsWith("/") ? url : `${url}/`;
}

/** The version npm's `latest` tag points at. Throws with a readable message when the registry doesn't answer. */
export async function latestVersion(env: NodeJS.ProcessEnv = process.env, timeoutMs = 8000): Promise<string> {
  const url = `${registryUrl(env)}watchwright/latest`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error(`npm's registry (${registryUrl(env)}) didn't answer.`);
  }
  const body = (await res.json().catch(() => null)) as { version?: unknown } | null;
  if (!res.ok || typeof body?.version !== "string" || !VERSION_RE.test(body.version)) throw new Error(`npm's registry answered ${res.status} without a version.`);
  return body.version;
}

/** A version npm can install: 1.2.3, maybe with a pre-release (1.2.3-beta.1). */
export const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Whether `b` is newer than `a`. A pre-release is older than its release. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [main = "", pre] = v.split("-", 2);
    return { nums: main.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (y.nums[i] ?? 0) - (x.nums[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (x.pre === null) return false;
  if (y.pre === null) return true;
  return y.pre.localeCompare(x.pre, undefined, { numeric: true }) > 0;
}
