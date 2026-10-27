<script setup lang="ts" generic="T">
// A list you reorder by dragging each row's grip, or from the keyboard: focus a grip,
// press Space to pick the row up, arrows to move it, Space again to drop it or Escape to
// put it back. Alt+Up/Down moves the focused row at once. Rows for which `locked` returns
// true (an attempt already running) don't move and nothing passes them. v-model is the
// array; `move` fires with { item, from, to } after a drop. The default slot draws a row
// ({ item, index }).
import { GripVertical, Lock } from "../icons";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId } from "vue";
import { dropIndex, moveItem } from "../reorder";

type Key = string | number;
const props = withDefaults(
  defineProps<{ itemKey: (item: T) => Key; label: string; itemLabel?: ((item: T) => string) | undefined; locked?: ((item: T) => boolean) | undefined; disabled?: boolean }>(),
  { itemLabel: undefined, locked: undefined },
);
const items = defineModel<T[]>({ required: true });
const emit = defineEmits<{ move: [change: { item: T; from: number; to: number }] }>();

const list = ref<HTMLElement | null>(null);
const hintId = useId();
// While a row is carried, `draft` is the order shown; it becomes the model on drop.
const draft = shallowRef<T[] | null>(null);
const carried = ref<Key | null>(null);
const startIndex = ref(0);
const offset = ref(0);
const mode = ref<"pointer" | "keys" | null>(null);
const said = ref("");

const shown = computed(() => draft.value ?? items.value);
const nameOf = (item: T) => (props.itemLabel ? props.itemLabel(item) : String(props.itemKey(item)));
const isLocked = (item: T) => !!props.locked?.(item);
const indexOf = (k: Key) => shown.value.findIndex((it) => props.itemKey(it) === k);

function rows() {
  return [...(list.value?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];
}
function lift(item: T, how: "pointer" | "keys") {
  draft.value = [...items.value];
  carried.value = props.itemKey(item);
  startIndex.value = indexOf(carried.value);
  mode.value = how;
}
function place(to: number) {
  const from = carried.value === null ? -1 : indexOf(carried.value);
  if (from < 0 || !draft.value) return;
  const bounded = dropIndex(
    draft.value.map((_, i) => i),
    to + (to > from ? 0.5 : -0.5),
    from,
    (i) => isLocked(draft.value![i]!),
  );
  draft.value = moveItem(draft.value, from, bounded);
}
function drop(commit: boolean) {
  const k = carried.value;
  const order = draft.value;
  if (k !== null && order && commit) {
    const to = order.findIndex((it) => props.itemKey(it) === k);
    if (to !== startIndex.value) {
      items.value = order;
      emit("move", { item: order[to]!, from: startIndex.value, to });
    }
    said.value = `${nameOf(order[to]!)} dropped at position ${to + 1} of ${order.length}.`;
  } else if (k !== null) {
    said.value = "Move cancelled.";
  }
  draft.value = null;
  carried.value = null;
  mode.value = null;
  offset.value = 0;
  if (k !== null) void nextTick(() => grip(k)?.focus());
}
function grip(k: Key) {
  const i = items.value.findIndex((it) => props.itemKey(it) === k);
  return rows()[i]?.querySelector<HTMLElement>(".grip") ?? null;
}

// Pointer: the row follows the pointer; the others make room as it passes their middle.
let grabY = 0;
function down(e: PointerEvent, item: T) {
  if (props.disabled || isLocked(item) || e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).focus();
  lift(item, "pointer");
  const row = rows()[startIndex.value];
  grabY = e.clientY - (row?.getBoundingClientRect().top ?? e.clientY);
  // The window, not the grip, follows the pointer: rows move in the DOM while carried,
  // which drops pointer capture.
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}
function unlisten() {
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", up);
  window.removeEventListener("pointercancel", cancel);
}
function cancel() {
  unlisten();
  if (mode.value === "pointer") drop(false);
}
function move(e: PointerEvent) {
  if (mode.value !== "pointer" || carried.value === null || !draft.value || !list.value) return;
  const els = rows();
  const top = list.value.getBoundingClientRect().top;
  const y = e.clientY - top;
  const from = indexOf(carried.value);
  const mids = els.map((el) => el.offsetTop + el.offsetHeight / 2);
  const to = dropIndex(mids, y - grabY + (els[from]?.offsetHeight ?? 0) / 2, from, (i) => isLocked(draft.value![i]!));
  if (to !== from) draft.value = moveItem(draft.value, from, to);
  void nextTick(() => {
    const el = rows()[indexOf(carried.value!)];
    if (el) offset.value = y - grabY - el.offsetTop;
  });
}
function up() {
  unlisten();
  if (mode.value === "pointer") drop(true);
}

onBeforeUnmount(unlisten);

// Moving a row in the DOM blurs its grip too, so only a real move of focus elsewhere
// (checked once the row has settled) puts a carried row back.
function leave() {
  if (mode.value !== "keys") return;
  setTimeout(() => {
    const k = carried.value;
    if (mode.value === "keys" && k !== null && document.activeElement !== draftGrip(k)) drop(false);
  });
}
function draftGrip(k: Key) {
  return rows()[indexOf(k)]?.querySelector<HTMLElement>(".grip") ?? null;
}

function key(e: KeyboardEvent, item: T) {
  if (props.disabled) return;
  const k = props.itemKey(item);
  const at = indexOf(k);
  if (mode.value === "keys" && carried.value === k) {
    const to: Record<string, number> = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: shown.value.length - 1 };
    if (e.key in to) {
      e.preventDefault();
      place(to[e.key]!);
      const now = indexOf(k);
      said.value = `${nameOf(item)}, position ${now + 1} of ${shown.value.length}.`;
      void nextTick(() => rows()[now]?.querySelector<HTMLElement>(".grip")?.focus());
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      drop(true);
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      drop(false);
    }
    return;
  }
  if (isLocked(item)) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    lift(item, "keys");
    said.value = `${nameOf(item)} picked up, position ${at + 1} of ${shown.value.length}. Arrows move it, Space drops it, Escape puts it back.`;
  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    lift(item, "keys");
    place(at + (e.key === "ArrowUp" ? -1 : 1));
    drop(true);
  }
}
</script>

<template>
  <div class="sl" :class="{ carrying: mode === 'pointer' }">
    <ol ref="list" :aria-label="label">
      <TransitionGroup name="sl">
        <li
          v-for="(item, i) in shown"
          :key="itemKey(item)"
          class="entry"
          :class="{ lifted: carried === itemKey(item), locked: isLocked(item) }"
          :style="carried === itemKey(item) && mode === 'pointer' ? { transform: `translateY(${offset}px)` } : undefined"
        >
          <button
            type="button"
            class="grip"
            :disabled="disabled || isLocked(item)"
            :aria-label="isLocked(item) ? `${nameOf(item)} can't move` : `Move ${nameOf(item)}`"
            :aria-pressed="carried === itemKey(item) && mode === 'keys'"
            :aria-describedby="hintId"
            @pointerdown="down($event, item)"
            @keydown="key($event, item)"
            @blur="leave"
          >
            <GripVertical v-if="!isLocked(item)" :size="16" />
            <Lock v-else :size="13" />
          </button>
          <div class="body"><slot :item="item" :index="i" /></div>
        </li>
      </TransitionGroup>
    </ol>
    <p :id="hintId" class="sr-only">Space picks the row up, arrows move it, Space drops it. Alt with an arrow moves it at once.</p>
    <p class="sr-only" aria-live="assertive">{{ said }}</p>
  </div>
</template>

<style scoped>
ol {
  position: relative;
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.entry {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 6px 10px 6px 4px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.entry.locked {
  background: var(--raised);
}
.entry.lifted {
  z-index: 2;
  border-color: var(--accent);
  box-shadow: 0 10px 24px rgb(0 0 0 / 18%);
}
.carrying .entry.lifted {
  transition: none;
}
.carrying,
.carrying * {
  cursor: grabbing;
  user-select: none;
}
.body {
  flex: 1;
  min-width: 0;
}
.grip {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: grab;
  touch-action: none;
}
.grip:hover:not(:disabled),
.grip[aria-pressed="true"] {
  background: var(--hover);
  color: var(--text);
}
.grip[aria-pressed="true"] {
  color: var(--accent-text);
}
.grip:disabled {
  cursor: default;
  opacity: 0.7;
}
.sl-move {
  transition: transform 0.16s ease;
}
@media (prefers-reduced-motion: reduce) {
  .sl-move {
    transition: none;
  }
}
</style>
