import path from "node:path";
import type { BrowserContext } from "playwright";

// Record from here in a code test: the test's code runs as usual, and the first Playwright call
// made from a line below the cursor stops it. Every page, locator and `expect` call goes through
// Playwright's client instrumentation (`onApiCallBegin`, internal but the hook Playwright's own test
// runner uses for steps), so a listener there sees each call before it is sent; it reads the call's
// stack, where source maps give the pack file and line, and throws to stop the test there.

/** Thrown into the test at its first Playwright call below the cursor. */
export class StopHere extends Error {
  constructor() {
    super("Stopped at the cursor to start recording.");
    this.name = "StopHere";
  }
}

interface Instrumentation {
  addListener(l: { onApiCallBegin?: () => void }): void;
  removeListener(l: { onApiCallBegin?: () => void }): void;
}

const FRAME = /(?:\(|at (?:async )?)(?:file:\/\/)?(\/?[A-Za-z]:[\\/][^():]+|\/[^():]+):(\d+):\d+\)?$/;

/** The line of the outermost frame in `file` (the test body itself), or null when it isn't on the stack. */
export function outermostLine(stack: string, file: string): number | null {
  const want = norm(file);
  let line: number | null = null;
  for (const l of stack.split("\n")) {
    const m = FRAME.exec(l.trim());
    if (m && norm(decodeURIComponent(m[1]!)) === want) line = Number(m[2]);
  }
  return line;
}

function norm(p: string): string {
  const r = path.resolve(p.replace(/^\/([A-Za-z]:)/, "$1"));
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/**
 * Stops the test at its first Playwright call from below `line` of `file`. Returns `stopped()`
 * (whether it did) and `release()`, which must run when the test is over. Null when this
 * Playwright has no client instrumentation to listen on.
 */
export function stopBelow(context: BrowserContext, file: string, line: number): { stopped: () => boolean; release: () => void } | null {
  const inst = (context as unknown as { _instrumentation?: Instrumentation })._instrumentation;
  if (!inst || typeof inst.addListener !== "function") return null;
  process.setSourceMapsEnabled(true);
  let stopped = false;
  const listener = {
    onApiCallBegin: () => {
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 200;
      const stack = new Error().stack ?? "";
      Error.stackTraceLimit = limit;
      const at = outermostLine(stack, file);
      // Calls from other files (other runs share the listener) pass. Once stopped, every later
      // call of the test stops too, in case it catches the first one.
      if (at !== null && (stopped || at > line)) {
        stopped = true;
        throw new StopHere();
      }
    },
  };
  inst.addListener(listener);
  return { stopped: () => stopped, release: () => inst.removeListener(listener) };
}
