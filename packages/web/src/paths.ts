// Folder paths as the page shows and edits them. The server owns the real path rules (it runs on
// the machine); these helpers only split, shorten and complete paths for display and typing, for
// both Windows (`C:\a\b`) and POSIX (`/a/b`) paths whatever the browser's own system is.

export interface Crumb {
  label: string;
  path: string;
}

/** The separator a path uses: `\` for drive and UNC paths, else `/`. */
export function sepOf(p: string): "\\" | "/" {
  return /^[a-zA-Z]:|^\\\\/.test(p) || (p.includes("\\") && !p.includes("/")) ? "\\" : "/";
}

/** The root of an absolute path (`C:\`, `\\server\share\`, `/`), or "" for a relative one. */
export function rootOf(p: string): string {
  const drive = /^[a-zA-Z]:[\\/]?/.exec(p);
  if (drive) return `${drive[0].slice(0, 2)}\\`;
  const unc = /^\\\\[^\\]+\\[^\\]+\\?/.exec(p);
  if (unc) return unc[0].endsWith("\\") ? unc[0] : `${unc[0]}\\`;
  return p.startsWith("/") ? "/" : "";
}

/** One crumb per folder from the root down: `C:\`, `Users`, `sam`. */
export function crumbs(p: string): Crumb[] {
  const root = rootOf(p);
  if (!root) return [];
  const sep = sepOf(p);
  const parts = p.slice(root.length).split(/[\\/]/).filter(Boolean);
  const out: Crumb[] = [{ label: root === "/" ? "/" : root.replace(/\\$/, ""), path: root }];
  let at = root;
  for (const part of parts) {
    at = at.endsWith(sep) ? at + part : at + sep + part;
    out.push({ label: part, path: at });
  }
  return out;
}

/** The path with the home folder shown as `~`. */
export function tildify(p: string, home: string | null | undefined): string {
  if (!home) return p;
  const h = home.replace(/[\\/]+$/, "");
  const same = sepOf(p) === "\\" ? p.toLowerCase().startsWith(h.toLowerCase()) : p.startsWith(h);
  if (!same) return p;
  const rest = p.slice(h.length);
  if (rest === "") return "~";
  return /^[\\/]/.test(rest) ? `~${rest}` : p;
}

/** Splits a path for display as a head that may be cut short and a last folder that always shows. */
export function headTail(p: string): { head: string; tail: string } {
  const m = /^(.*[\\/])([^\\/]+)$/.exec(p);
  return m ? { head: m[1]!, tail: m[2]! } : { head: "", tail: p };
}

/** What a half-typed path is asking for: the folder to list and the start of a name in it. */
export function completionTarget(typed: string): { dir: string; partial: string } | null {
  const s = typed.replace(/^\s*["']/, "");
  if (!rootOf(s) && !s.startsWith("~")) return null;
  const cut = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  if (cut < 0) return null; // "~" or "C:" alone: nothing to list yet
  const dirPart = s.slice(0, cut + 1);
  return { dir: dirPart.length > rootOf(dirPart).length ? dirPart.replace(/[\\/]+$/, "") : dirPart, partial: s.slice(cut + 1) };
}

/** Names in a folder that start with what was typed, ignoring case. */
export function matchNames(names: readonly string[], partial: string): string[] {
  const p = partial.toLowerCase();
  return names.filter((n) => n.toLowerCase().startsWith(p));
}

/** The longest start every name shares (what Tab completes to when several match). */
export function commonPrefix(names: readonly string[]): string {
  if (names.length === 0) return "";
  let out = names[0]!;
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < out.length && i < n.length && out[i]!.toLowerCase() === n[i]!.toLowerCase()) i++;
    out = out.slice(0, i);
  }
  return out;
}

/** A child path: `join("C:\\a", "b")` is `C:\a\b`, `join("/", "srv")` is `/srv`. */
export function join(dir: string, name: string): string {
  const sep = sepOf(dir);
  return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + sep + name;
}

/** `file` relative to `dir` with `/` between folders, or null when it isn't inside `dir`. */
export function relativeTo(dir: string, file: string): string | null {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
  const d = norm(dir);
  const f = norm(file);
  const win = /^[a-zA-Z]:\//.test(d);
  const same = (a: string, b: string) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (f.length <= d.length + 1 || !same(f.slice(0, d.length), d) || f[d.length] !== "/") return null;
  return f.slice(d.length + 1);
}
