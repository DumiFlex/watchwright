import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";

// How much room runs take and how much the drive has left.

export const GB = 1024 ** 3;

/** Bytes of every file under `dir` (0 when it doesn't exist). Links aren't followed. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += await stat(p).then((s) => s.size, () => 0);
  }
  return total;
}

/** Free and total bytes of the drive that holds `dir`, or null when the system can't say. */
export async function driveSpace(dir: string): Promise<{ freeBytes: number; totalBytes: number } | null> {
  try {
    const s = await statfs(dir);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/** "820 B", "12 KB", "3.4 MB", "1.2 GB": sizes as messages and logs write them. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}
