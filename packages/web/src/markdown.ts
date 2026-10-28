// Helpers around Markdown files: safe link targets, relative links and images inside a pack,
// and finding a folder's README. The reader itself is in markdown-parse.ts, which
// MarkdownView loads on first use.

/** A link target that is safe to follow: http(s), mailto, an anchor or a relative path. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (!scheme) return h; // relative path or #anchor
  return ["http", "https", "mailto"].includes((scheme[1] ?? "").toLowerCase()) ? h : null;
}

/**
 * Where a relative link in the file `from` points, as a path from the same root ("docs/a.md"
 * linking "../README.md#use" gives "README.md"). Null for a link that leaves the root, for a
 * bare "#anchor" and for anything with a scheme.
 */
export function resolveRelative(from: string, target: string): string | null {
  const bare = target.replace(/[?#].*$/, "");
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare)) return null;
  let name: string;
  try {
    name = decodeURIComponent(bare);
  } catch {
    name = bare;
  }
  const parts = name.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const seg of name.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

/** The README at the top of a folder, from its file paths: README.md first, then other spellings. */
export function findReadme(paths: readonly string[]): string | null {
  const top = paths.filter((p) => !p.includes("/") && /^readme(\.(md|markdown|mdown|txt))?$/i.test(p));
  const rank = (p: string) => (/\.(md|markdown|mdown)$/i.test(p) ? 0 : /\./.test(p) ? 2 : 1) * 2 + (p.startsWith("README") ? 0 : 1);
  return top.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] ?? null;
}

/** The address of an image in a pack, for a relative image link in the pack file `from`. */
export function packImageUrl(packId: string, from: string, src: string): string | null {
  const to = resolveRelative(from, src);
  return to ? `/api/v1/packs/${packId}/image?path=${encodeURIComponent(to)}` : null;
}
