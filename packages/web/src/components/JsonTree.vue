<script setup lang="ts">
// Any JSON value as a tree you open and close: objects and arrays fold, values take the
// theme's colors. It is an ARIA tree: arrows move and open or close, Home/End jump, Enter
// opens or closes, and C copies the focused value. The search box keeps rows whose key or
// value matches open and marks them. `open-depth` sets how many levels start open.
import { computed, nextTick, ref, useId, watch } from "vue";
import { ChevronRight, Copy } from "../icons";
import { toast } from "../toasts";
import { pathsTo, treeKey, visibleRows, type TreeNode } from "../tree";
import TextField from "./TextField.vue";

type Kind = "object" | "array" | "string" | "number" | "boolean" | "null";
type Data = { value: unknown; kind: Kind };

const props = withDefaults(defineProps<{ value: unknown; label: string; openDepth?: number; searchable?: boolean; maxHeight?: string | undefined }>(), {
  openDepth: 1,
  searchable: true,
  maxHeight: undefined,
});

const searchId = useId();
const list = ref<HTMLElement | null>(null);
const query = ref("");
const focusAt = ref(0);

const kindOf = (v: unknown): Kind => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v === "string" ? "string" : typeof v === "number" ? "number" : "boolean");
function build(value: unknown, path: string, key: string): TreeNode<Data> {
  const kind = kindOf(value);
  const node: TreeNode<Data> = { id: path, label: key, data: { value, kind } };
  if (kind === "array") node.children = (value as unknown[]).map((v, i) => build(v, `${path}[${i}]`, String(i)));
  else if (kind === "object") node.children = Object.entries(value as Record<string, unknown>).map(([k, v]) => build(v, /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, k));
  return node;
}
const root = computed(() => build(props.value, "$", props.label));
const nodes = computed(() => [root.value]);

function initialOpen(): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode<Data>, depth: number) => {
    if (!n.children?.length || depth >= props.openDepth) return;
    out.add(n.id);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root.value, 0);
  return out;
}
const opened = ref(initialOpen());

const q = computed(() => query.value.trim().toLowerCase());
const matches = (n: TreeNode<Data>) => {
  if (!q.value || n.id === "$") return false;
  const d = n.data!;
  const text = d.kind === "object" || d.kind === "array" ? "" : String(d.value);
  return n.label.toLowerCase().includes(q.value) || text.toLowerCase().includes(q.value);
};
const found = computed(() => (q.value ? pathsTo(nodes.value, matches) : new Set<string>()));
// Branches the search opened that were closed by hand since; cleared on a new search.
const shut = ref(new Set<string>());
watch(q, () => (shut.value = new Set()));
const open = computed(() => new Set([...opened.value, ...[...found.value].filter((id) => !shut.value.has(id))]));
const rows = computed(() => visibleRows(nodes.value, open.value));
const matchCount = computed(() => (q.value ? rows.value.filter((r) => matches(r.node as TreeNode<Data>)).length : 0));

function preview(d: Data): string {
  if (d.kind === "array") return `[${(d.value as unknown[]).length}]`;
  if (d.kind === "object") {
    const keys = Object.keys(d.value as object);
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
  }
  return d.kind === "string" ? JSON.stringify(d.value) : String(d.value);
}

// An open branch shows its size; a closed one a preview of what is inside.
function shown(n: TreeNode<Data>): string {
  const d = n.data!;
  if (!n.children?.length || !open.value.has(n.id)) return preview(d);
  return d.kind === "array" ? `[${n.children.length}]` : `${n.children.length} keys`;
}

function toggle(id: string) {
  const next = new Set(opened.value);
  const closed = new Set(shut.value);
  if (open.value.has(id)) {
    next.delete(id);
    closed.add(id);
  } else {
    next.add(id);
    closed.delete(id);
  }
  opened.value = next;
  shut.value = closed;
}
function focusRow(i: number) {
  focusAt.value = Math.max(0, Math.min(rows.value.length - 1, i));
  void nextTick(() => list.value?.querySelectorAll<HTMLElement>("[role=treeitem]")[focusAt.value]?.focus());
}
async function copy(n: TreeNode<Data>) {
  const d = n.data!;
  try {
    await navigator.clipboard.writeText(d.kind === "string" ? String(d.value) : JSON.stringify(d.value, null, 2));
    toast(`Copied ${n.id}`, { tone: "ok", timeout: 2500 });
  } catch {
    toast("Couldn't copy: the browser blocked the clipboard", { tone: "bad" });
  }
}
function key(e: KeyboardEvent, i: number) {
  const row = rows.value[i]!;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (row.node.children?.length) toggle(row.node.id);
    return;
  }
  if (e.key === "c" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    void copy(row.node as TreeNode<Data>);
    return;
  }
  const r = treeKey(rows.value, i, e.key, open.value);
  if (!r) return;
  e.preventDefault();
  if (r.open || r.close) toggle((r.open ?? r.close)!);
  focusRow(r.focus);
}
</script>

<template>
  <div class="jt">
    <div v-if="searchable" class="find">
      <label :for="searchId" class="sr-only">Search {{ label }}</label>
      <TextField :id="searchId" v-model="query" type="search" placeholder="Search keys and values" />
      <span class="count num" aria-live="polite">{{ q ? `${matchCount} ${matchCount === 1 ? "match" : "matches"}` : "" }}</span>
    </div>
    <ul ref="list" class="tree mono" role="tree" :aria-label="label" :style="maxHeight ? { maxHeight } : undefined">
      <li
        v-for="(r, i) in rows"
        :key="r.node.id"
        role="treeitem"
        class="row"
        :class="{ hit: matches(r.node as TreeNode<Data>) }"
        :aria-level="r.depth"
        :aria-setsize="r.setSize"
        :aria-posinset="r.index"
        :aria-expanded="r.node.children?.length ? open.has(r.node.id) : undefined"
        :tabindex="i === focusAt ? 0 : -1"
        :style="{ paddingLeft: `${(r.depth - 1) * 16 + 6}px` }"
        @click="(focusAt = i), r.node.children?.length && toggle(r.node.id)"
        @keydown="key($event, i)"
      >
        <ChevronRight v-if="r.node.children?.length" class="chev" :class="{ open: open.has(r.node.id) }" :size="14" />
        <span v-else class="chev" />
        <span class="k">{{ r.node.label }}<span class="colon">:</span></span>
        <span class="v" :class="`v-${r.node.data!.kind}`">{{ shown(r.node as TreeNode<Data>) }}</span>
        <button type="button" class="copy" tabindex="-1" :aria-label="`Copy ${r.node.id}`" @click.stop="copy(r.node as TreeNode<Data>)"><Copy :size="13" /></button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.jt {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
.find {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.find > :first-of-type {
  flex: 1;
}
.count {
  min-width: 9ch;
  color: var(--muted);
  font-size: 12px;
}
.tree {
  margin: 0;
  padding: 4px;
  overflow: auto;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 12.5px;
  line-height: 1.5;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: max-content;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  cursor: default;
}
.row[aria-expanded] {
  cursor: pointer;
}
.row:hover {
  background: var(--hover);
}
.row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.row.hit {
  background: var(--accent-soft);
}
.chev {
  flex: none;
  width: 14px;
  color: var(--muted);
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.k {
  color: var(--accent-text);
}
.colon {
  margin-right: 4px;
  color: var(--muted);
}
.v-string {
  color: var(--ok);
}
.v-number,
.v-boolean,
.v-null {
  color: var(--warn);
}
.v-object,
.v-array {
  color: var(--muted);
}
.copy {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: 6px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  opacity: 0;
}
.row:hover .copy,
.row:focus-visible .copy {
  opacity: 1;
}
.copy:hover {
  background: var(--raised);
  color: var(--text);
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
