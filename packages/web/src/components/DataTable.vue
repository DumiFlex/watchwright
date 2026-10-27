<script setup lang="ts" generic="T">
// A themed table for lists of records (runs, attempts, collector records). Columns sort on
// a click of their heading (ascending, descending, off), or the parent sorts when
// `manualSort` is set (server-side paging). With `height` the body scrolls under a sticky
// header, and past `virtualFrom` rows only the rows on screen are rendered, which needs a
// fixed `rowHeight`. `selectable` adds a checkbox column (v-model:selected holds row keys).
// Slots: `cell-<key>` ({ row, value }) for custom cells, `empty`, and `footer` (for
// "Load more").
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CheckBox from "./CheckBox.vue";
import ProgressBar from "./ProgressBar.vue";
import { nextSort, rowWindow, sortRows, type Sort, type SortValue } from "../table";

type Column<R> = { key: string; label: string; sortable?: boolean | undefined; align?: "start" | "end" | undefined; width?: string | undefined; value?: ((row: R) => SortValue) | undefined };
type Key = string | number;

const props = withDefaults(
  defineProps<{
    columns: readonly Column<T>[];
    rows: readonly T[];
    rowKey: (row: T) => Key;
    label: string;
    height?: string | undefined;
    rowHeight?: number;
    virtualFrom?: number;
    manualSort?: boolean;
    selectable?: boolean;
    clickable?: boolean;
    loading?: boolean;
  }>(),
  { height: undefined, rowHeight: 37, virtualFrom: 200 },
);
const emit = defineEmits<{ rowClick: [row: T] }>();
const sort = defineModel<Sort>("sort", { default: null });
const selected = defineModel<Key[]>("selected", { default: () => [] });

const cellValue = (row: T, c: Column<T>): SortValue => (c.value ? c.value(row) : ((row as Record<string, unknown>)[c.key] as SortValue));
const sorted = computed(() => {
  const s = sort.value;
  const col = s && props.columns.find((c) => c.key === s.key);
  if (props.manualSort || !s || !col) return props.rows;
  return sortRows(props.rows, (r) => cellValue(r, col), s.dir);
});

const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewHeight = ref(600);
const virtual = computed(() => !!props.height && sorted.value.length > props.virtualFrom);
const win = computed(() =>
  virtual.value ? rowWindow(scrollTop.value, viewHeight.value, props.rowHeight, sorted.value.length) : { start: 0, end: sorted.value.length, padTop: 0, padBottom: 0 },
);
const visible = computed(() => sorted.value.slice(win.value.start, win.value.end));
const span = computed(() => props.columns.length + (props.selectable ? 1 : 0));

let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!scroller.value) return;
  observer = new ResizeObserver(() => (viewHeight.value = scroller.value?.clientHeight ?? 600));
  observer.observe(scroller.value);
});
onBeforeUnmount(() => observer?.disconnect());
// A new sort or new rows start from the top again.
watch([sort, () => props.rows], () => {
  if (scroller.value) scroller.value.scrollTop = 0;
  scrollTop.value = 0;
});

const chosen = computed(() => new Set<Key>(selected.value));
const allKeys = computed(() => sorted.value.map(props.rowKey));
const allChosen = computed(() => allKeys.value.length > 0 && allKeys.value.every((k) => chosen.value.has(k)));
const someChosen = computed(() => !allChosen.value && allKeys.value.some((k) => chosen.value.has(k)));
function toggleAll(on: boolean) {
  selected.value = on ? [...allKeys.value] : [];
}
function toggleRow(row: T, on: boolean) {
  const k = props.rowKey(row);
  selected.value = on ? [...selected.value.filter((x) => x !== k), k] : selected.value.filter((x) => x !== k);
}
function ariaSort(key: string) {
  if (sort.value?.key !== key) return "none";
  return sort.value.dir === "asc" ? "ascending" : "descending";
}
function show(v: SortValue) {
  return v === null || v === undefined ? "" : String(v);
}
</script>

<template>
  <div class="dt" :class="{ virtual }">
    <div ref="scroller" class="scroll" :style="height ? { maxHeight: height } : undefined" @scroll="scrollTop = ($event.target as HTMLElement).scrollTop">
      <table :aria-label="label" :aria-rowcount="virtual ? sorted.length + 1 : undefined" :aria-busy="loading || undefined">
        <colgroup>
          <col v-if="selectable" class="sel-col" />
          <col v-for="c in columns" :key="c.key" :style="c.width ? { width: c.width } : undefined" />
        </colgroup>
        <thead>
          <tr aria-rowindex="1">
            <th v-if="selectable" class="sel" scope="col">
              <CheckBox :model-value="allChosen" :indeterminate="someChosen" :disabled="sorted.length === 0" aria-label="Select all rows" @update:model-value="toggleAll" />
            </th>
            <th v-for="c in columns" :key="c.key" scope="col" :class="c.align" :aria-sort="c.sortable ? ariaSort(c.key) : undefined">
              <button v-if="c.sortable" type="button" class="sort" @click="sort = nextSort(sort, c.key)">
                <span>{{ c.label }}</span>
                <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden="true" :class="sort?.key === c.key ? sort.dir : 'none'">
                  <path class="up" d="M1 4.5L4 1.5l3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                  <path class="down" d="M1 7.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <span v-else>{{ c.label }}</span>
            </th>
          </tr>
          <tr v-if="loading" class="busy" aria-hidden="true">
            <th :colspan="span"><ProgressBar label="Loading" /></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="win.padTop" aria-hidden="true" :style="{ height: `${win.padTop}px` }"><td :colspan="span" class="pad" /></tr>
          <tr
            v-for="(row, i) in visible"
            :key="rowKey(row)"
            :aria-rowindex="virtual ? win.start + i + 2 : undefined"
            :class="{ clickable, chosen: chosen.has(rowKey(row)) }"
            :style="virtual ? { height: `${rowHeight}px` } : undefined"
            :tabindex="clickable ? 0 : undefined"
            @click="clickable && emit('rowClick', row)"
            @keydown.enter="clickable && emit('rowClick', row)"
          >
            <td v-if="selectable" class="sel" @click.stop>
              <CheckBox :model-value="chosen.has(rowKey(row))" :aria-label="`Select row ${i + win.start + 1}`" @update:model-value="(on: boolean) => toggleRow(row, on)" />
            </td>
            <td v-for="c in columns" :key="c.key" :class="c.align">
              <slot :name="`cell-${c.key}`" :row="row" :value="cellValue(row, c)">{{ show(cellValue(row, c)) }}</slot>
            </td>
          </tr>
          <tr v-if="win.padBottom" aria-hidden="true" :style="{ height: `${win.padBottom}px` }"><td :colspan="span" class="pad" /></tr>
          <tr v-if="sorted.length === 0 && !loading">
            <td :colspan="span" class="empty">
              <slot name="empty">Nothing here yet.</slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="$slots.footer" class="foot"><slot name="footer" /></div>
  </div>
</template>

<style scoped>
.dt {
  min-width: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
}
.sel-col {
  width: 40px;
}
th,
td {
  padding: 8px 12px;
  text-align: left;
  vertical-align: middle;
}
th.end,
td.end {
  text-align: right;
}
thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--raised);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
thead .busy th {
  top: 33px;
  padding: 0;
  border-bottom: 0;
}
.busy :deep(.pb) {
  height: 3px;
  border-radius: 0;
  box-shadow: none;
}
.sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: -2px -4px;
  padding: 2px 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
th.end .sort {
  flex-direction: row-reverse;
}
.sort:hover {
  color: var(--text);
  background: var(--hover);
}
[aria-sort="ascending"] .sort,
[aria-sort="descending"] .sort {
  color: var(--text);
}
.sort svg path {
  opacity: 0.35;
}
.sort svg.asc .up,
.sort svg.desc .down {
  opacity: 1;
  color: var(--accent-text);
}
tbody td {
  border-bottom: var(--border-width) solid var(--line);
}
tbody tr:last-child td {
  border-bottom: 0;
}
.virtual tbody td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
}
.virtual tbody td.sel {
  max-width: none;
  overflow: visible;
}
td.pad {
  padding: 0;
  border: 0;
}
tr.clickable {
  cursor: pointer;
}
tr.clickable:hover td {
  background: var(--hover);
}
tr.clickable:focus-visible {
  outline-offset: -2px;
}
tr.chosen td {
  background: var(--accent-soft);
}
.sel {
  width: 40px;
  padding-right: 0;
}
.empty {
  padding: var(--space-6) 12px;
  color: var(--muted);
  text-align: center;
}
.foot {
  padding: 8px 12px;
  border-top: var(--border-width) solid var(--line);
}
</style>
