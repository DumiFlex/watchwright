<script setup lang="ts">
// A detail page while its data loads: the title block, then `cards` cards of placeholder
// lines, in the page's own layout so nothing jumps when the real content arrives. The region
// is aria-busy with a label; put it where the page's content goes.
import SkeletonBlock from "./SkeletonBlock.vue";

withDefaults(defineProps<{ label?: string; cards?: number }>(), { label: "Loading", cards: 2 });
</script>

<template>
  <div class="page-skeleton" aria-busy="true" :aria-label="label">
    <div class="head">
      <SkeletonBlock width="min(320px, 70%)" height="1.6em" />
      <SkeletonBlock width="min(460px, 90%)" />
    </div>
    <section v-for="i in cards" :key="i" class="card body">
      <SkeletonBlock width="min(180px, 50%)" height="1.1em" />
      <SkeletonBlock :lines="i === 1 ? 4 : 3" />
    </section>
  </div>
</template>

<style scoped>
.page-skeleton {
  display: grid;
  gap: var(--space-4);
}
.head {
  display: grid;
  gap: var(--space-2);
}
.body {
  display: grid;
  gap: var(--space-3);
}
</style>
