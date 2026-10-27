<script setup lang="ts">
// One headline number: a label, the value, an optional change against an earlier period and
// an optional trend line. Whether a rise is good decides the change's color (`goodWhen`);
// the arrow and the words carry it too, so it never rests on color alone.
import { computed } from "vue";
import { ArrowDown, ArrowUp, Minus } from "../icons";
import { compact } from "../chart";
import SparkLine from "./SparkLine.vue";

const props = withDefaults(
  defineProps<{
    label: string;
    value: number | string;
    unit?: string | undefined;
    /** The change since `period`, signed. */
    delta?: number | undefined;
    /** What the change compares with: "last week", "the previous run". */
    period?: string | undefined;
    goodWhen?: "up" | "down";
    /** How the change reads: "+3" by default, or "+4.2%" when given a formatter for that. */
    formatDelta?: (v: number) => string;
    trend?: readonly number[] | undefined;
    trendLabels?: readonly string[] | undefined;
  }>(),
  {
    unit: undefined,
    delta: undefined,
    period: undefined,
    goodWhen: "up",
    formatDelta: (v: number) => `${v > 0 ? "+" : ""}${compact(v)}`,
    trend: undefined,
    trendLabels: undefined,
  },
);

const shown = computed(() => (typeof props.value === "number" ? compact(props.value) : props.value));
const direction = computed(() => (props.delta === undefined || props.delta === 0 ? "flat" : props.delta > 0 ? "up" : "down"));
const verdict = computed(() => (direction.value === "flat" ? "flat" : direction.value === props.goodWhen ? "good" : "bad"));
const deltaText = computed(() => (props.delta === undefined ? "" : props.delta === 0 ? "No change" : props.formatDelta(props.delta)));
</script>

<template>
  <article class="stat-tile">
    <h3 class="label">{{ label }}</h3>
    <p class="value num">
      {{ shown }}<span v-if="unit" class="unit">{{ unit }}</span>
    </p>
    <p v-if="delta !== undefined" class="delta" :class="verdict">
      <ArrowUp v-if="direction === 'up'" :size="14" />
      <ArrowDown v-else-if="direction === 'down'" :size="14" />
      <Minus v-else :size="14" />
      <span :class="{ num: delta !== 0 }">{{ deltaText }}</span>
      <span v-if="period" class="period">vs {{ period }}</span>
    </p>
    <SparkLine v-if="trend?.length" class="trend" :values="trend" :labels="trendLabels" :label="`${label}, trend`" tone="muted" :height="36" />
  </article>
</template>

<style scoped>
.stat-tile {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.label {
  margin: 0;
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
}
.value {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
}
.unit {
  margin-left: 2px;
  color: var(--muted);
  font-size: 15px;
  font-weight: 500;
}
.delta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 12px;
}
.delta.good {
  color: var(--ok);
}
.delta.bad {
  color: var(--bad);
}
.delta.flat {
  color: var(--muted);
}
.period {
  color: var(--muted);
}
.trend {
  margin-top: var(--space-2);
}
</style>
