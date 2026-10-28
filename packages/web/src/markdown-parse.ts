// Reads Markdown the way GitHub shows it: CommonMark and GitHub Flavored Markdown (tables,
// task lists, strikethrough, autolinks, footnotes) through micromark, raw HTML parsed with
// parse5 so Markdown inside <details> still reads, then cleaned with GitHub's allow list
// (rehype-sanitize). Nothing that runs script survives: no <script>, <style>, <iframe>,
// event handlers or style attributes, and links keep http(s), mailto and relative targets.
// After cleaning, headings get GitHub's ids and "> [!NOTE]" quotes become alerts.
// The result is a syntax tree (hast) with line positions; MarkdownView draws it with h().
// This module is heavy (about 100 kB gzipped), so the view loads it on first use.
import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root } from "hast";
import { find, html } from "property-information";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as Schema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export type { Element, ElementContent, Root, RootContent } from "hast";

export const ALERTS = ["note", "tip", "important", "warning", "caution"] as const;
export type AlertKind = (typeof ALERTS)[number];

export interface Heading {
  level: number;
  text: string;
  id: string;
  line: number;
}

// GitHub's list, less <picture>/<source> (a srcset can't go through the view's image
// resolver; the <img> inside still shows), plus <mark> and <abbr>. <style> goes with its
// text, like <script>, rather than leaving the CSS behind as words. Ids are left as written
// here; the view prefixes every id, name and #link so nothing clobbers the page's own.
const schema: Schema = {
  ...defaultSchema,
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []).filter((t) => t !== "picture" && t !== "source"), "mark", "abbr"],
  strip: [...(defaultSchema.strip ?? []), "style", "textarea", "title"],
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: "" })
  .use(rehypeRaw)
  .use(rehypeSanitize, schema)
  .use(() => finish);

/** Reads Markdown into a cleaned HTML tree. */
export function parseMarkdown(text: string): Root {
  return processor.runSync(processor.parse(text));
}

const isEl = (n: ElementContent | Root | undefined, tag?: string): n is Element => n?.type === "element" && (!tag || n.tagName === tag);
const HEADING = /^h[1-6]$/;

/** The text inside a node, as the reader sees it. */
export function textOf(n: ElementContent | Root): string {
  if (n.type === "text") return n.value;
  if (n.type === "comment") return "";
  if (n.type === "element" && n.tagName === "img") return String(n.properties.alt ?? "");
  return "children" in n ? n.children.map((c) => textOf(c as ElementContent)).join("") : "";
}

/** How a hast property is written in HTML ("className" → "class", "ariaLabel" → "aria-label"), and how its list joins. */
export function attribute(prop: string): { name: string; sep: string } {
  const info = find(html, prop);
  return { name: info.attribute, sep: info.commaSeparated ? ", " : " " };
}

export function classes(n: Element): string[] {
  const c = n.properties.className;
  return Array.isArray(c) ? c.map(String) : c ? String(c).split(/\s+/) : [];
}

// After cleaning: GitHub's heading ids and alerts. Both only rearrange the cleaned tree.
function finish(tree: Root): void {
  const slugger = new GithubSlugger();
  const walk = (parent: Root | Element) => {
    parent.children.forEach((n, i) => {
      if (n.type !== "element") return;
      if (HEADING.test(n.tagName) && n.properties.id === undefined) n.properties.id = slugger.slug(textOf(n));
      if (n.tagName === "blockquote") {
        const alert = toAlert(n);
        if (alert) parent.children[i] = alert;
      }
      walk(parent.children[i] as Element);
    });
  };
  walk(tree);
}

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

/** A quote whose first line is only "[!NOTE]" (or TIP, IMPORTANT, WARNING, CAUTION) as an alert box. */
function toAlert(q: Element): Element | null {
  const first = q.children.find((c) => c.type !== "text" || c.value.trim());
  if (!isEl(first, "p")) return null;
  const lead = first.children[0];
  const m = lead?.type === "text" ? MARKER.exec(lead.value) : null;
  if (!m || lead?.type !== "text") return null;
  // GitHub needs something after the marker.
  const rest = lead.value.slice(m[0].length);
  const body = rest ? [{ ...lead, value: rest }, ...first.children.slice(1)] : first.children.slice(1);
  while (body[0]?.type === "text" && !body[0].value.trim()) body.shift();
  if (isEl(body[0], "br")) body.shift();
  const after = q.children.slice(q.children.indexOf(first) + 1);
  if (!body.length && !after.some((c) => c.type === "element")) return null;
  const kind = (m[1] ?? "note").toLowerCase() as AlertKind;
  const title: Element = { type: "element", tagName: "p", properties: { className: ["md-alert-title"] }, children: [{ type: "text", value: kind[0]?.toUpperCase() + kind.slice(1) }], position: first.position };
  const kids: ElementContent[] = [title];
  if (body.length) kids.push({ ...first, children: body });
  kids.push(...after);
  return { type: "element", tagName: "div", properties: { className: ["md-alert", `md-alert-${kind}`] }, children: kids, position: q.position };
}

/** The headings, for an outline. */
export function outline(tree: Root): Heading[] {
  const out: Heading[] = [];
  const walk = (n: Root | Element) => {
    for (const c of n.children) {
      if (c.type !== "element") continue;
      if (HEADING.test(c.tagName) && !classes(c).includes("sr-only")) out.push({ level: Number(c.tagName[1]), text: textOf(c).trim(), id: String(c.properties.id ?? ""), line: c.position?.start.line ?? 0 });
      else walk(c);
    }
  };
  walk(tree);
  return out;
}
