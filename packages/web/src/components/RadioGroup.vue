<script setup lang="ts" generic="T extends string | number">
// Themed radio buttons. Each option keeps a hidden native radio, so arrow keys, Tab and
// screen readers behave like a normal radio group; the dot is drawn from the tokens.
import { useId } from "vue";

defineProps<{ options: readonly { value: T; label: string; note?: string }[]; label?: string; disabled?: boolean; inline?: boolean }>();
const model = defineModel<T>({ required: true });
const name = useId();
</script>

<template>
  <div class="rg" :class="{ inline }" role="radiogroup" :aria-label="label">
    <label v-for="o in options" :key="String(o.value)" class="opt" :class="{ disabled }">
      <input v-model="model" type="radio" class="native" :name="name" :value="o.value" :disabled="disabled" />
      <span class="dot" aria-hidden="true" />
      <span class="text">
        {{ o.label }}
        <span v-if="o.note" class="note">{{ o.note }}</span>
      </span>
    </label>
  </div>
</template>

<style scoped>
.rg {
  display: grid;
  gap: var(--space-2);
}
.rg.inline {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
}
.opt {
  position: relative;
  display: inline-flex;
  align-items: flex-start;
  gap: var(--space-2);
  cursor: pointer;
}
.opt.disabled {
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
  pointer-events: none;
}
.dot {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: calc((1lh - 16px) / 2);
  border: calc(var(--border-width) + 0.5px) solid var(--line-strong);
  border-radius: 50%;
  background: var(--surface);
  transition: border-color 0.12s;
}
.dot::after {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  transform: scale(0);
  transition: transform 0.12s;
}
.opt:hover:not(.disabled) .dot {
  border-color: var(--accent);
}
.native:checked + .dot {
  border-color: var(--accent);
}
.native:checked + .dot::after {
  transform: scale(1);
}
.native:focus-visible + .dot {
  outline: calc(var(--border-width) + 1px) solid var(--accent);
  outline-offset: 2px;
}
.text {
  display: grid;
}
.note {
  color: var(--muted);
  font-size: 12px;
}
</style>
