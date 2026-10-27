<script setup lang="ts">
// A themed multi-line input. By default it grows with its text up to maxRows and scrolls
// with themed scrollbars after that. With `resizable` it gets a themed grip instead of the
// browser's: drag it, or focus it and use the up/down arrows (a line per press); a
// double-click on it fits the height to the text again.
import { nextTick, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{ id?: string | undefined; placeholder?: string | undefined; rows?: number; maxRows?: number; invalid?: boolean; disabled?: boolean; resizable?: boolean }>(),
  {
    id: undefined,
    placeholder: undefined,
    rows: 3,
    maxRows: 12,
  },
);
const model = defineModel<string>({ default: "" });
const el = ref<HTMLTextAreaElement | null>(null);
/** Set once the person resizes by hand; from then on the text no longer changes the height. */
const manual = ref(false);

function metrics(t: HTMLTextAreaElement) {
  const css = getComputedStyle(t);
  const line = parseFloat(css.lineHeight) || 20;
  const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
  const border = t.offsetHeight - t.clientHeight;
  return { line, padding, border };
}
function fit() {
  const t = el.value;
  if (!t || manual.value) return;
  const { line, padding, border } = metrics(t);
  t.style.height = "auto";
  // border-box: scrollHeight already holds the padding, only the border is added
  const want = Math.max(t.scrollHeight, line * props.rows + padding);
  t.style.height = `${Math.min(want, line * props.maxRows + padding) + border}px`;
}
onMounted(fit);
watch(model, () => void nextTick(fit));

function setHeight(px: number) {
  const t = el.value;
  if (!t) return;
  const { line, padding, border } = metrics(t);
  manual.value = true;
  t.style.height = `${Math.max(px, line + padding + border)}px`;
}
let startY = 0;
let startH = 0;
function gripDown(e: PointerEvent) {
  if (props.disabled || e.button !== 0 || !el.value) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  startY = e.clientY;
  startH = el.value.offsetHeight;
}
function gripMove(e: PointerEvent) {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) setHeight(startH + e.clientY - startY);
}
function gripKey(e: KeyboardEvent) {
  const t = el.value;
  if (!t || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  e.preventDefault();
  setHeight(t.offsetHeight + (e.key === "ArrowDown" ? 1 : -1) * metrics(t).line);
}
function refit() {
  manual.value = false;
  fit();
}
</script>

<template>
  <div class="wrap" :class="{ resizable }">
    <textarea
      :id="id"
      ref="el"
      v-model="model"
      class="ta"
      :class="{ invalid }"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
    />
    <span
      v-if="resizable && !disabled"
      class="grip"
      role="button"
      tabindex="0"
      aria-label="Resize, with the up and down arrows"
      @pointerdown="gripDown"
      @pointermove="gripMove"
      @keydown="gripKey"
      @dblclick="refit"
    >
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M9 3L3 9M9 6.5L6.5 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
    </span>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  width: 100%;
}
.ta {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  line-height: 1.45;
  resize: none;
  outline: none;
}
.resizable .ta {
  padding-right: 20px;
}
.ta:hover:not(:disabled) {
  border-color: var(--line-strong);
}
.ta:focus {
  border-color: var(--accent);
}
.ta.invalid {
  border-color: var(--bad);
}
.ta:disabled {
  opacity: 0.5;
}
.ta::placeholder {
  color: var(--muted);
  opacity: 1;
}
.grip {
  position: absolute;
  right: calc(var(--border-width) + 1px);
  bottom: calc(var(--border-width) + 1px);
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  cursor: ns-resize;
  touch-action: none;
}
.grip:hover,
.grip:focus-visible {
  color: var(--accent);
  background: var(--hover);
}
</style>
