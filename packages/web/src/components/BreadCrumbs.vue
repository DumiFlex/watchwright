<script setup lang="ts">
// Where a page sits: Runs > 0a1b2c3d > C1 Guest checkout. Every item but the last is a link;
// the last is the current page. With more than `max` items the middle ones fold into a menu,
// and at phone width only the first and last two stay out.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ChevronRight, Ellipsis } from "../icons";
import MenuButton from "./MenuButton.vue";

export interface Crumb {
  label: string;
  href?: string | undefined;
}

const props = withDefaults(defineProps<{ items: readonly Crumb[]; max?: number }>(), { max: 4 });

const narrow = ref(false);
let query: MediaQueryList | undefined;
const onChange = () => (narrow.value = query?.matches ?? false);
onMounted(() => {
  query = window.matchMedia("(max-width: 640px)");
  onChange();
  query.addEventListener("change", onChange);
});
onBeforeUnmount(() => query?.removeEventListener("change", onChange));

// Keep the first item and the last `tail` items; the rest go into the menu.
const shown = computed(() => {
  const all = props.items;
  const limit = narrow.value ? Math.min(3, props.max) : props.max;
  if (all.length <= limit) return { head: all.slice(), folded: [] as Crumb[], tail: [] as Crumb[] };
  const tail = Math.max(1, limit - 1);
  return { head: all.slice(0, 1), folded: all.slice(1, all.length - tail), tail: all.slice(all.length - tail) };
});
const menuItems = computed(() => shown.value.folded.map((c, i) => ({ value: String(i), label: c.label, ...(c.href ? { href: c.href } : {}) })));
const lastIndex = computed(() => shown.value.head.length + shown.value.tail.length - 1);
const visible = computed(() => [...shown.value.head, ...shown.value.tail]);
</script>

<template>
  <nav class="crumbs" aria-label="Breadcrumb">
    <ol>
      <template v-for="(c, i) in visible" :key="`${i}-${c.label}`">
        <li v-if="i === shown.head.length && shown.folded.length" class="fold">
          <MenuButton :items="menuItems" :label="`${shown.folded.length} more`" align="start">
            <template #button><Ellipsis :size="16" /></template>
          </MenuButton>
          <ChevronRight :size="14" class="sep" aria-hidden="true" />
        </li>
        <li>
          <span v-if="i === lastIndex" class="here" aria-current="page">{{ c.label }}</span>
          <a v-else-if="c.href" :href="c.href">{{ c.label }}</a>
          <span v-else class="plain">{{ c.label }}</span>
          <ChevronRight v-if="i !== lastIndex" :size="14" class="sep" aria-hidden="true" />
        </li>
      </template>
    </ol>
  </nav>
</template>

<style scoped>
ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
li {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}
a,
.plain,
.here {
  overflow: hidden;
  max-width: 24ch;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a {
  color: var(--muted);
  text-decoration: none;
}
a:hover {
  color: var(--accent-text);
  text-decoration: underline;
}
.plain {
  color: var(--muted);
}
.here {
  color: var(--text);
  font-weight: 600;
}
.sep {
  color: var(--muted);
  opacity: 0.7;
}
.fold :deep(.trigger) {
  min-width: 26px;
  height: 22px;
  padding: 0 var(--space-1);
  border-color: transparent;
  background: none;
  color: var(--muted);
}
.fold :deep(.trigger:hover),
.fold :deep(.trigger[aria-expanded="true"]) {
  background: var(--hover);
  color: var(--text);
}
</style>
