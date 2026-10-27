<script setup lang="ts">
// A tree with a box on every row, for picking tests by pack and section. Ticking a branch
// ticks everything under it; a branch with only some leaves ticked shows a dash. v-model
// holds the ticked leaf ids. It is an ARIA tree: arrows move and open or close, Home/End
// jump, Space ticks. Each branch shows how many of its leaves are ticked.
import { computed, nextTick, ref } from "vue";
import { Check, ChevronRight, Minus } from "../icons";
import { checkState, leaves, toggleNode, treeKey, visibleRows, type TreeNode } from "../tree";

const props = withDefaults(defineProps<{ nodes: readonly TreeNode[]; label: string; openAll?: boolean }>(), { openAll: false });
const chosen = defineModel<string[]>({ default: () => [] });

const list = ref<HTMLElement | null>(null);
const focusAt = ref(0);
const opened = ref(new Set<string>(props.openAll ? props.nodes.flatMap(function ids(n): string[] { return n.children?.length ? [n.id, ...n.children.flatMap(ids)] : []; }) : props.nodes.map((n) => n.id)));
const rows = computed(() => visibleRows(props.nodes, opened.value));
const set = computed(() => new Set(chosen.value));

function state(n: TreeNode) {
  return checkState(n, set.value);
}
function aria(n: TreeNode) {
  const s = state(n);
  return s === "on" ? "true" : s === "off" ? "false" : "mixed";
}
function count(n: TreeNode) {
  const ids = leaves(n);
  return `${ids.filter((id) => set.value.has(id)).length}/${ids.length}`;
}
function tick(n: TreeNode) {
  chosen.value = toggleNode(n, chosen.value);
}
function toggleOpen(id: string) {
  const next = new Set(opened.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  opened.value = next;
}
function focusRow(i: number) {
  focusAt.value = Math.max(0, Math.min(rows.value.length - 1, i));
  void nextTick(() => list.value?.querySelectorAll<HTMLElement>("[role=treeitem]")[focusAt.value]?.focus());
}
function key(e: KeyboardEvent, i: number) {
  const row = rows.value[i]!;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    tick(row.node);
    return;
  }
  const r = treeKey(rows.value, i, e.key, opened.value);
  if (!r) return;
  e.preventDefault();
  if (r.open || r.close) toggleOpen((r.open ?? r.close)!);
  focusRow(r.focus);
}
</script>

<template>
  <ul ref="list" class="ct" role="tree" aria-multiselectable="true" :aria-label="label">
    <li
      v-for="(r, i) in rows"
      :key="r.node.id"
      role="treeitem"
      class="row"
      :aria-level="r.depth"
      :aria-setsize="r.setSize"
      :aria-posinset="r.index"
      :aria-expanded="r.node.children?.length ? opened.has(r.node.id) : undefined"
      :aria-checked="aria(r.node)"
      :tabindex="i === focusAt ? 0 : -1"
      :style="{ paddingLeft: `${(r.depth - 1) * 20 + 4}px` }"
      @keydown="key($event, i)"
      @focus="focusAt = i"
    >
      <span v-if="r.node.children?.length" class="twist" aria-hidden="true" @click.stop="toggleOpen(r.node.id)">
        <ChevronRight class="chev" :class="{ open: opened.has(r.node.id) }" :size="15" />
      </span>
      <span v-else class="twist" />
      <span class="pick" @click="(focusAt = i), tick(r.node)">
        <span class="box" :class="state(r.node)" aria-hidden="true">
          <Check v-if="state(r.node) === 'on'" :size="12" />
          <Minus v-else-if="state(r.node) === 'some'" :size="12" />
        </span>
        <span class="text">{{ r.node.label }}</span>
      </span>
      <span v-if="r.node.children?.length" class="count num" aria-hidden="true">{{ count(r.node) }}</span>
    </li>
  </ul>
</template>

<style scoped>
.ct {
  margin: 0;
  padding: 4px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding-right: 8px;
  border-radius: var(--radius-sm);
}
.row:hover {
  background: var(--hover);
}
.row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.twist {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  cursor: pointer;
}
.twist:empty {
  cursor: default;
}
.twist:hover:not(:empty) {
  color: var(--text);
}
.chev {
  transition: transform 0.12s;
}
.chev.open {
  transform: rotate(90deg);
}
.pick {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  cursor: pointer;
}
.box {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--on-accent);
}
.row:hover .box {
  border-color: var(--accent);
}
.box.on,
.box.some {
  border-color: var(--accent);
  background: var(--accent);
}
.box .lucide {
  stroke-width: 3.5;
}
.text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  flex: none;
  color: var(--muted);
  font-size: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
