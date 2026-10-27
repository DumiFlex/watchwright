<script setup lang="ts">
// A grey placeholder in the shape of what is loading: lines of text, a block or a circle.
// It is hidden from screen readers; put aria-busy="true" on the region that is loading. The
// shimmer stops for people who ask for less motion.
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    shape?: "text" | "block" | "circle";
    /** For text: how many lines. The last one is shorter, like a paragraph's end. */
    lines?: number;
    width?: string;
    height?: string | undefined;
  }>(),
  { shape: "text", lines: 1, width: "100%", height: undefined },
);

const rows = computed(() => Array.from({ length: Math.max(1, props.lines) }, (_, i) => (props.lines > 1 && i === props.lines - 1 ? "62%" : "100%")));
const size = computed(() => props.height ?? (props.shape === "circle" ? props.width : props.shape === "block" ? "96px" : "0.8em"));
</script>

<template>
  <span v-if="shape === 'text'" class="skeleton-lines" :style="{ width }" aria-hidden="true">
    <span v-for="(w, i) in rows" :key="i" class="skeleton" :style="{ width: w, height: size }" />
  </span>
  <span v-else class="skeleton" :class="{ round: shape === 'circle' }" :style="{ width, height: size }" aria-hidden="true" />
</template>

<style scoped>
.skeleton-lines {
  display: grid;
  gap: 0.55em;
  max-width: 100%;
}
.skeleton {
  display: block;
  max-width: 100%;
  border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--raised) 0%, color-mix(in srgb, var(--raised) 45%, var(--surface)) 50%, var(--raised) 100%) 0 0 / 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
.skeleton.round {
  border-radius: 50%;
}
@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
