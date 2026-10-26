<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status: string }>();
const LABELS: Record<string, string> = {
  failed_to_start: "failed to start",
  pending: "waiting",
};
const tone = computed(() => {
  switch (props.status) {
    case "passed":
    case "finished":
      return "ok";
    case "failed":
    case "failed_to_start":
      return "bad";
    case "broken":
    case "interrupted":
    case "paused":
    case "pausing":
      return "warn";
    case "running":
    case "queued":
      return "accent";
    default:
      return "muted";
  }
});
</script>

<template>
  <span class="chip-s" :class="tone">{{ LABELS[status] ?? status }}</span>
</template>

<style scoped>
.chip-s {
  display: inline-block;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
  border: 1px solid currentColor;
}
.ok {
  color: var(--ok);
}
.bad {
  color: var(--bad);
}
.warn {
  color: var(--warn);
}
.accent {
  color: var(--accent);
}
.muted {
  color: var(--muted);
}
</style>
