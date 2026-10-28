// A small Markdown reader for previews (pack READMEs, notes): CommonMark's common blocks
// plus GitHub's tables, task lists, strikethrough and bare links. It builds a tree that
// MarkdownView draws with Vue, so raw HTML in the text stays text and nothing is ever set
// as innerHTML. Links keep only safe schemes; anything else shows as plain text.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "em" | "strong" | "del"; c: Inline[] }
  | { t: "link"; href: string; title?: string | undefined; c: Inline[] }
  | { t: "img"; src: string; alt: string }
  | { t: "br" };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  /** null for a plain item, true or false for a task list box. */
  checked: boolean | null;
  c: Block[];
}

export type Block =
  | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[]; id: string; line: number }
  | { t: "p"; c: Inline[]; line: number }
  | { t: "code"; lang: string; v: string; line: number }
  | { t: "quote"; c: Block[]; line: number }
  | { t: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[]; line: number }
  | { t: "hr"; line: number }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][]; line: number };

export interface Heading {
  level: number;
  text: string;
  id: string;
  line: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^( {0,3})([-*+])([ \t]+|$)(.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_RULE = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const blank = (s: string) => s.trim() === "";

/** Reads `text` into blocks. `offset` is the line number of the first line (for nested parts). */
export function parseMarkdown(text: string): Block[] {
  const ids = new Map<string, number>();
  return blocks(text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"), 1, ids);
}

function blocks(lines: string[], first: number, ids: Map<string, number>): Block[] {
  const out: Block[] = [];
  let i = 0;
  const startsBlock = (s: string) => FENCE.test(s) || ATX.test(s) || HR.test(s) || QUOTE.test(s) || BULLET.test(s) || /^ {0,3}1[.)]([ \t]|$)/.test(s);

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const at = first + i;
    if (blank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1] ?? "```";
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(lines[i] ?? "")) {
        body.push((lines[i] ?? "").replace(new RegExp(`^ {0,${indent}}`), ""));
        i++;
      }
      i++; // the closing fence, or past the end
      out.push({ t: "code", lang: (fence[2] ?? "").toLowerCase(), v: body.join("\n"), line: at });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      out.push(heading(((atx[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6), atx[2] ?? "", at, ids));
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push({ t: "hr", line: at });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !blank(lines[i] ?? "")) {
        const m = QUOTE.exec(lines[i] ?? "");
        // A line without ">" continues the quote's paragraph (lazy continuation).
        inner.push(m ? (m[1] ?? "") : (lines[i] ?? ""));
        i++;
      }
      out.push({ t: "quote", c: blocks(inner, at, ids), line: at });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      const list = readList(lines, i, first, ids);
      out.push(list.block);
      i = list.next;
      continue;
    }

    // Indented code: four spaces, outside a paragraph.
    if (/^ {4}/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i] ?? "") || blank(lines[i] ?? ""))) {
        body.push((lines[i] ?? "").slice(4));
        i++;
      }
      while (body.length && blank(body.at(-1) ?? "")) body.pop();
      out.push({ t: "code", lang: "", v: body.join("\n"), line: at });
      continue;
    }

    // A table: a row with pipes, then a rule row.
    if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-")) {
      const head = cells(line);
      const align = cells(lines[i + 1] ?? "").map((c): Align => {
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : null;
      });
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i] ?? "") && (lines[i] ?? "").includes("|")) {
        const row = cells(lines[i] ?? "");
        rows.push(head.map((_, k) => inlines(row[k] ?? "")));
        i++;
      }
      out.push({ t: "table", align: head.map((_, k) => align[k] ?? null), head: head.map((c) => inlines(c)), rows, line: at });
      continue;
    }

    // A paragraph, up to a blank line or the start of another block. A "===" or "---"
    // line right under it makes it a heading instead.
    const para: string[] = [line];
    i++;
    let setext: 1 | 2 | null = null;
    while (i < lines.length && !blank(lines[i] ?? "")) {
      const next = lines[i] ?? "";
      const s = SETEXT.exec(next);
      if (s) {
        setext = (s[1] ?? "=").startsWith("=") ? 1 : 2;
        i++;
        break;
      }
      if (startsBlock(next)) break;
      para.push(next);
      i++;
    }
    if (setext) out.push(heading(setext, para.join(" ").trim(), at, ids));
    else out.push({ t: "p", c: inlines(para.map((p) => p.replace(/^ {0,3}/, "")).join("\n")), line: at });
  }
  return out;
}

function readList(lines: string[], from: number, first: number, ids: Map<string, number>): { block: Block; next: number } {
  const head = lines[from] ?? "";
  const b0 = BULLET.exec(head);
  const o0 = b0 ? null : ORDERED.exec(head);
  const ordered = !b0;
  const marker = b0 ? b0[2] : o0?.[3];
  const start = o0 ? Number(o0[2]) : 1;
  const items: ListItem[] = [];
  let tight = true;
  let i = from;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const b = BULLET.exec(line);
    const o = b ? null : ORDERED.exec(line);
    const same = ordered ? o && o[3] === marker : b && b[2] === marker;
    if (!same) break;
    const pre = ordered ? (o?.[1] ?? "") + (o?.[2] ?? "") + (o?.[3] ?? "") : (b?.[1] ?? "") + (b?.[2] ?? "");
    const gap = (ordered ? o?.[4] : b?.[3]) ?? " ";
    const width = pre.length + Math.min(Math.max(gap.length, 1), 4);
    const body: string[] = [(ordered ? o?.[5] : b?.[4]) ?? ""];
    const at = first + i;
    i++;
    let sawBlank = false;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (blank(next)) {
        sawBlank = true;
        body.push("");
        i++;
        continue;
      }
      const indent = next.length - next.trimStart().length;
      if (indent >= width) {
        if (sawBlank && body.some((l, k) => k > 0 && blank(l))) tight = false;
        body.push(next.slice(width));
        sawBlank = false;
        i++;
        continue;
      }
      // A line that isn't indented continues the paragraph unless it starts something new.
      if (!sawBlank && !BULLET.test(next) && !ORDERED.test(next) && !FENCE.test(next) && !ATX.test(next) && !HR.test(next) && !QUOTE.test(next)) {
        body.push(next.trim());
        i++;
        continue;
      }
      break;
    }
    while (body.length && blank(body.at(-1) ?? "")) {
      body.pop();
    }
    // A blank line between items makes the list loose.
    if (sawBlank && i < lines.length && (ordered ? ORDERED.test(lines[i] ?? "") : BULLET.test(lines[i] ?? ""))) tight = false;
    let checked: boolean | null = null;
    const task = /^\[([ xX])\][ \t]+/.exec(body[0] ?? "");
    if (task) {
      checked = task[1] !== " ";
      body[0] = (body[0] ?? "").slice(task[0].length);
    }
    items.push({ checked, c: blocks(body, at, ids) });
  }
  return { block: { t: "list", ordered, start, tight, items, line: first + from }, next: i };
}

function heading(level: 1 | 2 | 3 | 4 | 5 | 6, raw: string, line: number, ids: Map<string, number>): Block {
  const c = inlines(raw.trim());
  const base = slugify(plainText(c)) || "section";
  const n = ids.get(base) ?? 0;
  ids.set(base, n + 1);
  return { t: "h", level, c, id: n ? `${base}-${n}` : base, line };
}

function cells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  let inCode = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\" && s[k + 1] === "|") {
      cur += "|";
      k++;
    } else if (ch === "`") {
      inCode = !inCode;
      cur += ch;
    } else if (ch === "|" && !inCode) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Lowercase words joined by hyphens, as GitHub makes heading anchors. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

export function plainText(c: readonly Inline[]): string {
  return c.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "img" ? n.alt : n.t === "br" ? " " : plainText(n.c))).join("");
}

/** The headings, for an outline. */
export function outline(bs: readonly Block[]): Heading[] {
  const out: Heading[] = [];
  const walk = (list: readonly Block[]) => {
    for (const b of list) {
      if (b.t === "h") out.push({ level: b.level, text: plainText(b.c), id: b.id, line: b.line });
      else if (b.t === "quote") walk(b.c);
      else if (b.t === "list") for (const it of b.items) walk(it.c);
    }
  };
  walk(bs);
  return out;
}

/** A link target that is safe to follow: http(s), mailto, an anchor or a relative path. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
  if (!scheme) return h; // relative path or #anchor
  return ["http", "https", "mailto"].includes((scheme[1] ?? "").toLowerCase()) ? h : null;
}

const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/** Reads inline Markdown: code, emphasis, links, images, autolinks, breaks. */
export function inlines(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? "";
    const rest = src.slice(i);

    if (ch === "\\" && PUNCT.includes(src[i + 1] ?? "\0")) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\\" && src[i + 1] === "\n") {
      flush();
      out.push({ t: "br" });
      i += 2;
      continue;
    }
    if (ch === "\n") {
      // Two spaces before a line end make a hard break; otherwise it's a space.
      if (text.endsWith("  ")) {
        text = text.replace(/ +$/, "");
        flush();
        out.push({ t: "br" });
      } else {
        text = text.replace(/ +$/, "") + " ";
      }
      i++;
      continue;
    }
    if (ch === "`") {
      const ticks = /^`+/.exec(rest)?.[0] ?? "`";
      const end = src.indexOf(ticks, i + ticks.length);
      if (end > 0 && src[end + ticks.length] !== "`") {
        flush();
        let v = src.slice(i + ticks.length, end).replace(/\n/g, " ");
        if (/^ .* $/.test(v) && v.trim()) v = v.slice(1, -1);
        out.push({ t: "code", v });
        i = end + ticks.length;
        continue;
      }
      text += ticks;
      i += ticks.length;
      continue;
    }
    if (ch === "!" && src[i + 1] === "[") {
      const link = linkAt(src, i + 1);
      if (link) {
        flush();
        const href = safeHref(link.href);
        if (href) out.push({ t: "img", src: href, alt: link.label });
        else text += link.label;
        i = link.end;
        continue;
      }
    }
    if (ch === "[") {
      const link = linkAt(src, i);
      if (link) {
        flush();
        const href = safeHref(link.href);
        const c = inlines(link.label);
        if (href) out.push({ t: "link", href, title: link.title, c });
        else out.push(...c);
        i = link.end;
        continue;
      }
    }
    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        flush();
        out.push({ t: "link", href: auto[1] ?? "", c: [{ t: "text", v: (auto[1] ?? "").replace(/^mailto:/i, "") }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "w") && /[\s(]|^$/.test(src[i - 1] ?? "")) {
      const bare = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;"')\]!?*_~]/i.exec(rest);
      if (bare) {
        flush();
        const v = bare[0];
        out.push({ t: "link", href: v.startsWith("www.") ? `https://${v}` : v, c: [{ t: "text", v }] });
        i += v.length;
        continue;
      }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const run = /^(\*+|_+|~+)/.exec(rest)?.[0] ?? ch;
      const before = src[i - 1] ?? " ";
      const after = src[i + run.length] ?? " ";
      // "_" inside a word (snake_case) is not emphasis.
      const opens = !/\s/.test(after) && !(ch === "_" && /[\p{L}\p{N}]/u.test(before));
      if (opens && (ch !== "~" || run.length === 2)) {
        const size = ch === "~" ? 2 : Math.min(run.length, 3);
        const close = findClose(src, i + size, ch.repeat(size));
        if (close > 0) {
          flush();
          const inner = inlines(src.slice(i + size, close));
          if (ch === "~") out.push({ t: "del", c: inner });
          else if (size === 3) out.push({ t: "strong", c: [{ t: "em", c: inner }] });
          else out.push({ t: size === 2 ? "strong" : "em", c: inner });
          i = close + size;
          continue;
        }
      }
      text += run;
      i += run.length;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Where `marker` closes emphasis that opened before `from`: not after a space, not inside code. */
function findClose(src: string, from: number, marker: string): number {
  let k = from;
  while (k < src.length) {
    const c = src[k];
    if (c === "\\") {
      k += 2;
      continue;
    }
    if (c === "`") {
      const ticks = /^`+/.exec(src.slice(k))?.[0] ?? "`";
      const end = src.indexOf(ticks, k + ticks.length);
      k = end > 0 ? end + ticks.length : k + ticks.length;
      continue;
    }
    if (src.startsWith(marker, k) && k > from && !/\s/.test(src[k - 1] ?? "")) {
      const after = src[k + marker.length] ?? " ";
      // A longer run (*** when looking for **) closes at its end, not inside it.
      if (after === marker[0] && marker.length < 3) {
        k++;
        continue;
      }
      if (marker[0] === "_" && /[\p{L}\p{N}]/u.test(after)) {
        k += marker.length;
        continue;
      }
      return k;
    }
    k++;
  }
  return -1;
}

/** A link at `[`: [label](href "title"). Brackets in the label may nest. */
function linkAt(src: string, at: number): { label: string; href: string; title?: string | undefined; end: number } | null {
  let depth = 0;
  let k = at;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") k++;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  if (depth !== 0 || src[k + 1] !== "(") return null;
  const label = src.slice(at + 1, k);
  const m = /^\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'))?\s*\)/.exec(src.slice(k + 1));
  if (!m) return null;
  const href = (m[1] ?? "").replace(/^<|>$/g, "");
  const title = m[2]?.slice(1, -1);
  return { label, href, title, end: k + 1 + m[0].length };
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
