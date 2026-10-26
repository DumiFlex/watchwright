<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from "vue";
import { LOOKS, MODES, type Theme } from "../theme";

const theme = defineModel<Theme>({ required: true });

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const panelId = useId();

function close(focusButton = false) {
  open.value = false;
  if (focusButton) button.value?.focus();
}

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close();
}

function onKey(e: KeyboardEvent) {
  if (open.value && e.key === "Escape") close(true);
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="picker">
    <button
      ref="button"
      type="button"
      class="trigger"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="open = !open"
    >
      <span class="swatch" :data-look="theme.look" aria-hidden="true"><i /><i /></span>
      Theme
    </button>
    <div v-if="open" :id="panelId" class="panel">
      <fieldset>
        <legend class="label">Look</legend>
        <label v-for="l in LOOKS" :key="l.id" class="look" :class="{ on: theme.look === l.id }">
          <input v-model="theme.look" type="radio" name="look" :value="l.id" />
          <span class="swatch" :data-look="l.id" aria-hidden="true"><i /><i /></span>
          <span class="look-text">
            <span class="look-name">{{ l.name }}</span>
            <span class="look-note">{{ l.note }}</span>
          </span>
        </label>
      </fieldset>
      <fieldset>
        <legend class="label">Mode</legend>
        <div class="modes">
          <label v-for="m in MODES" :key="m.id" class="mode" :class="{ on: theme.mode === m.id }">
            <input v-model="theme.mode" type="radio" name="mode" :value="m.id" />
            {{ m.name }}
          </label>
        </div>
        <p v-if="theme.look === 'nightwatch'" class="mode-note">Night watch is always dark.</p>
      </fieldset>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}
.trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 var(--space-3);
  font: inherit;
  color: var(--text);
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
}
.trigger:hover {
  background: var(--raised);
}
.swatch {
  display: inline-flex;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: var(--border-width) solid var(--line);
  background: var(--ground);
  flex: none;
}
.swatch i {
  flex: 1;
}
.swatch i:first-child {
  background: var(--surface);
}
.swatch i:last-child {
  background: var(--accent);
}
.panel {
  position: absolute;
  right: 0;
  top: calc(100% + var(--space-2));
  z-index: 20;
  width: min(300px, calc(100vw - 32px));
  padding: var(--space-3);
  display: grid;
  gap: var(--space-4);
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
legend {
  padding: 0 0 var(--space-2);
}
input[type="radio"] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.look {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border-radius: var(--radius);
  border: var(--border-width) solid transparent;
  cursor: pointer;
}
.look:hover {
  background: var(--raised);
}
.look.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.look:has(input:focus-visible),
.mode:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.look .swatch {
  width: 32px;
  height: 32px;
}
.look-text {
  display: grid;
  min-width: 0;
}
.look-name {
  font-weight: 600;
}
.look-note {
  font-size: 12px;
  color: var(--muted);
}
.modes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.mode {
  display: grid;
  place-items: center;
  min-height: 36px;
  cursor: pointer;
  color: var(--muted);
}
.mode + .mode {
  border-left: var(--border-width) solid var(--line);
}
.mode:hover {
  background: var(--raised);
}
.mode-note {
  margin: var(--space-1) 0 0;
  font-size: 12px;
  color: var(--muted);
}
.mode.on {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
</style>
