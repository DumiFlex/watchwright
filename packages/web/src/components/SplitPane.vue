<script setup lang="ts">
// Two panes side by side (or stacked, with direction="column") and a handle between them
// to drag. The handle is a focusable role="separator": arrows move it (Shift for bigger
// steps), Home/End go to the limits, a double-click puts it back where it started.
// v-model is the first pane's share in percent; with `storage-key` the size is remembered
// in this browser. Narrower than `stack-below` px, side-by-side panes stack instead, with
// no handle, so phone width works. Slots: `first`, `second`. The parent sets the height.
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { clampSplit, loadSplit, saveSplit, splitAt } from "../split";
import { browserStore } from "../theme";

const props = withDefaults(
  defineProps<{
    direction?: "row" | "column";
    label: string;
    minFirst?: number;
    minSecond?: number;
    storageKey?: string | undefined;
    stackBelow?: number;
  }>(),
  { direction: "row", minFirst: 120, minSecond: 120, storageKey: undefined, stackBelow: 640 },
);
const size = defineModel<number>({ default: 50 });

const root = ref<HTMLElement | null>(null);
const firstId = useId();
const total = ref(0);
const width = ref(Infinity);
const dragging = ref(false);
const start = size.value;

const row = computed(() => props.direction === "row");
const stacked = computed(() => row.value && width.value < props.stackBelow);
const shown = computed(() => clampSplit(size.value, total.value, props.minFirst, props.minSecond));
const tracks = computed(() => `minmax(0, ${shown.value}fr) auto minmax(0, ${100 - shown.value}fr)`);

let observer: ResizeObserver | undefined;
onMounted(() => {
  if (props.storageKey) {
    const saved = loadSplit(browserStore(), props.storageKey);
    if (saved !== null) size.value = saved;
  }
  const el = root.value;
  if (!el) return;
  observer = new ResizeObserver(() => {
    const r = el.getBoundingClientRect();
    width.value = r.width;
    total.value = row.value ? r.width : r.height;
  });
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());

function set(pct: number) {
  size.value = Number(clampSplit(pct, total.value, props.minFirst, props.minSecond).toFixed(2));
}
function remember() {
  if (props.storageKey) saveSplit(browserStore(), props.storageKey, size.value);
}
function fromPointer(e: PointerEvent) {
  const r = root.value?.getBoundingClientRect();
  if (r) set(row.value ? splitAt(e.clientX - r.left, r.width) : splitAt(e.clientY - r.top, r.height));
}
function down(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  dragging.value = true;
}
function move(e: PointerEvent) {
  if (dragging.value) fromPointer(e);
}
function up() {
  if (!dragging.value) return;
  dragging.value = false;
  remember();
}
function key(e: KeyboardEvent) {
  const step = e.shiftKey ? 10 : 2;
  const to: Record<string, number> = {
    ArrowLeft: shown.value - step,
    ArrowUp: shown.value - step,
    ArrowRight: shown.value + step,
    ArrowDown: shown.value + step,
    Home: 0,
    End: 100,
  };
  const v = to[e.key];
  if (v === undefined) return;
  e.preventDefault();
  set(v);
  remember();
}
function reset() {
  set(start);
  remember();
}
</script>

<template>
  <div
    ref="root"
    class="split"
    :class="[stacked ? 'is-stacked' : `is-${direction}`, { dragging }]"
    :style="stacked ? undefined : row ? { gridTemplateColumns: tracks } : { gridTemplateRows: tracks }"
  >
    <div :id="firstId" class="pane"><slot name="first" /></div>
    <div
      v-if="!stacked"
      class="handle"
      role="separator"
      tabindex="0"
      :aria-label="label"
      :aria-orientation="row ? 'vertical' : 'horizontal'"
      :aria-controls="firstId"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(shown)"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @keydown="key"
      @dblclick="reset"
    >
      <span class="grip" aria-hidden="true" />
    </div>
    <div class="pane"><slot name="second" /></div>
  </div>
</template>

<style scoped>
.split {
  display: grid;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.is-stacked {
  grid-template-rows: auto auto;
  gap: var(--space-3);
  height: auto;
}
.pane {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.is-stacked .pane {
  overflow: visible;
}
.dragging {
  user-select: none;
}
.is-row.dragging {
  cursor: col-resize;
}
.is-column.dragging {
  cursor: row-resize;
}
.handle {
  position: relative;
  display: grid;
  place-items: center;
  touch-action: none;
  outline: none;
}
.is-row > .handle {
  width: 9px;
  cursor: col-resize;
}
.is-column > .handle {
  height: 9px;
  cursor: row-resize;
}
/* The line sits in the middle of a wider hit area. */
.handle::before {
  content: "";
  position: absolute;
  background: var(--line);
  transition: background 0.12s;
}
.is-row > .handle::before {
  inset: 0 4px;
}
.is-column > .handle::before {
  inset: 4px 0;
}
.grip {
  position: relative;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-chip);
  background: var(--surface);
  transition:
    border-color 0.12s,
    background 0.12s;
}
.is-row .grip {
  width: 7px;
  height: 28px;
}
.is-column .grip {
  width: 28px;
  height: 7px;
}
.handle:hover::before,
.dragging > .handle::before,
.handle:focus-visible::before {
  background: var(--accent);
}
.handle:hover .grip,
.dragging > .handle .grip,
.handle:focus-visible .grip {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.handle:focus-visible .grip {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .handle::before,
  .grip {
    transition: none;
  }
}
</style>
