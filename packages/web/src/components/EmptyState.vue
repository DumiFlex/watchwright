<script setup lang="ts">
// What a page or card shows when it has nothing to list: an icon, a heading, a line on what
// would be here, and the next step as buttons (the `actions` slot). `compact` is for a card
// inside a page (a filter that matches nothing, a pack with no runs); the full size is for a
// page whose main list is empty. Say what fills the space and how, never just "No data".
import type { Component } from "vue";

withDefaults(
  defineProps<{
    heading: string;
    icon?: Component | undefined;
    compact?: boolean;
    /** Heading level, so the page's outline stays in order. */
    level?: 2 | 3;
  }>(),
  { icon: undefined, compact: false, level: 2 },
);
</script>

<template>
  <div class="empty-state" :class="{ 'is-compact': compact }">
    <span v-if="icon" class="badge" aria-hidden="true"><component :is="icon" :size="compact ? 18 : 24" /></span>
    <component :is="`h${level}`" class="heading display">{{ heading }}</component>
    <div v-if="$slots.default" class="text muted"><slot /></div>
    <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.empty-state {
  display: grid;
  justify-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}
.empty-state.is-compact {
  gap: var(--space-2);
  padding: var(--space-4) var(--space-3) var(--space-2);
}
.badge {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-text);
}
.is-compact .badge {
  width: 40px;
  height: 40px;
}
.heading {
  margin: 0;
  font-size: 17px;
}
.is-compact .heading {
  font-size: 15px;
}
.text {
  max-width: 46ch;
  line-height: 1.5;
}
.text :deep(p) {
  margin: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
.actions :deep(a.btn) {
  text-decoration: none;
}
</style>
