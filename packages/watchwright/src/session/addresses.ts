import { realpathSync } from "node:fs";
import path from "node:path";

// Limits for what a YAML test or a recording may reach on the server's machine. YAML tests and
// recordings are open to users who can't change a pack's code (docs/research/teams-and-audience-
// dashboards.md), so they open only web addresses and upload only files from the pack's folder.
// Code tests are written by admins and keep Playwright's full reach.

const WEB = new Set(["http:", "https:"]);

/** `url` resolved against `base`; refuses anything but http(s) and about:blank (no `file:`, no `chrome:`). */
export function webAddress(url: string, base?: string | null): string {
  let full: URL;
  try {
    full = base ? new URL(url, base) : new URL(url);
  } catch {
    throw new Error(`${url} isn't a web address${base ? "" : " (the pack has no site.baseURL to resolve it against)"}.`);
  }
  if (full.href === "about:blank" || WEB.has(full.protocol)) return full.href;
  throw new Error(`Only http and https addresses open here, not ${full.protocol} (${url}).`);
}

const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** A file in the pack folder, by its path relative to it; refuses one that leads out (`..`, an absolute path, a link). */
export function packFile(packDir: string, rel: string): string {
  const abs = path.resolve(packDir, rel);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new Error(`${rel} doesn't exist in the pack folder.`);
  }
  if (!inside(real, realpathSync(packDir))) throw new Error(`${rel} isn't inside the pack folder.`);
  return abs;
}
