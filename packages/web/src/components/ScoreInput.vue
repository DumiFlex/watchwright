<script setup lang="ts">
// One review criterion as a row of themed buttons: 1 to N for a scale, the names for choices,
// Yes and No for yes/no. It is a radio group: arrows move and pick, a digit picks that score on
// a scale (or that choice), and picking the chosen value again clears it.
import { computed, ref } from "vue";
import type { Criterion, Score } from "../api";

const props = defineProps<{ criterion: Criterion; disabled?: boolean }>();
const model = defineModel<Score | null>({ default: null });
const group = ref<HTMLElement | null>(null);

const options = computed<{ value: Score; label: string }[]>(() => {
  const c = props.criterion;
  if (c.kind === "scale") return Array.from({ length: c.scale }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  if (c.kind === "choices") return c.choices.map((x) => ({ value: x, label: x }));
  return [
    { value: true, label: "Yes" },
    { value: false, label: "No" },
  ];
});
const selected = computed(() => options.value.findIndex((o) => o.value === model.value));
// The button in the tab order: the chosen one, else the first.
const focusable = computed(() => (selected.value >= 0 ? selected.value : 0));

function pick(i: number) {
  if (props.disabled) return;
  const o = options.value[i];
  if (!o) return;
  model.value = model.value === o.value ? null : o.value;
}
function focusAt(i: number) {
  group.value?.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();
}
function onKey(e: KeyboardEvent) {
  const n = options.value.length;
  const at = Math.max(0, options.value.findIndex((_, i) => group.value?.querySelectorAll("button")[i] === document.activeElement));
  let to: number | null = null;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (at + 1) % n;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (at - 1 + n) % n;
  else if (e.key === "Home") to = 0;
  else if (e.key === "End") to = n - 1;
  else if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) {
    e.preventDefault();
    e.stopPropagation();
    const i = Number(e.key) - 1;
    pick(i);
    focusAt(i);
    return;
  } else if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    model.value = null;
    return;
  }
  if (to === null) return;
  e.preventDefault();
  if (!props.disabled) model.value = options.value[to]!.value;
  focusAt(to);
}
</script>

<template>
  <div ref="group" class="score" :class="[`is-${criterion.kind}`, { disabled }]" role="radiogroup" :aria-label="criterion.title" @keydown="onKey">
    <button
      v-for="(o, i) in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      class="opt"
      :aria-checked="i === selected"
      :tabindex="i === focusable ? 0 : -1"
      :disabled="disabled"
      @click="pick(i)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.score {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.opt {
  min-width: 34px;
  height: 32px;
  padding: 0 10px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.is-scale .opt {
  font-family: var(--font-mono);
}
.opt:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--hover);
}
.opt[aria-checked="true"] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.opt:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.disabled .opt {
  cursor: default;
  opacity: 0.55;
}
</style>
