<script setup lang="ts" generic="T extends string | number | boolean">
// A themed replacement for <select>: a button that opens a listbox. Keyboard follows the
// ARIA listbox pattern: arrows, Home/End, Enter/Space to pick, Escape to close, and typing
// jumps to the next option starting with that letter.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";

const props = defineProps<{ options: readonly { value: T; label: string }[]; id?: string; disabled?: boolean }>();
const model = defineModel<T>({ required: true });

const open = ref(false);
const active = ref(0);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const list = ref<HTMLUListElement | null>(null);
const listId = useId();

const selectedIndex = computed(() => props.options.findIndex((o) => o.value === model.value));
const current = computed(() => props.options[selectedIndex.value]?.label ?? "");
const optionId = (i: number) => `${listId}-o${i}`;

async function show() {
  if (props.disabled || props.options.length === 0) return;
  open.value = true;
  active.value = Math.max(0, selectedIndex.value);
  await nextTick();
  list.value?.focus();
  scrollActive();
}
function hide(focusButton = true) {
  open.value = false;
  if (focusButton) button.value?.focus();
}
function choose(i: number) {
  const o = props.options[i];
  if (o) model.value = o.value;
  hide();
}
function scrollActive() {
  list.value?.querySelector(`#${CSS.escape(optionId(active.value))}`)?.scrollIntoView({ block: "nearest" });
}
function move(to: number) {
  active.value = Math.min(props.options.length - 1, Math.max(0, to));
  void nextTick(scrollActive);
}
function onListKey(e: KeyboardEvent) {
  const keys: Record<string, () => void> = {
    ArrowDown: () => move(active.value + 1),
    ArrowUp: () => move(active.value - 1),
    Home: () => move(0),
    End: () => move(props.options.length - 1),
    Enter: () => choose(active.value),
    " ": () => choose(active.value),
    Escape: () => hide(),
    Tab: () => hide(false),
  };
  const run = keys[e.key];
  if (run) {
    if (e.key !== "Tab") e.preventDefault();
    run();
    return;
  }
  if (e.key.length === 1 && /\S/.test(e.key)) {
    const k = e.key.toLowerCase();
    const n = props.options.length;
    for (let step = 1; step <= n; step++) {
      const i = (active.value + step) % n;
      if (props.options[i]!.label.toLowerCase().startsWith(k)) return move(i);
    }
  }
}
function onButtonKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    void show();
  }
}
function onDocPointer(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) hide(false);
}
onMounted(() => document.addEventListener("pointerdown", onDocPointer));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocPointer));
</script>

<template>
  <div ref="root" class="sel">
    <button
      :id="id"
      ref="button"
      type="button"
      class="trigger"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :disabled="disabled"
      @click="open ? hide() : show()"
      @keydown="onButtonKey"
    >
      <span class="value">{{ current }}</span>
      <svg class="chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
    </button>
    <ul
      v-if="open"
      :id="listId"
      ref="list"
      class="list"
      role="listbox"
      tabindex="-1"
      :aria-labelledby="id"
      :aria-activedescendant="optionId(active)"
      @keydown="onListKey"
      @blur="hide(false)"
    >
      <li
        v-for="(o, i) in options"
        :id="optionId(i)"
        :key="String(o.value)"
        role="option"
        :aria-selected="i === selectedIndex"
        :class="{ active: i === active, selected: i === selectedIndex }"
        @pointerenter="active = i"
        @pointerdown.prevent
        @click="choose(i)"
      >
        <span>{{ o.label }}</span>
        <svg v-if="i === selectedIndex" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sel {
  position: relative;
  width: 100%;
  min-width: 0;
}
.trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  padding: 6px 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.trigger:hover:not(:disabled) {
  border-color: var(--line-strong);
}
.trigger[aria-expanded="true"] {
  border-color: var(--accent);
}
.trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  flex: none;
  color: var(--muted);
}
.trigger[aria-expanded="true"] .chev {
  transform: rotate(180deg);
}
.list {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
.list:focus-visible {
  outline: none;
}
.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.list li.active {
  background: var(--raised);
}
.list li.selected {
  color: var(--accent-text);
  font-weight: 600;
}
</style>
