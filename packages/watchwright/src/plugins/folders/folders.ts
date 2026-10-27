import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { serviceKey } from "../../core/services.js";

// A web page can't learn a folder's absolute path (the browser hides it on purpose), so the server,
// which runs on the same machine, lists folders for the page's own folder browser. It lists folder
// names and the marker files plugins ask about (a pack file), never other files or contents.
// See docs/plans/step-qol.md, section 2.

/** A file name that makes a folder special, registered by the plugin that cares (packs: pack.ts). */
export interface FolderMarker {
  kind: string;
  files: readonly string[];
}

export interface FolderEntry {
  name: string;
  path: string;
  /** Markers found in this folder: `{ pack: "pack.ts" }`. */
  marks: Record<string, string>;
}

export interface FolderListing {
  path: string;
  /** The folder above, or null at a root. */
  parent: string | null;
  sep: string;
  /** Markers found in this folder itself. */
  marks: Record<string, string>;
  folders: FolderEntry[];
  /** True when the folder had more sub-folders than the listing shows. */
  truncated: boolean;
}

export interface FolderPlaces {
  home: string;
  sep: string;
  /** Drives on Windows (`C:\`), `/` elsewhere. */
  roots: string[];
  recent: { path: string; usedAt: string; exists: boolean }[];
}

export class FolderError extends Error {
  constructor(
    readonly code: "bad_path" | "not_found" | "not_a_folder" | "unreadable" | "not_allowed",
    message: string,
  ) {
    super(message);
  }
}

export const MAX_ENTRIES = 1000;
const MAX_RECENT = 10;
// Hidden and system folders nobody keeps a pack in.
const SKIP_NAME = /^(\.|\$)|^(System Volume Information|node_modules)$/;

export const FOLDERS_MIGRATION_SQL = `
  CREATE TABLE folders_recent (
    path    TEXT PRIMARY KEY,
    used_at TEXT NOT NULL
  );
`;

/**
 * Turns what people paste into a plain absolute path: surrounding quotes (Windows "Copy as path"),
 * `file://` URLs, `~`, and a trailing separator. Relative paths are refused with the path they'd
 * have meant, because the server's working folder is rarely what the person had in mind.
 */
export function cleanPath(input: string, opts: { home?: string; platform?: NodeJS.Platform; cwd?: string } = {}): string {
  const p = opts.platform === "win32" || (opts.platform === undefined && process.platform === "win32") ? path.win32 : path.posix;
  const home = opts.home ?? homedir();
  let s = input.trim();
  while (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) s = s.slice(1, -1).trim();
  if (s === "") throw new FolderError("bad_path", "Give a folder path.");
  if (/^file:\/\//i.test(s)) {
    try {
      s = fileURLToPath(s, { windows: p === path.win32 });
    } catch {
      throw new FolderError("bad_path", `${input.trim()} isn't a file address this machine can open.`);
    }
  }
  if (p === path.win32 && /^[a-z]:$/i.test(s)) s += "\\";
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = p.join(home, s.slice(1));
  if (!p.isAbsolute(s) || (p === path.win32 && /^[\\/][^\\/]/.test(s))) {
    throw new FolderError("bad_path", `"${s}" is a relative path. Give the full path, such as ${p.resolve(opts.cwd ?? home, s)}.`);
  }
  const out = p.normalize(s);
  // keep a root's separator (C:\ or /), drop any other trailing one
  return out.length > p.parse(out).root.length ? out.replace(/[\\/]+$/, "") : out;
}

/** Lists folders, remembers recent ones, and opens folders the server knows in the system's file manager. */
export class FolderService {
  private readonly markers: FolderMarker[] = [];
  private readonly openable: ((dir: string) => boolean)[] = [];

  constructor(
    private readonly db: Database.Database,
    private readonly opts: { home?: string; platform?: NodeJS.Platform; dataDir?: string } = {},
  ) {
    const data = opts.dataDir;
    if (data && data !== ":memory:") this.allowOpen((dir) => isInside(dir, data));
  }

  get home(): string {
    return this.opts.home ?? homedir();
  }

  private get platform(): NodeJS.Platform {
    return this.opts.platform ?? process.platform;
  }

  /** Plugins call this in setup so folder listings mark the folders they care about. */
  addMarker(marker: FolderMarker): void {
    this.markers.push(marker);
  }

  /** Plugins call this in setup to say which folders `open` may show (pack folders, run folders). */
  allowOpen(check: (dir: string) => boolean): void {
    this.openable.push(check);
  }

  clean(input: string): string {
    return cleanPath(input, { home: this.home, platform: this.platform });
  }

  marksOf(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of this.markers) {
      const hit = m.files.find((f) => isFile(path.join(dir, f)));
      if (hit) out[m.kind] = hit;
    }
    return out;
  }

  list(input: string, opts: { hidden?: boolean } = {}): FolderListing {
    const dir = this.clean(input);
    if (!existsSync(dir)) throw new FolderError("not_found", `There is no folder at ${dir}.`);
    if (!statSync(dir).isDirectory()) throw new FolderError("not_a_folder", `${dir} is a file, not a folder.`);
    let names: string[];
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() || (d.isSymbolicLink() && isDir(path.join(dir, d.name))))
        .map((d) => d.name)
        .filter((n) => opts.hidden || !SKIP_NAME.test(n));
    } catch {
      throw new FolderError("unreadable", `Watchwright can't read ${dir}.`);
    }
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    const shown = names.slice(0, MAX_ENTRIES);
    const parent = path.dirname(dir);
    return {
      path: dir,
      parent: parent === dir ? null : parent,
      sep: path.sep,
      marks: this.marksOf(dir),
      folders: shown.map((name) => {
        const p = path.join(dir, name);
        return { name, path: p, marks: this.marksOf(p) };
      }),
      truncated: names.length > shown.length,
    };
  }

  places(): FolderPlaces {
    return { home: this.home, sep: path.sep, roots: this.roots(), recent: this.recent() };
  }

  roots(): string[] {
    if (this.platform !== "win32") return ["/"];
    const out: string[] = [];
    for (let c = 65; c <= 90; c++) {
      const drive = `${String.fromCharCode(c)}:\\`;
      if (existsSync(drive)) out.push(drive);
    }
    return out;
  }

  recent(): FolderPlaces["recent"] {
    const rows = this.db.prepare("SELECT path, used_at FROM folders_recent ORDER BY used_at DESC, rowid DESC LIMIT ?").all(MAX_RECENT) as { path: string; used_at: string }[];
    return rows.map((r) => ({ path: r.path, usedAt: r.used_at, exists: isDir(r.path) }));
  }

  /** Puts a folder at the top of the recent list (the list keeps the newest ten). */
  remember(dir: string): void {
    this.db.prepare("INSERT INTO folders_recent (path, used_at) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET used_at = excluded.used_at").run(dir, new Date().toISOString());
    this.db.prepare("DELETE FROM folders_recent WHERE path NOT IN (SELECT path FROM folders_recent ORDER BY used_at DESC, rowid DESC LIMIT ?)").run(MAX_RECENT);
  }

  forget(dir?: string): void {
    if (dir === undefined) this.db.prepare("DELETE FROM folders_recent").run();
    else this.db.prepare("DELETE FROM folders_recent WHERE path = ?").run(dir);
  }

  /** Shows a folder in Explorer, Finder or the desktop's file manager. Only folders a plugin allowed. */
  open(input: string, launch: (cmd: string, args: string[]) => void = launchDetached): string {
    const dir = this.clean(input);
    if (!isDir(dir)) throw new FolderError("not_found", `There is no folder at ${dir}.`);
    if (!this.openable.some((ok) => ok(dir))) throw new FolderError("not_allowed", "Watchwright only opens pack folders and its own run folders.");
    // Always a folder, so the file manager shows it; it never runs a file.
    if (this.platform === "win32") launch("explorer.exe", [dir]);
    else if (this.platform === "darwin") launch("open", [dir]);
    else launch("xdg-open", [dir]);
    return dir;
  }
}

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function launchDetached(cmd: string, args: string[]): void {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // no file manager on this system
  }
}

export const FOLDERS = serviceKey<FolderService>("folders.service");
