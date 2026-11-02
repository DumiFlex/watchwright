import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    readonly code: "bad_zip" | "no_pack_file" | "too_big" | "exists" | "bad_name",
    message: string,
  ) {
    super(message);
  }
}

/** Every file of a pack folder as zip entries under `<folder name>/`, leaving out dependencies, VCS folders and links. */
export function packEntries(dir: string): ZipEntry[] {
  const root = path.basename(dir);
  const out: ZipEntry[] = [];
  let total = 0;
  const walk = (at: string, rel: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = path.join(at, name);
      const st = lstatSync(full);
      const inZip = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full, inZip);
      } else if (st.isFile()) {
        total += st.size;
        if (total > UNPACKED_MAX_BYTES || out.length >= MAX_FILES) throw new ArchiveError("too_big", `The pack folder is over ${UNPACKED_MAX_BYTES / 1024 / 1024} MB or ${MAX_FILES} files; copy it off the server instead.`);
        out.push({ name: `${root}/${inZip}`, data: readFileSync(full) });
      }
      // Links and other special files stay out: a link could point anywhere on the machine.
    }
  };
  walk(dir, "");
  return out;
}

export function packZip(dir: string): Buffer {
  return zip(packEntries(dir));
}

/** A zip entry's path made safe, or null to skip it (folders, macOS resource forks). Throws on paths that leave the folder. */
function safeName(raw: string): string | null {
  const name = raw.replace(/\\/g, "/");
  if (name.endsWith("/") || name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store") return null;
  const parts = name.split("/").filter((p) => p !== "" && p !== ".");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || parts.some((p) => p === "..") || parts.length === 0) throw new ArchiveError("bad_zip", `The zip has a file outside its folder: ${raw}`);
  return parts.join("/");
}

/** The zip's files with paths relative to the pack folder: a single top folder around everything is dropped. */
export function packFiles(buf: Buffer): ZipEntry[] {
  let entries: ZipEntry[];
  try {
    entries = unzip(buf, { maxEntries: MAX_FILES * 2, maxBytes: UNPACKED_MAX_BYTES });
  } catch (err) {
    if (err instanceof ZipLimitError) throw new ArchiveError("too_big", err.message);
    throw new ArchiveError("bad_zip", `This isn't a zip file Watchwright can read (${err instanceof Error ? err.message : String(err)}).`);
  }
  const files: ZipEntry[] = [];
  for (const e of entries) {
    const name = safeName(e.name);
    if (name !== null) files.push({ name, data: e.data });
  }
  if (files.length > MAX_FILES) throw new ArchiveError("too_big", `The zip has more than ${MAX_FILES} files.`);
  const atRoot = (list: ZipEntry[]) => list.some((f) => PACK_FILES.includes(f.name));
  if (atRoot(files)) return files;
  const tops = new Set(files.map((f) => f.name.split("/")[0]));
  if (tops.size === 1 && files.every((f) => f.name.includes("/"))) {
    const top = [...tops][0]!;
    const inner = files.map((f) => ({ name: f.name.slice(top.length + 1), data: f.data }));
    if (atRoot(inner)) return inner;
  }
  throw new ArchiveError("no_pack_file", `The zip has no pack file (${PACK_FILES.join(", ")}) at its top or in a single folder at its top.`);
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

/** Unpacks a pack zip into `<parent>/<name>`, a folder that must not exist yet. Returns the new folder. */
export function unpackPack(buf: Buffer, parent: string, name: string): string {
  const files = packFiles(buf);
  const dir = path.join(parent, folderName(name));
  if (existsSync(dir)) throw new ArchiveError("exists", `${dir} already exists. Pick another name.`);
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
  return dir;
}
