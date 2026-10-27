<script setup lang="ts">
// A themed one-line text input. Search fields get a clear button and password fields a
// show/hide button of our own; the browser's versions are hidden in style.css.
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    id?: string | undefined;
    type?: "text" | "search" | "password" | "email" | "url";
    placeholder?: string | undefined;
    invalid?: boolean;
    disabled?: boolean;
    autocomplete?: string;
  }>(),
  { id: undefined, type: "text", placeholder: undefined, autocomplete: "off" },
);
const model = defineModel<string>({ default: "" });

const input = ref<HTMLInputElement | null>(null);
const reveal = ref(false);
const inputType = computed(() => (props.type === "password" && reveal.value ? "text" : props.type));

function clear() {
  model.value = "";
  input.value?.focus();
}
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="tf" :class="{ invalid, disabled }">
    <svg v-if="type === 'search'" class="lead" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M10.5 10.5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
    <input
      :id="id"
      ref="input"
      v-model="model"
      :type="inputType"
      :placeholder="placeholder"
      :disabled="disabled"
      :autocomplete="autocomplete"
      :aria-invalid="invalid || undefined"
      spellcheck="false"
    />
    <button v-if="type === 'search' && model && !disabled" type="button" class="icon" aria-label="Clear" @click="clear">
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
    </button>
    <button
      v-if="type === 'password' && !disabled"
      type="button"
      class="icon"
      :aria-label="reveal ? 'Hide password' : 'Show password'"
      :aria-pressed="reveal"
      @click="reveal = !reveal"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4" />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
        <path v-if="reveal" d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.tf {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
  padding: 0 4px 0 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.tf:hover:not(.disabled) {
  border-color: var(--line-strong);
}
.tf:focus-within {
  border-color: var(--accent);
}
.tf.invalid {
  border-color: var(--bad);
}
.tf.disabled {
  opacity: 0.5;
}
input {
  flex: 1;
  min-width: 0;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  outline: none;
}
input::placeholder {
  color: var(--muted);
  opacity: 1;
}
input:-webkit-autofill {
  -webkit-text-fill-color: var(--text);
  box-shadow: 0 0 0 100px var(--surface) inset;
}
.lead {
  flex: none;
  color: var(--muted);
}
.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.icon:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
