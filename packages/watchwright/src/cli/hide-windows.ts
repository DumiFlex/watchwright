import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

// On Windows a console program started by a process that has no console of its own gets a new
// console window. The server often has none (started by `watchwright mcp`, which detaches it, or
// by another background launcher), so every console program it starts would pop up a window:
// Playwright's ffmpeg for each attempt's video, a pack's own helper commands, and so on.
// Playwright doesn't pass `windowsHide` for those, so the server makes it the default for
// everything it starts. A caller that passes `windowsHide: false` still gets its window.

type Fn = ((...args: unknown[]) => unknown) & { [promisify.custom]?: (...args: unknown[]) => unknown };
type Patchable = Record<(typeof NAMES)[number], Fn>;

const NAMES = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"] as const;
const PATCHED = Symbol.for("watchwright.windowsHide");

/** Where a call's options object sits: after the command, and after the arguments array if any. */
function optionsIndex(name: string, args: unknown[]): number {
  if (name === "exec" || name === "execSync") return 1;
  if (Array.isArray(args[1])) return 2;
  // spawn(cmd, undefined, options)
  return args[1] == null && args.length > 2 ? 2 : 1;
}

/** The call's arguments with `windowsHide: true` added to its options unless it says otherwise. */
export function withWindowsHide(name: string, args: unknown[]): unknown[] {
  const out = [...args];
  const i = optionsIndex(name, out);
  const opts = out[i];
  if (opts && typeof opts === "object" && !Array.isArray(opts)) {
    if (!("windowsHide" in opts)) out[i] = { ...opts, windowsHide: true };
  } else if (opts == null && i < out.length) {
    out[i] = { windowsHide: true };
  } else {
    // no options given (a callback, or nothing, comes next)
    out.splice(i, 0, { windowsHide: true });
  }
  return out;
}

/** Makes `windowsHide: true` the default for every child process this process starts, on Windows. */
export function hideChildWindows(platform: NodeJS.Platform = process.platform, target: object = childProcess): boolean {
  if (platform !== "win32") return false;
  const cp = target as Patchable & { [PATCHED]?: true };
  if (cp[PATCHED]) return true;
  for (const name of NAMES) {
    const original = cp[name];
    if (typeof original !== "function") continue;
    const patched: Fn = function (this: unknown, ...args: unknown[]) {
      return original.apply(this, withWindowsHide(name, args));
    };
    // exec and execFile promisify to { stdout, stderr } through their own custom function
    const custom = original[promisify.custom];
    if (custom) patched[promisify.custom] = (...args: unknown[]) => custom(...withWindowsHide(name, args));
    cp[name] = patched;
  }
  cp[PATCHED] = true;
  // `import { spawn } from "node:child_process"` (packs, our own modules) sees the patched ones too
  if (target === childProcess) syncBuiltinESMExports();
  return true;
}
