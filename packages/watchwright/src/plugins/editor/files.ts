import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";

// The pack folder's text files, for the editor. Every path is relative to the pack folder and
// stays inside it: `..` and absolute paths are refused, and so is anything whose real path
// (after links) leads out. Only text files under MAX_BYTES are read or written.

export const MAX_BYTES = 1024 * 1024;
/** Folders the file list leaves out: installed packages, version control, build output. */
export const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "coverage", ".cache", ".watchwright", ".vscode", ".idea"]);
const TEXT_EXT = new Set([".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".yaml", ".yml", ".json", ".jsonc", ".md", ".markdown", ".txt", ".csv", ".tsv", ".html", ".htm", ".css", ".xml", ".svg", ".env", ".ini", ".toml", ".gitignore"]);
const MAX_FILES = 2000;

export type FileKind = "code" | "yaml" | "json" | "markdown" | "text";

export interface PackFile {
  /** Relative to the pack folder, with `/` between folders. */
  path: string;
  kind: FileKind;
  size: number;
  /** Too big to open in the editor. */
  big: boolean;
}

export interface FileContent {
  path: string;
  kind: FileKind;
  text: string;
  /** Names this version of the file; a save passes it back so changes made elsewhere aren't overwritten. */
  stamp: string;
}

export class FileError extends Error {
  constructor(
    readonly code: "bad_path" | "not_found" | "not_text" | "too_big" | "exists" | "stale",
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export function kindOf(file: string): FileKind {
  const ext = path.extname(file).toLowerCase();
  if ([".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"].includes(ext)) return "code";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".json" || ext === ".jsonc") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "text";
}

/** True for a file name the editor opens as text. */
export function isTextName(name: string): boolean {
  const base = path.basename(name);
  return TEXT_EXT.has(path.extname(base).toLowerCase()) || TEXT_EXT.has(base.toLowerCase()) || /^\.env(\..+)?$/.test(base) || /^(README|LICENSE|CHANGELOG)$/i.test(base);
}

export const stampOf = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** The absolute path of `rel` in the pack folder `dir`, or a FileError when it would lead out. */
export function resolveIn(dir: string, rel: string): string {
  if (typeof rel !== "string" || rel.trim() === "" || rel.includes("\0")) throw new FileError("bad_path", "Give a file path inside the pack folder.");
  const clean = rel.replaceAll("\\", "/");
  if (path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) throw new FileError("bad_path", `${rel} isn't a path inside the pack folder.`);
  const abs = path.resolve(dir, clean);
  if (!inside(abs, dir) || abs === dir) throw new FileError("bad_path", `${rel} isn't inside the pack folder.`);
  const parts = path.relative(dir, abs).split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p))) throw new FileError("bad_path", `${rel} is in a folder the editor leaves alone.`);
  // Follow links on the deepest part that exists: neither the file nor a folder above it may lead out.
  const realDir = realpathSync(dir);
  let probe = abs;
  while (!existsSync(probe) && probe !== dir) probe = path.dirname(probe);
  if (!inside(realpathSync(probe), realDir)) throw new FileError("bad_path", `${rel} leads out of the pack folder.`);
  return abs;
}

const relOf = (dir: string, abs: string) => path.relative(dir, abs).split(path.sep).join("/");

/** The pack folder's text files, sorted folders-first like a file tree. */
export function listFiles(dir: string): { files: PackFile[]; truncated: boolean } {
  const files: PackFile[] = [];
  let truncated = false;
  const walk = (folder: string) => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const abs = path.join(folder, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(abs);
      } else if (e.isFile() && isTextName(e.name)) {
        const size = statSync(abs).size;
        files.push({ path: relOf(dir, abs), kind: kindOf(e.name), size, big: size > MAX_BYTES });
      }
    }
  };
  walk(dir);
  return { files, truncated };
}

function readText(abs: string, rel: string): { text: string; stamp: string } {
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    throw new FileError("not_found", `${rel} doesn't exist.`);
  }
  if (!st.isFile() && !st.isSymbolicLink()) throw new FileError("not_text", `${rel} isn't a file.`);
  if (statSync(abs).size > MAX_BYTES) throw new FileError("too_big", `${rel} is over 1 MB, too big for the editor.`);
  const buf = readFileSync(abs);
  if (buf.includes(0)) throw new FileError("not_text", `${rel} isn't a text file.`);
  return { text: buf.toString("utf8"), stamp: stampOf(buf) };
}

/** Image types a pack may show in its Markdown, by extension. */
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** An image file in the pack folder, for a README or notes to show: its absolute path, type and size. */
export function packImage(dir: string, rel: string): { abs: string; type: string; size: number } {
  const abs = resolveIn(dir, rel);
  const type = IMAGE_TYPES[path.extname(abs).toLowerCase()];
  if (!type) throw new FileError("not_text", `${rel} isn't an image (.png, .jpg, .gif, .webp, .avif, .svg, .bmp, .ico).`);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new FileError("not_found", `${rel} doesn't exist.`);
  }
  if (!st.isFile()) throw new FileError("not_found", `${rel} isn't a file.`);
  if (st.size > MAX_IMAGE_BYTES) throw new FileError("too_big", `${rel} is over 20 MB.`);
  return { abs, type, size: st.size };
}

export function readPackFile(dir: string, rel: string): FileContent {
  const abs = resolveIn(dir, rel);
  return { path: relOf(dir, abs), kind: kindOf(abs), ...readText(abs, rel) };
}

/** Writes a file through a temporary file and a rename, so a crash never leaves half a file. */
function writeAtomic(abs: string, text: string): void {
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString("hex")}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, abs);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function checkWritable(rel: string, text: string): void {
  if (!isTextName(rel)) throw new FileError("not_text", `The editor only writes text files (.yaml, .ts, .json, .md, …), not ${path.basename(rel)}.`);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new FileError("too_big", "The text is over 1 MB.");
}

/**
 * Saves a file. `stamp` is the one the file was opened with: when the file changed on disk since,
 * nothing is written and the error carries what is there now. Leave `stamp` out to overwrite.
 */
export function savePackFile(dir: string, rel: string, text: string, stamp: string | null): FileContent {
  const abs = resolveIn(dir, rel);
  checkWritable(rel, text);
  if (stamp !== null) {
    if (!existsSync(abs)) throw new FileError("stale", `${rel} was deleted since you opened it.`, { text: null, stamp: null });
    const now = readText(abs, rel);
    if (now.stamp !== stamp) throw new FileError("stale", `${rel} changed on disk since you opened it.`, now);
  }
  writeAtomic(abs, text);
  return { path: relOf(dir, abs), kind: kindOf(abs), text, stamp: stampOf(text) };
}

export function createPackFile(dir: string, rel: string, text: string): FileContent {
  const abs = resolveIn(dir, rel);
  checkWritable(rel, text);
  if (existsSync(abs)) throw new FileError("exists", `${rel} already exists.`);
  writeAtomic(abs, text);
  return { path: relOf(dir, abs), kind: kindOf(abs), text, stamp: stampOf(text) };
}

export function renamePackFile(dir: string, from: string, to: string): { from: string; to: string } {
  const a = resolveIn(dir, from);
  const b = resolveIn(dir, to);
  if (!existsSync(a) || !lstatSync(a).isFile()) throw new FileError("not_found", `${from} doesn't exist.`);
  if (!isTextName(to)) throw new FileError("not_text", `The editor only names text files (.yaml, .ts, .json, .md, …), not ${path.basename(to)}.`);
  if (existsSync(b) && realpathSync(a) !== realpathSync(b)) throw new FileError("exists", `${to} already exists.`);
  mkdirSync(path.dirname(b), { recursive: true });
  renameSync(a, b);
  return { from: relOf(dir, a), to: relOf(dir, b) };
}

export function deletePackFile(dir: string, rel: string): { deleted: string } {
  const abs = resolveIn(dir, rel);
  if (!existsSync(abs) || !lstatSync(abs).isFile()) throw new FileError("not_found", `${rel} doesn't exist.`);
  rmSync(abs);
  return { deleted: relOf(dir, abs) };
}
