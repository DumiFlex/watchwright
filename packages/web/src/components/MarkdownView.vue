<script setup lang="ts">
// Rendered Markdown (src/markdown.ts reads it). The tree is drawn with Vue's h(), never as
// innerHTML, so HTML in the text shows as text. Code blocks use CodeView. Relative links go
// through `resolveLink` (a pack file opens in the editor; null leaves the text unlinked),
// "#anchor" links scroll to the heading inside this view, and other links open in a new
// tab. Web images load without a referrer; relative ones go through `resolveImage`, and show
// their alt text in a frame when there is no address or the image doesn't load.
// `activeLine` marks the block that line of the source is in and scrolls it into view (the
// editor's cursor, side by side); a click on a block emits `line` with its first line.
import { computed, h, nextTick, reactive, ref, watch, type VNode, type VNodeChild } from "vue";
import { parseMarkdown, type Block, type Inline } from "../markdown";
import type { Lang } from "../highlight";
import { Check, ImageOff } from "../icons";
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

const tree = computed(() => parseMarkdown(props.source));
const root = ref<HTMLElement | null>(null);
const broken = reactive(new Set<string>());

// The first lines of the blocks that hold text (not the lists and quotes around them).
const leafLines = computed(() => {
  const out: number[] = [];
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.t === "quote") walk(b.c);
      else if (b.t === "list") for (const it of b.items) walk(it.c);
      else out.push(b.line);
    }
  };
  walk(tree.value);
  return out;
});
const active = computed(() => {
  const at = props.activeLine;
  if (at === undefined) return null;
  let best: number | null = null;
  for (const l of leafLines.value) if (l <= at && (best === null || l > best)) best = l;
  return best ?? leafLines.value[0] ?? null;
});
const mark = (line: number) => ({ "data-line": line, class: line === active.value ? "md-active" : undefined });

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
  if (t.closest("a, button")) return;
  const line = t.closest<HTMLElement>("[data-line]")?.dataset.line;
  if (line) emit("line", Number(line));
}

const LANGS: Record<string, Lang> = { ts: "ts", typescript: "ts", tsx: "ts", js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js", json: "json", jsonc: "json" };

function jump(e: MouseEvent, id: string) {
  e.preventDefault();
  const el = root.value?.querySelector<HTMLElement>(`#${CSS.escape(props.idPrefix + id)}`);
  el?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function link(n: Extract<Inline, { t: "link" }>): VNode | VNodeChild[] {
  const kids = inl(n.c);
  if (n.href.startsWith("#")) {
    const id = decodeURIComponent(n.href.slice(1));
    return h("a", { href: n.href, onClick: (e: MouseEvent) => jump(e, id) }, kids);
  }
  if (/^(https?|mailto):/i.test(n.href)) {
    return h("a", { href: n.href, target: "_blank", rel: "noopener noreferrer" }, kids);
  }
  const to = props.resolveLink?.(n.href) ?? null;
  return to ? h("a", { href: to }, kids) : kids;
}

function img(n: Extract<Inline, { t: "img" }>): VNode {
  const src = /^https?:/i.test(n.src) ? n.src : (props.resolveImage?.(n.src) ?? null);
  if (src && !broken.has(src)) return h("img", { src, alt: n.alt, loading: "lazy", referrerpolicy: "no-referrer", onError: () => broken.add(src), onLoad: () => requestAnimationFrame(reveal) });
  return h("span", { class: "md-img-missing", role: "img", "aria-label": n.alt || "Image" }, [h(ImageOff, { size: 14 }), h("span", n.alt || n.src)]);
}

function inl(list: readonly Inline[]): VNodeChild[] {
  return list.flatMap((n): VNodeChild[] => {
    switch (n.t) {
      case "text":
        return [n.v];
      case "code":
        return [h("code", n.v)];
      case "em":
        return [h("em", inl(n.c))];
      case "strong":
        return [h("strong", inl(n.c))];
      case "del":
        return [h("del", inl(n.c))];
      case "br":
        return [h("br")];
      case "img":
        return [img(n)];
      case "link": {
        const v = link(n);
        return Array.isArray(v) ? v : [v];
      }
    }
  });
}

function block(b: Block, k: number): VNode {
  switch (b.t) {
    case "h":
      return h(`h${b.level}`, { key: k, id: props.idPrefix + b.id, ...mark(b.line) }, inl(b.c));
    case "p":
      return h("p", { key: k, ...mark(b.line) }, inl(b.c));
    case "code":
      return h(CodeView, { key: k, "data-line": b.line, class: ["md-code", { "md-active": b.line === active.value }], code: b.v, lang: LANGS[b.lang] ?? "text", label: b.lang ? `${b.lang} code` : "Code", name: b.lang || undefined });
    case "quote":
      return h("blockquote", { key: k }, b.c.map(block));
    case "hr":
      return h("hr", { key: k, ...mark(b.line) });
    case "list": {
      const task = b.items.some((it) => it.checked !== null);
      const items = b.items.map((it, i) => {
        // A tight list's single paragraph shows without paragraph spacing.
        const body = b.tight ? it.c.map((c, j) => (c.t === "p" ? h("span", { key: j, "data-line": c.line, class: ["md-tight", { "md-active": c.line === active.value }] }, inl(c.c)) : block(c, j))) : it.c.map(block);
        if (it.checked === null) return h("li", { key: i }, body);
        const box = h("span", { class: ["md-task", { done: it.checked }], role: "img", "aria-label": it.checked ? "Done" : "Not done" }, it.checked ? [h(Check, { size: 12 })] : []);
        return h("li", { key: i, class: "md-task-item" }, [box, h("div", { class: "md-task-body" }, body)]);
      });
      const attrs = { key: k, class: { "md-tasks": task } };
      return b.ordered ? h("ol", { ...attrs, start: b.start === 1 ? undefined : b.start }, items) : h("ul", attrs, items);
    }
    case "table": {
      const style = (i: number) => (b.align[i] ? { textAlign: b.align[i] } : undefined);
      return h("div", { key: k, "data-line": b.line, class: ["md-table", { "md-active": b.line === active.value }], tabindex: 0, role: "region", "aria-label": "Table" }, [
        h("table", [
          h("thead", [h("tr", b.head.map((c, i) => h("th", { key: i, style: style(i) }, inl(c))))]),
          h("tbody", b.rows.map((r, j) => h("tr", { key: j }, r.map((c, i) => h("td", { key: i, style: style(i) }, inl(c)))))),
        ]),
      ]);
    }
  }
}

const Blocks = () => tree.value.map(block);
</script>

<template>
  <article ref="root" class="markdown-view" :class="{ following: activeLine !== undefined }" :aria-label="label" @click="onClick">
    <Blocks v-if="tree.length" />
    <p v-else class="md-empty">Nothing to show yet.</p>
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
.markdown-view :deep(:is(p, ul, ol, blockquote, .md-table, .md-code, hr)) {
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
.markdown-view :deep(ul.md-tasks) {
  padding-left: 0;
  list-style: none;
}
.markdown-view :deep(.md-task-item) {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.markdown-view :deep(.md-task-body) {
  flex: 1;
  min-width: 0;
}
.markdown-view :deep(.md-task) {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 0.25em;
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
