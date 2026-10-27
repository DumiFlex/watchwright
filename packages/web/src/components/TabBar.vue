<script setup lang="ts" generic="T extends string">
// Tabs: a row of buttons that picks which panel shows. Follows the ARIA tabs pattern: one tab
// in the tab order, arrows and Home/End move between tabs and select them. Panels take
// `role="tabpanel"` and `:aria-labelledby="tabId(value)"` from the parent.
import { nextTick, ref } from "vue";

const props = defineProps<{ tabs: readonly { value: T; label: string; count?: number | undefined }[]; idPrefix: string; label: string }>();
const model = defineModel<T>({ required: true });
const list = ref<HTMLElement | null>(null);

const tabId = (v: string) => `${props.idPrefix}-tab-${v}`;
const panelId = (v: string) => `${props.idPrefix}-panel-${v}`;
defineExpose({ tabId, panelId });

function onKey(e: KeyboardEvent) {
  const i = props.tabs.findIndex((t) => t.value === model.value);
  const n = props.tabs.length;
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const next = props.tabs[(to + n) % n];
  if (!next) return;
  model.value = next.value;
  void nextTick(() => list.value?.querySelector<HTMLElement>(`#${CSS.escape(tabId(next.value))}`)?.focus());
}
</script>

<template>
  <div ref="list" class="tabs" role="tablist" :aria-label="label" @keydown="onKey">
    <button
      v-for="t in tabs"
      :id="tabId(t.value)"
      :key="t.value"
      type="button"
      role="tab"
      class="tab"
      :aria-selected="t.value === model"
      :aria-controls="panelId(t.value)"
      :tabindex="t.value === model ? 0 : -1"
      @click="model = t.value"
    >
      {{ t.label }}<span v-if="t.count !== undefined" class="count num">{{ t.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: var(--border-width) solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}
.tab:hover {
  color: var(--text);
}
.tab[aria-selected="true"] {
  color: var(--text);
  font-weight: 600;
}
.tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: var(--space-2);
  right: var(--space-2);
  bottom: calc(-1 * var(--border-width));
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}
.tab:focus-visible {
  outline-offset: -2px;
}
.count {
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: var(--raised);
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
}
</style>
