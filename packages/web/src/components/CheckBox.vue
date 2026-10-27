<script setup lang="ts">
// A themed checkbox. The real <input> stays in the page (keyboard, forms, screen
// readers) but is invisible; the box beside it is drawn from the theme tokens.
// `indeterminate` shows a dash, for a "select all" box when only some are chosen.
import { Check, Minus } from "../icons";
defineProps<{ id?: string; disabled?: boolean; indeterminate?: boolean }>();
const checked = defineModel<boolean>({ default: false });
</script>

<template>
  <label class="cb" :class="{ disabled }">
    <input :id="id" v-model="checked" type="checkbox" class="native" :disabled="disabled" :indeterminate="indeterminate" />
    <span class="box" aria-hidden="true">
      <Minus v-if="indeterminate" :size="12" />
      <Check v-else :size="12" />
    </span>
    <span v-if="$slots.default" class="text"><slot /></span>
  </label>
</template>

<style scoped>
.cb {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  cursor: pointer;
  min-width: 0;
}
.cb.disabled {
  cursor: default;
  opacity: 0.5;
}
.native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  /* Clicks land on the label, which toggles the input. */
  pointer-events: none;
}
.box {
  flex: none;
  /* Sits on the first line when the label wraps. */
  align-self: flex-start;
  margin-top: calc((1lh - 16px) / 2);
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: calc(var(--border-width) + 0.5px) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: transparent;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.cb:hover:not(.disabled) .box {
  border-color: var(--accent);
}
.native:checked + .box,
.native:indeterminate + .box {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.native:focus-visible + .box {
  outline: calc(var(--border-width) + 1px) solid var(--accent);
  outline-offset: 2px;
}
.box .lucide {
  stroke-width: 3.5;
}
.text {
  min-width: 0;
}
</style>
