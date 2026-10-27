<script setup lang="ts">
// A themed replacement for <progress>. Leave `value` out for an indeterminate bar.
import { computed } from "vue";

const props = withDefaults(defineProps<{ value?: number | undefined; max?: number; label: string; tone?: "accent" | "ok" | "bad" | "warn" }>(), { value: undefined, max: 1, tone: "accent" });
const pct = computed(() => (props.value === undefined ? null : Math.min(100, Math.max(0, (props.value / props.max) * 100))));
</script>

<template>
  <div
    class="pb"
    :class="[tone, { busy: pct === null }]"
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    :aria-valuemax="max"
    :aria-valuenow="value"
  >
    <div class="bar" :style="pct === null ? undefined : { width: `${pct}%` }" />
  </div>
</template>

<style scoped>
.pb {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: var(--raised);
  box-shadow: inset 0 0 0 var(--border-width) var(--line);
  overflow: hidden;
}
.bar {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s;
}
.ok .bar {
  background: var(--ok);
}
.bad .bar {
  background: var(--bad);
}
.warn .bar {
  background: var(--warn);
}
.busy .bar {
  position: absolute;
  width: 35%;
  animation: slide 1.2s ease-in-out infinite;
}
@keyframes slide {
  from {
    left: -35%;
  }
  to {
    left: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .busy .bar {
    left: 0;
    width: 100%;
    opacity: 0.5;
    animation: none;
  }
}
</style>
