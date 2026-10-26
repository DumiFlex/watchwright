import { readdirSync } from "node:fs";
import path from "node:path";

// A small glob for test file patterns: `*`, `?`, `**` and `{a,b}`. Patterns are relative to the
// pack folder and always use forward slashes. node_modules and dot folders are never searched.

export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        const slash = pattern[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${pattern
          .slice(i + 1, end)
          .split(",")
          .map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
          .join("|")})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), r, out);
    else if (entry.isFile()) out.push(r);
  }
}

/** Files under `root` matching any pattern, as sorted relative paths with forward slashes. */
export function glob(root: string, patterns: readonly string[]): string[] {
  const all: string[] = [];
  walk(root, "", all);
  const res = patterns.map((p) => globToRegExp(p.replace(/^\.\//, "")));
  return all.filter((f) => res.some((re) => re.test(f))).sort();
}
