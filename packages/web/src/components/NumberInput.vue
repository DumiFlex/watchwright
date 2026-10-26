<script setup lang="ts">
// A number field with its own up/down buttons; the browser's native spinners are hidden.
const props = withDefaults(defineProps<{ modelValue: number; step?: number; min?: number; max?: number; label: string; id?: string }>(), {
  step: 1,
  min: Number.NEGATIVE_INFINITY,
  max: Number.POSITIVE_INFINITY,
  id: "",
});
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

function clamp(n: number) {
  return Math.min(props.max, Math.max(props.min, n));
}
function bump(dir: 1 | -1) {
  emit("update:modelValue", clamp(Number((props.modelValue + dir * props.step).toFixed(6))));
}
function onInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isNaN(v)) emit("update:modelValue", clamp(v));
}
</script>

<template>
  <div class="wn">
    <input
      :id="id || undefined"
      type="text"
      inputmode="decimal"
      :value="modelValue"
      :aria-label="label"
      @change="onInput"
      @keydown.up.prevent="bump(1)"
      @keydown.down.prevent="bump(-1)"
    />
    <div class="arrows">
      <button type="button" :aria-label="`Increase ${label}`" :disabled="modelValue >= max" @click="bump(1)">
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
      </button>
      <button type="button" :aria-label="`Decrease ${label}`" :disabled="modelValue <= min" @click="bump(-1)">
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wn {
  display: inline-flex;
  justify-self: start;
  width: fit-content;
  align-items: stretch;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.wn:focus-within {
  border-color: var(--accent);
}
input {
  width: 6em;
  border: 0;
  padding: 6px 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  outline: none;
}
.arrows {
  display: flex;
  flex-direction: column;
  border-left: var(--border-width) solid var(--line);
}
.arrows button {
  flex: 1;
  display: grid;
  place-items: center;
  width: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.arrows button + button {
  border-top: var(--border-width) solid var(--line);
}
.arrows button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.arrows button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
