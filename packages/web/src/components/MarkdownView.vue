<script lang="ts">
type Reader = typeof import("../markdown-parse");
// The reader (markdown-parse.ts) is a chunk of its own, fetched when the first view mounts.
let reader: Reader | null = null;
let loading: Promise<Reader> | null = null;
const loadReader = () => (loading ??= import("../markdown-parse").then((m) => (reader = m)));
</script>

<script setup lang="ts">
// Rendered Markdown, as GitHub shows it (src/markdown-parse.ts reads and cleans it). The tree
// is drawn with Vue's h(), never as innerHTML. Code blocks use CodeView, task boxes, the
// <summary> chevron and alerts are our own. Every id from the file gets `idPrefix`, so a
// README can't clash with the page. Relative links go through `resolveLink` (a pack file
// opens in the editor; null leaves the text unlinked), "#anchor" links scroll to the heading
// or footnote inside this view, and other links open in a new tab. Web images load without a
// referrer; relative ones go through `resolveImage`, and show their alt text in a frame when
// there is no address or the image doesn't load.
// `activeLine` marks the block that line of the source is in and scrolls it into view (the
// editor's cursor, side by side); a click on a block emits `line` with its first line.
import { computed, h, nextTick, reactive, ref, shallowRef, watch, type VNode, type VNodeChild } from "vue";
import type { AlertKind, Element, ElementContent, RootContent } from "../markdown-parse";
import { safeHref } from "../markdown";
import type { Lang } from "../highlight";
import { Check, ChevronRight, ImageOff, Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert, Undo2 } from "../icons";
import CodeView from "./CodeView.vue";

const props = withDefaults(
  defineProps<{
    source: string;
    label?: string;
    idPrefix?: string;
    resolveLink?: ((path: string) => string | null) | undefined;
    resolveImage?: ((path: string) => string | null) | undefined;
    activeLine?: number | undefined;
  }>(),
  { label: "Preview", idPrefix: "md-", resolveLink: undefined, resolveImage: undefined, activeLine: undefined },
);
const emit = defineEmits<{ line: [line: number] }>();

const md = shallowRef<Reader | null>(reader);
if (!md.value) void loadReader().then((m) => (md.value = m));

const tree = computed(() => md.value?.parseMarkdown(props.source) ?? null);
const root = ref<HTMLElement | null>(null);
const broken = reactive(new Set<string>());

const LEAF = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table", "hr", "summary", "dt", "dd"]);
const BLOCK = new Set([...LEAF, "ul", "ol", "li", "blockquote", "div", "details", "section", "dl"]);

// The blocks that hold text (not the lists, quotes and boxes around them), with their first lines.
const leaves = computed(() => {
  const out = new Map<Element, number>();
  const walk = (n: Element) => {
    const line = n.position?.start.line;
    const kids = n.children.filter((c): c is Element => c.type === "element");
    // A list item whose text comes first (a tight list) is a block of its own, and so are its sublists.
    const lead = n.children.find((c) => c.type !== "text" || c.value.trim());
    const leaf = LEAF.has(n.tagName) ? !md.value?.classes(n).includes("md-alert-title") : n.tagName === "li" && !!lead && (lead.type === "text" || (lead.type === "element" && !BLOCK.has(lead.tagName)));
    if (leaf && line) out.set(n, line);
    if (!leaf || n.tagName === "li") kids.forEach(walk);
  };
  tree.value?.children.forEach((c) => c.type === "element" && walk(c));
  return out;
});
const active = computed(() => {
  const at = props.activeLine;
  if (at === undefined) return null;
  let best: number | null = null;
  let first: number | null = null;
  for (const l of leaves.value.values()) {
    if (first === null || l < first) first = l;
    if (l <= at && (best === null || l > best)) best = l;
  }
  return best ?? first;
});
const mark = (n: Element) => {
  const line = leaves.value.get(n);
  return line === undefined ? {} : { "data-line": line, class: line === active.value ? "md-active" : undefined };
};

/** Scrolls the active block into the middle third of the nearest scrolling box, if it's outside it. */
function reveal() {
  const el = root.value?.querySelector<HTMLElement>(".md-active");
  if (!el) return;
  let box = root.value?.parentElement ?? null;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.top >= b.top + b.height / 6 && r.top <= b.top + (b.height * 2) / 3) return;
  box.scrollTo({ top: box.scrollTop + r.top - b.top - b.height / 3, behavior: "smooth" });
}
watch(active, () => void nextTick(() => requestAnimationFrame(reveal)), { immediate: true });

function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest("a, button, summary")) return;
  const line = t.closest<HTMLElement>("[data-line]")?.dataset.line;
  if (line) emit("line", Number(line));
}

const LANGS: Record<string, Lang> = { ts: "ts", typescript: "ts", tsx: "ts", js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js", json: "json", jsonc: "json" };
const ALERT_ICONS = { note: Info, tip: Lightbulb, important: MessageSquareWarning, warning: TriangleAlert, caution: OctagonAlert };

function jump(e: MouseEvent, id: string) {
  e.preventDefault();
  const el = root.value?.querySelector<HTMLElement>(`#${CSS.escape(props.idPrefix + id)}`);
  el?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** The element's attributes for h(): ids get the view's prefix, `align` becomes text-align, titles go (no browser tooltips). */
function attrs(n: Element): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(n.properties)) {
    if (value === null || value === undefined || value === false || key === "className" || key === "title" || key === "style") continue;
    const { name, sep } = md.value?.attribute(key) ?? { name: key, sep: " " };
    const v = Array.isArray(value) ? value.join(sep) : value === true ? "" : String(value);
    if (name === "id" || name === "name") out[name] = props.idPrefix + v;
    else if (name === "aria-describedby" || name === "aria-labelledby") out[name] = v.split(/\s+/).map((t) => props.idPrefix + t).join(" ");
    else if (name === "align" && n.tagName !== "img") out.style = { textAlign: v };
    else out[name] = v;
  }
  return out;
}

function link(n: Element, k: number): VNodeChild {
  const raw = String(n.properties.href ?? "");
  const href = raw ? safeHref(raw) : null;
  const backref = n.properties.dataFootnoteBackref !== undefined;
  const body = backref ? [h(Undo2, { size: 13 })] : kids(n);
  const a = { key: k, ...attrs(n), class: { "md-backref": backref } };
  if (!href) return body;
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    return h("a", { ...a, href, onClick: (e: MouseEvent) => jump(e, id) }, body);
  }
  if (/^(https?|mailto):/i.test(href)) return h("a", { ...a, href, target: "_blank", rel: "noopener noreferrer" }, body);
  const to = props.resolveLink?.(href) ?? null;
  return to ? h("a", { ...a, href: to }, body) : body;
}

function img(n: Element, k: number): VNode {
  const raw = safeHref(String(n.properties.src ?? ""));
  const alt = String(n.properties.alt ?? "");
  const src = raw && /^https?:/i.test(raw) ? raw : raw ? (props.resolveImage?.(raw) ?? null) : null;
  if (src && !broken.has(src)) return h("img", { key: k, ...attrs(n), src, alt, loading: "lazy", referrerpolicy: "no-referrer", onError: () => broken.add(src), onLoad: () => requestAnimationFrame(reveal) });
  return h("span", { key: k, class: "md-img-missing", role: "img", "aria-label": alt || "Image" }, [h(ImageOff, { size: 14 }), h("span", alt || raw || "Image")]);
}

function code(n: Element, k: number): VNode {
  const inner = n.children.find((c): c is Element => c.type === "element" && c.tagName === "code") ?? n;
  const lang = (md.value?.classes(inner).find((c) => c.startsWith("language-")) ?? "").slice(9).toLowerCase();
  const text = (md.value?.textOf(inner) ?? "").replace(/\n$/, "");
  const m = mark(n);
  return h(CodeView, { key: k, "data-line": m["data-line"], class: ["md-code", m.class], code: text, lang: LANGS[lang] ?? "text", label: lang ? `${lang} code` : "Code", name: lang || undefined });
}

// Tables take no text between their rows and cells.
const ROWS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

function kids(n: Element): VNodeChild[] {
  const list = ROWS.has(n.tagName) ? n.children.filter((c) => c.type === "element") : n.children;
  return list.map(node);
}

function node(n: ElementContent | RootContent, k: number): VNodeChild {
  if (n.type === "text") return n.value;
  if (n.type !== "element") return null;
  const cls = md.value?.classes(n) ?? [];
  const m = mark(n);
  const base = () => ({ key: k, ...attrs(n), ...m, class: [...cls, m.class] });
  switch (n.tagName) {
    case "pre":
      return code(n, k);
    case "a":
      return link(n, k);
    case "img":
      return img(n, k);
    case "input": {
      const done = n.properties.checked === true;
      return h("span", { key: k, class: ["md-task", { done }], role: "img", "aria-label": done ? "Done" : "Not done" }, done ? [h(Check, { size: 12 })] : []);
    }
    case "table":
      return h("div", { key: k, ...m, class: ["md-table", m.class], tabindex: 0, role: "region", "aria-label": "Table" }, [h("table", attrs(n), kids(n))]);
    case "summary":
      return h("summary", base(), [h(ChevronRight, { size: 14, class: "md-summary-icon" }), h("span", { class: "md-summary-text" }, kids(n))]);
    case "div": {
      const kind = cls.find((c) => c.startsWith("md-alert-"))?.slice(9) as AlertKind | undefined;
      if (kind && kind in ALERT_ICONS) {
        const [title, ...rest] = n.children;
        const head = title?.type === "element" ? h("p", { class: "md-alert-title" }, [h(ALERT_ICONS[kind], { size: 16 }), h("span", kids(title))]) : null;
        return h("div", { key: k, class: ["md-alert", `md-alert-${kind}`], role: "note" }, [head, ...rest.map((c, i) => node(c, i + 1))]);
      }
      break;
    }
  }
  return h(n.tagName, base(), kids(n));
}

const Blocks = () => tree.value?.children.map(node);
</script>

<template>
  <article ref="root" class="markdown-view" :class="{ following: activeLine !== undefined }" :aria-label="label" :aria-busy="tree ? undefined : 'true'" @click="onClick">
    <Blocks v-if="tree?.children.length" />
    <p v-else-if="tree" class="md-empty">Nothing to show yet.</p>
  </article>
</template>

<style scoped>
.markdown-view {
  min-width: 0;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.markdown-view > :deep(:first-child) {
  margin-top: 0;
}
.markdown-view > :deep(:last-child) {
  margin-bottom: 0;
}
.markdown-view :deep(:is(h1, h2, h3, h4, h5, h6)) {
  margin: var(--space-6) 0 var(--space-3);
  line-height: 1.3;
  scroll-margin-top: var(--space-4);
}
.markdown-view :deep(h1) {
  padding-bottom: var(--space-2);
  border-bottom: var(--border-width) solid var(--line);
  font-size: 24px;
}
.markdown-view :deep(h2) {
  padding-bottom: var(--space-2);
  border-bottom: var(--border-width) solid var(--line);
  font-size: 19px;
}
.markdown-view :deep(h3) {
  font-size: 16px;
}
.markdown-view :deep(:is(h4, h5, h6)) {
  font-size: 14px;
}
.markdown-view :deep(h6) {
  color: var(--muted);
}
/* Elements and classes apart, so "li > ul" below can still win over this. */
.markdown-view :deep(:is(p, ul, ol, dl, blockquote, details, hr)),
.markdown-view :deep(:is(.md-alert, .md-table, .md-code)) {
  margin: 0 0 var(--space-4);
}
.markdown-view :deep(:is(ul, ol)) {
  padding-left: var(--space-6);
}
.markdown-view :deep(li + li),
.markdown-view :deep(li > :is(ul, ol)) {
  margin-top: var(--space-1);
}
.markdown-view :deep(li > :is(ul, ol)) {
  margin-bottom: 0;
}
.markdown-view :deep(li > p:last-child) {
  margin-bottom: 0;
}
.markdown-view :deep(.task-list-item) {
  list-style: none;
}
.markdown-view :deep(.md-task) {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  /* Hangs in the list's indent, where the bullet would be. */
  margin: 0 var(--space-2) 0 calc(-16px - var(--space-2));
  vertical-align: -3px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.markdown-view :deep(.md-task.done) {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.markdown-view :deep(blockquote) {
  padding: 0 var(--space-4);
  border-left: 3px solid var(--line-strong);
  color: var(--muted);
}
.markdown-view :deep(hr) {
  height: 0;
  border: 0;
  border-top: var(--border-width) solid var(--line);
}
.markdown-view :deep(a) {
  color: var(--accent-text);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.markdown-view :deep(a:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
.markdown-view :deep(code) {
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--raised);
  font-family: var(--font-mono);
  font-size: 0.88em;
}
.markdown-view :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}
.markdown-view :deep(.md-img-missing) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 13px;
}
.markdown-view :deep(.md-table) {
  width: fit-content;
  max-width: 100%;
  overflow-x: auto;
}
.markdown-view :deep(table) {
  border-collapse: collapse;
  font-size: 13px;
}
.markdown-view :deep(:is(th, td)) {
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--line);
  text-align: left;
  vertical-align: top;
}
.markdown-view :deep(th) {
  background: var(--raised);
  font-weight: 600;
}
.markdown-view :deep(details) {
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.markdown-view :deep(summary) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 calc(-1 * var(--space-3));
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-weight: 600;
  list-style: none;
  cursor: pointer;
}
.markdown-view :deep(summary::-webkit-details-marker) {
  display: none;
}
.markdown-view :deep(summary:hover) {
  background: var(--hover);
}
.markdown-view :deep(summary:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.markdown-view :deep(.md-summary-icon) {
  flex: none;
  color: var(--muted);
  transition: transform 0.15s ease;
}
.markdown-view :deep(details[open] > summary) {
  margin-bottom: var(--space-3);
  border-bottom: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.markdown-view :deep(details[open] > summary .md-summary-icon) {
  transform: rotate(90deg);
}
.markdown-view :deep(.md-summary-text) {
  flex: 1;
  min-width: 0;
}
.markdown-view :deep(.md-summary-text > :is(p, h1, h2, h3, h4, h5, h6)) {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
}
.markdown-view :deep(details > :last-child:not(summary)) {
  margin-bottom: var(--space-3);
}
.markdown-view :deep(.md-alert) {
  --md-tone: var(--accent);
  padding: var(--space-2) var(--space-4);
  border-left: 3px solid var(--md-tone);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: color-mix(in srgb, var(--md-tone) 8%, var(--surface));
}
.markdown-view :deep(.md-alert-tip) {
  --md-tone: var(--ok);
}
.markdown-view :deep(.md-alert-important) {
  --md-tone: var(--paused);
}
.markdown-view :deep(.md-alert-warning) {
  --md-tone: var(--warn);
}
.markdown-view :deep(.md-alert-caution) {
  --md-tone: var(--bad);
}
.markdown-view :deep(.md-alert > :last-child) {
  margin-bottom: 0;
}
.markdown-view :deep(.md-alert-title) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
  font-weight: 600;
}
.markdown-view :deep(.md-alert-title svg) {
  flex: none;
  color: var(--md-tone);
}
.markdown-view :deep(kbd) {
  display: inline-block;
  padding: 0 var(--space-1);
  border: var(--border-width) solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--raised);
  font-family: var(--font-mono);
  font-size: 0.82em;
  line-height: 1.5;
}
.markdown-view :deep(mark) {
  padding: 0 2px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warn) 30%, transparent);
  color: inherit;
}
.markdown-view :deep(:is(sub, sup)) {
  line-height: 0;
}
.markdown-view :deep(dt) {
  font-weight: 600;
}
.markdown-view :deep(dd) {
  margin: 0 0 var(--space-2) var(--space-4);
}
.markdown-view :deep(.footnotes) {
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: 13px;
}
.markdown-view :deep(.footnotes li > p) {
  margin-bottom: var(--space-1);
}
.markdown-view :deep(.footnotes li:target),
.markdown-view :deep(.footnotes li:focus-within) {
  color: var(--text);
}
.markdown-view :deep(.md-backref) {
  display: inline-flex;
  margin-left: var(--space-1);
  vertical-align: -2px;
  text-decoration: none;
}
.markdown-view :deep([data-footnote-ref]) {
  padding: 0 1px;
  text-decoration: none;
}
.markdown-view :deep(del) {
  color: var(--muted);
}
/* Side by side: a soft band behind the block the editor's cursor is in. */
.markdown-view.following :deep(.md-active) {
  border-radius: var(--radius-sm);
  background-color: var(--accent-soft);
  box-shadow: 0 0 0 var(--space-1) var(--accent-soft);
}
.markdown-view.following :deep([data-line]) {
  cursor: text;
}
.md-empty {
  color: var(--muted);
}
</style>
