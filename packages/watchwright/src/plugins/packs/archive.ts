import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unzip, zip, ZipLimitError, type ZipEntry } from "../../jobs/zip.js";
import { PACK_FILES } from "./loader.js";

// Packs as .zip files: a pack's folder packed for download, and a downloaded (or hand-made) zip
// unpacked into a new folder, so a server without a desktop can get packs in and out through
// the web page (docs/plans/self-hosting.md).

/** The biggest zip the server takes, and the most it may unpack to. */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const UNPACKED_MAX_BYTES = 200 * 1024 * 1024;
export const MAX_FILES = 5000;

/** Folders that are never packed: installed dependencies and version control. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn"]);

export class ArchiveError extends Error {
  constructor(
    readonly code: "bad_zip" | "no_pack_file" | "too_big" | "exists" | "bad_name" | "not_a_folder" | "busy",
    message: string,
  ) {
    super(message);
  }
}

const inside = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The deepest folder holding every given folder, or null (two drives on Windows). */
function commonFolder(dirs: string[]): string | null {
  let common = dirs[0]!;
  for (const d of dirs.slice(1)) {
    while (!inside(d, common)) {
      const up = path.dirname(common);
      if (up === common) return null;
      common = up;
    }
  }
  return common;
}

/**
 * Where a pack's zip starts: the pack's folder, or, when the pack imports files from outside it
 * (`outside`, from its build), the folder that holds them all, so the zip keeps the layout the
 * imports need. `top` is the folder name the zip's files sit in.
 */
export function zipRoot(dir: string, outside: readonly string[] = []): { root: string; top: string; extra: string[] } {
  const extra = outside.filter((f) => !inside(f, dir));
  const root = extra.length > 0 ? commonFolder([dir, ...extra.map((f) => path.dirname(f))]) : dir;
  if (!root || root === path.parse(root).root) return { root: dir, top: path.basename(dir) || "pack", extra: [] };
  return { root, top: path.basename(root), extra: root === dir ? [] : extra };
}

/**
 * Every file of a pack folder as zip entries under `<folder name>/`, leaving out dependencies, VCS
 * folders and links. Files from `outside` the folder (shared files the pack imports) come along
 * at their place beside it, under the name of the folder that holds them all.
 */
export function packEntries(dir: string, outside: readonly string[] = []): ZipEntry[] {
  const { root, top, extra } = zipRoot(dir, outside);
  const out: ZipEntry[] = [];
  let total = 0;
  const add = (full: string, size: number) => {
    total += size;
    if (total > UNPACKED_MAX_BYTES || out.length >= MAX_FILES) throw new ArchiveError("too_big", `The pack folder is over ${UNPACKED_MAX_BYTES / 1024 / 1024} MB or ${MAX_FILES} files; copy it off the server instead.`);
    out.push({ name: [top, ...path.relative(root, full).split(path.sep)].join("/"), data: readFileSync(full) });
  };
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = path.join(at, name);
      const st = lstatSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
      } else if (st.isFile()) add(full, st.size);
      // Links and other special files stay out: a link could point anywhere on the machine.
    }
  };
  walk(dir);
  for (const f of extra) {
    let st;
    try {
      st = lstatSync(f);
    } catch {
      continue; // gone since the build
    }
    if (st.isFile()) add(f, st.size);
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function packZip(dir: string, outside: readonly string[] = []): Buffer {
  return zip(packEntries(dir, outside));
}

/** A zip entry's path made safe, or null to skip it (folders, macOS resource forks). Throws on paths that leave the folder. */
function safeName(raw: string): string | null {
  const name = raw.replace(/\\/g, "/");
  if (name.endsWith("/") || name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store") return null;
  const parts = name.split("/").filter((p) => p !== "" && p !== ".");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || parts.some((p) => p === "..") || parts.length === 0) throw new ArchiveError("bad_zip", `The zip has a file outside its folder: ${raw}`);
  return parts.join("/");
}

const isPackFile = (name: string) => PACK_FILES.includes(name.split("/").pop()!) && !name.split("/").some((p) => SKIP_DIRS.has(p));
const parentOf = (name: string) => (name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");

/**
 * The pack folders among a zip's files, shallowest first ("" is the top). A pack's direct
 * subfolders can be packs that share its files (bench/ and bench/smoke/); deeper pack files inside
 * a pack are its own fixtures. With no pack at the top, every pack folder counts, so a zip of a
 * folder of shared files with packs beside them works.
 */
export function packFolders(files: readonly ZipEntry[]): string[] {
  const dirs = [...new Set(files.filter((f) => isPackFile(f.name)).map((f) => parentOf(f.name)))];
  const depth = (d: string) => (d === "" ? 0 : d.split("/").length);
  dirs.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  return dirs.filter((d) => !dirs.some((p) => p !== d && (p === "" ? depth(d) > 1 : d.startsWith(`${p}/`) && depth(d) > depth(p) + 1)));
}

/**
 * The zip's files with paths relative to the new folder: a single top folder around everything is
 * dropped. A pack file must be at the top, or deeper beside files its packs share.
 */
export function packFiles(buf: Buffer): ZipEntry[] {
  let entries: ZipEntry[];
  try {
    entries = unzip(buf, { maxEntries: MAX_FILES * 2, maxBytes: UNPACKED_MAX_BYTES });
  } catch (err) {
    if (err instanceof ZipLimitError) throw new ArchiveError("too_big", err.message);
    throw new ArchiveError("bad_zip", `This isn't a zip file Watchwright can read (${err instanceof Error ? err.message : String(err)}).`);
  }
  let files: ZipEntry[] = [];
  for (const e of entries) {
    const name = safeName(e.name);
    if (name !== null) files.push({ name, data: e.data });
  }
  if (files.length > MAX_FILES) throw new ArchiveError("too_big", `The zip has more than ${MAX_FILES} files.`);
  if (!files.some((f) => PACK_FILES.includes(f.name))) {
    const tops = new Set(files.map((f) => f.name.split("/")[0]));
    if (tops.size === 1 && files.every((f) => f.name.includes("/"))) {
      const top = [...tops][0]!;
      files = files.map((f) => ({ name: f.name.slice(top.length + 1), data: f.data }));
    }
  }
  if (packFolders(files).length === 0) throw new ArchiveError("no_pack_file", `The zip has no pack file (${PACK_FILES.join(", ")}).`);
  return files;
}

/** A folder name from a file name or what someone typed: letters, digits, dot, dash, underscore and spaces. */
export function folderName(input: string): string {
  const name = input
    .replace(/\.zip$/i, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 80);
  if (!name) throw new ArchiveError("bad_name", "Give the pack's folder a name.");
  return name;
}

/** Writes the zip's files into `dir` (made here), removing it again when a write fails. */
function writeFiles(dir: string, files: readonly ZipEntry[]): void {
  mkdirSync(dir, { recursive: true });
  try {
    for (const f of files) {
      const to = path.join(dir, ...f.name.split("/"));
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, f.data, { flag: "wx" });
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

const packDirs = (dir: string, files: readonly ZipEntry[]) => packFolders(files).map((d) => (d === "" ? dir : path.join(dir, ...d.split("/"))));

/** The folder a pack zip unpacks into: `<parent>/<name>`, with the name made safe. */
export function uploadTarget(parent: string, name: string): string {
  return path.join(parent, folderName(name));
}

/**
 * Unpacks a pack zip into `<parent>/<name>`, a folder that must not exist yet. Returns the new
 * folder and the pack folders in it, shallowest first.
 */
export function unpackPack(buf: Buffer, parent: string, name: string): { dir: string; packs: string[] } {
  const files = packFiles(buf);
  const dir = uploadTarget(parent, name);
  if (existsSync(dir)) throw new ArchiveError("exists", `${dir} already exists.`);
  writeFiles(dir, files);
  return { dir, packs: packDirs(dir, files) };
}

/** Folders a replace keeps from the old folder when the zip has none there: installed dependencies and version control. */
function keptFolders(oldDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let names: string[];
    try {
      names = readdirSync(path.join(oldDir, rel));
    } catch {
      return;
    }
    for (const name of names) {
      const r = rel ? path.join(rel, name) : name;
      const st = lstatSync(path.join(oldDir, r));
      if (!st.isDirectory()) continue;
      if (SKIP_DIRS.has(name)) out.push(r);
      else walk(r);
    }
  };
  walk("");
  return out;
}

/**
 * Replaces the files of the existing folder `<parent>/<name>` with the zip's: an update of packs
 * uploaded before, or of a folder a removed pack left behind. Files the zip doesn't have are gone
 * afterwards, except installed dependencies and version control folders (`node_modules`, `.git`),
 * which stay where the new files still have their parent folder. The zip is unpacked beside the
 * folder first and swapped in by renaming, so a bad zip or a failed write leaves the old files
 * as they were.
 */
export function replacePack(buf: Buffer, parent: string, name: string): { dir: string; packs: string[] } {
  const files = packFiles(buf);
  const dir = uploadTarget(parent, name);
  if (!existsSync(dir)) return unpackPack(buf, parent, name);
  if (!statSync(dir).isDirectory()) throw new ArchiveError("not_a_folder", `${dir} is a file, not a folder.`);
  const tag = randomBytes(4).toString("hex");
  const base = path.basename(dir);
  const fresh = path.join(parent, `.${base}.upload-${tag}`);
  const old = path.join(parent, `.${base}.old-${tag}`);
  writeFiles(fresh, files);
  const moved: string[] = [];
  for (const rel of keptFolders(dir)) {
    const to = path.join(fresh, rel);
    if (existsSync(to) || !existsSync(path.dirname(to))) continue;
    try {
      renameSync(path.join(dir, rel), to);
      moved.push(rel);
    } catch {
      // left behind with the old files; the pack may need it installed again
    }
  }
  try {
    renameSync(dir, old);
  } catch (err) {
    // Put back what moved, so the folder is as it was.
    for (const rel of moved) {
      try {
        renameSync(path.join(fresh, rel), path.join(dir, rel));
      } catch {
        // nothing more to do
      }
    }
    rmSync(fresh, { recursive: true, force: true });
    throw new ArchiveError("busy", `Watchwright can't replace ${dir}: ${err instanceof Error ? err.message : String(err)}. Close programs that use files in it and try again.`);
  }
  try {
    renameSync(fresh, dir);
  } catch (err) {
    renameSync(old, dir);
    rmSync(fresh, { recursive: true, force: true });
    throw new ArchiveError("busy", `Watchwright can't replace ${dir}: ${err instanceof Error ? err.message : String(err)}.`);
  }
  rmSync(old, { recursive: true, force: true });
  return { dir, packs: packDirs(dir, files) };
}
