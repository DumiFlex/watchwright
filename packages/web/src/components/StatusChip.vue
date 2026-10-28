<script setup lang="ts">
import { computed } from "vue";
import { loadKinds, outcomeLabel } from "../kinds";

// `kind` (a run's or attempt's job kind) shows the kind's word for an outcome ("done" for "passed").
const props = defineProps<{ status: string; kind?: string }>();
if (props.kind) void loadKinds();
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
      return "warn";
    case "paused":
    case "pausing":
      return "paused";
    case "running":
    case "queued":
      return "accent";
    default:
      return "muted";
  }
});
</script>

<template>
  <span class="chip-s" :class="tone">{{ LABELS[status] ?? outcomeLabel(status, kind) }}</span>
</template>

<style scoped>
.chip-s {
  display: inline-block;
  padding: 0 8px;
  border-radius: var(--radius-chip);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
  border: var(--border-width) solid currentColor;
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
.paused {
  color: var(--paused);
}
.muted {
  color: var(--muted);
}
</style>
