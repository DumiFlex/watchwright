import path from "node:path";

// What kind of machine the server runs on: a desktop someone sits at, or a server with no screen
// (a container, a homelab box). Without a desktop there is no window to record in, no headed
// browser and no file manager to show a folder in (docs/plans/self-hosting.md, section 5).

const YES = ["1", "on", "true", "yes"];
const NO = ["0", "off", "false", "no"];

/**
 * Whether this machine has a screen: WATCHWRIGHT_SERVER_HOST on says no and off says yes; without it,
 * Windows and macOS have one and Linux has one when DISPLAY or WAYLAND_DISPLAY is set.
 */
export function hasDesktop(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  const flag = (env.WATCHWRIGHT_SERVER_HOST ?? "").trim().toLowerCase();
  if (YES.includes(flag)) return false;
  if (NO.includes(flag)) return true;
  if (platform === "win32" || platform === "darwin") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/**
 * The folders the web app's folder browser may show, from WATCHWRIGHT_FOLDERS (absolute paths,
 * separated by commas or the system's path separator); null when unset, which means anywhere
 * the server's account can read. The Docker image sets it to /packs.
 */
export function folderRoots(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] | null {
  const raw = env.WATCHWRIGHT_FOLDERS?.trim();
  if (!raw) return null;
  const p = platform === "win32" ? path.win32 : path.posix;
  const sep = platform === "win32" ? /[,;]/ : /[,:]/;
  const roots = raw
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s && p.isAbsolute(s))
    .map((s) => p.normalize(s).replace(/(.)[\\/]+$/, "$1"));
  return roots.length ? [...new Set(roots)] : null;
}
