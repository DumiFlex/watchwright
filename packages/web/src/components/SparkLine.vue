<script setup lang="ts">
// A word-sized chart of one series: a line with a light wash under it, or small columns. It
// fills its container's width unless given one. The last value gets a dot; hovering shows
// the value under the pointer. Screen readers hear a summary (`label`, first, last, range).
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { areaPath, columnPath, compact, linePath, scale, slotAt, type Point } from "../chart";

const props = withDefaults(
  defineProps<{
    values: readonly number[];
    label: string;
    /** A name for each value (a run id, a date), shown on hover. */
    labels?: readonly string[] | undefined;
    kind?: "line" | "bars";
    width?: number | undefined;
    height?: number;
    /** "accent" for the series a view is about, "muted" when it only sets context. */
    tone?: "accent" | "muted";
    format?: (v: number) => string;
  }>(),
  { labels: undefined, kind: "line", width: undefined, height: 32, tone: "accent", format: compact },
);

const root = ref<HTMLElement | null>(null);
const measured = ref(120);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (props.width !== undefined || !root.value) return;
  observer = new ResizeObserver(([e]) => {
    if (e) measured.value = Math.max(24, Math.round(e.contentRect.width));
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const w = computed(() => props.width ?? measured.value);
// Room for the end dot and its ring so they aren't clipped.
const pad = 5;
const range = computed<[number, number]>(() => {
  const vs = props.values;
  if (!vs.length) return [0, 1];
  const lo = props.kind === "bars" ? Math.min(0, ...vs) : Math.min(...vs);
  return [lo, Math.max(...vs)];
});
const x = computed(() => scale([0, Math.max(1, props.values.length - 1)], [pad, w.value - pad]));
const y = computed(() => scale(range.value, [props.height - pad, pad]));
const points = computed<Point[]>(() => props.values.map((v, i) => [x.value(i), y.value(v)]));
const line = computed(() => linePath(points.value));
const area = computed(() => areaPath(points.value, props.height - pad));

const slot = computed(() => (w.value - 2 * pad) / Math.max(1, props.values.length));
const barW = computed(() => Math.max(1, Math.min(24, slot.value - 2)));
const bars = computed(() =>
  props.values.map((v, i) => {
    const top = y.value(Math.max(v, 0));
    const base = y.value(0);
    const left = pad + i * slot.value + (slot.value - barW.value) / 2;
    return columnPath(left, top, barW.value, Math.max(v === 0 ? 0 : 1, base - top), 2);
  }),
);

const hover = ref<number | null>(null);
function onMove(e: PointerEvent) {
  const box = (e.currentTarget as SVGElement).getBoundingClientRect();
  const at = e.clientX - box.left;
  hover.value = props.kind === "bars" ? slotAt(at - pad, w.value - 2 * pad, props.values.length) : Math.round(((at - pad) / (w.value - 2 * pad)) * (props.values.length - 1));
  hover.value = Math.min(props.values.length - 1, Math.max(0, hover.value));
}
const tipX = computed(() => {
  if (hover.value === null) return 0;
  return props.kind === "bars" ? pad + (hover.value + 0.5) * slot.value : x.value(hover.value);
});
const last = computed(() => points.value.at(-1));
const hoverPoint = computed(() => (hover.value === null ? undefined : points.value[hover.value]));
const hoverValue = computed(() => (hover.value === null ? undefined : props.values[hover.value]));
const summary = computed(() => {
  const vs = props.values;
  if (!vs.length) return `${props.label}: no data`;
  const f = props.format;
  return `${props.label}: ${vs.length} values from ${f(vs[0] ?? 0)} to ${f(vs.at(-1) ?? 0)}, low ${f(Math.min(...vs))}, high ${f(Math.max(...vs))}`;
});
</script>

<template>
  <div ref="root" class="sparkline" :class="`tone-${tone}`" :style="width === undefined ? undefined : { width: `${width}px` }">
    <svg :width="w" :height="height" :viewBox="`0 0 ${w} ${height}`" role="img" :aria-label="summary" @pointermove="onMove" @pointerleave="hover = null">
      <template v-if="kind === 'line'">
        <path class="area" :d="area" />
        <path class="line" :d="line" />
        <line v-if="hover !== null" class="cross" :x1="tipX" :x2="tipX" :y1="0" :y2="height" />
        <circle v-if="last && hover === null" class="dot" :cx="last[0]" :cy="last[1]" r="3.5" />
        <circle v-if="hoverPoint" class="dot" :cx="hoverPoint[0]" :cy="hoverPoint[1]" r="3.5" />
      </template>
      <template v-else>
        <path v-for="(d, i) in bars" :key="i" class="bar" :class="{ on: hover === i, end: i === bars.length - 1 }" :d="d" />
      </template>
      <!-- A wider invisible target, so the pointer doesn't have to hit the line. -->
      <rect class="hit" x="0" y="0" :width="w" :height="height" />
    </svg>
    <div v-if="hover !== null && hoverValue !== undefined" class="tip" :style="{ left: `${tipX}px` }" aria-hidden="true">
      <span v-if="labels?.[hover]" class="tip-label">{{ labels[hover] }}</span>
      <span class="num">{{ format(hoverValue) }}</span>
    </div>
  </div>
</template>

<style scoped>
.sparkline {
  position: relative;
  min-width: 24px;
}
svg {
  display: block;
  overflow: visible;
}
.line {
  fill: none;
  stroke: var(--series);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.area {
  fill: var(--series);
  opacity: 0.1;
}
.dot {
  fill: var(--series);
  stroke: var(--surface);
  stroke-width: 2;
}
.tone-accent {
  --series: var(--accent);
}
.tone-muted {
  --series: var(--muted);
}
.tone-muted .dot,
.tone-muted .bar.end {
  fill: var(--accent);
}
.bar {
  fill: var(--series);
}
.bar.on {
  fill: var(--accent-text);
}
.cross {
  stroke: var(--line-strong);
  stroke-width: 1;
}
.hit {
  fill: transparent;
}
.tip {
  position: absolute;
  bottom: calc(100% + 4px);
  z-index: 5;
  display: flex;
  gap: var(--space-2);
  padding: 2px 6px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  white-space: nowrap;
  transform: translateX(-50%);
  pointer-events: none;
}
.tip-label {
  color: var(--muted);
}
</style>
