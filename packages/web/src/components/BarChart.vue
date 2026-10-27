<script setup lang="ts">
// Columns of stacked counts, one per item (a run, a day): passed, failed and skipped tests per
// run, say. One axis from zero, hairline grid, a legend for every series, a hover tooltip per
// column and a hidden table with every value for screen readers. Series colors are tokens
// (status colors for statuses), never generated hues.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { columnPath, compact, niceTicks, scale, slotAt } from "../chart";

export interface BarSeries {
  key: string;
  label: string;
  /** A color token: a status (ok, bad, warn, paused), the accent, or muted. */
  tone: "ok" | "bad" | "warn" | "paused" | "accent" | "muted";
}
export interface BarItem {
  label: string;
  values: Readonly<Record<string, number>>;
}

const props = withDefaults(
  defineProps<{ items: readonly BarItem[]; series: readonly BarSeries[]; label: string; height?: number; format?: (v: number) => string }>(),
  { height: 180, format: compact },
);
const emit = defineEmits<{ pick: [index: number] }>();

const root = ref<HTMLElement | null>(null);
const width = ref(480);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!root.value) return;
  observer = new ResizeObserver(([e]) => {
    if (e) width.value = Math.max(160, Math.round(e.contentRect.width));
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const GAP = 2; // surface gap between stacked segments
const total = (it: BarItem) => props.series.reduce((sum, s) => sum + (it.values[s.key] ?? 0), 0);
const ticks = computed(() => niceTicks(Math.max(1, ...props.items.map(total))));
const axisW = computed(() => Math.max(...ticks.value.map((t) => props.format(t).length)) * 7 + 10);
const top = 8;
const bottom = 22;
const plotW = computed(() => Math.max(1, width.value - axisW.value));
const plotH = computed(() => props.height - top - bottom);
const y = computed(() => scale([0, ticks.value.at(-1) ?? 1], [top + plotH.value, top]));
const slot = computed(() => plotW.value / Math.max(1, props.items.length));
const colW = computed(() => Math.max(3, Math.min(24, slot.value * 0.62)));

const columns = computed(() =>
  props.items.map((it, i) => {
    const left = axisW.value + i * slot.value + (slot.value - colW.value) / 2;
    const parts = props.series.filter((s) => (it.values[s.key] ?? 0) > 0);
    let sum = 0;
    const segs = parts.map((s, k) => {
      const base = y.value(sum);
      sum += it.values[s.key] ?? 0;
      const isTop = k === parts.length - 1;
      // Every segment but the top one leaves a surface gap above it.
      const segTop = Math.min(base - 1, y.value(sum) + (isTop ? 0 : GAP));
      const d = isTop ? columnPath(left, segTop, colW.value, base - segTop, 4) : `M${left},${base}V${segTop}H${left + colW.value}V${base}Z`;
      return { key: s.key, tone: s.tone, d };
    });
    return { left, segs, center: left + colW.value / 2 };
  }),
);

// Labels under the columns, thinned so they don't run into each other.
const every = computed(() => {
  const longest = Math.max(1, ...props.items.map((it) => it.label.length));
  return Math.max(1, Math.ceil((longest * 6.5 + 8) / slot.value));
});

const hover = ref<number | null>(null);
function onMove(e: PointerEvent) {
  const box = (e.currentTarget as SVGElement).getBoundingClientRect();
  const at = e.clientX - box.left - axisW.value;
  hover.value = at < 0 ? null : slotAt(at, plotW.value, props.items.length);
}
const hovered = computed(() => (hover.value === null ? undefined : props.items[hover.value]));
// The tooltip sits beside its column, on the right unless that runs off the chart.
const tipStyle = computed(() => {
  const c = hover.value === null ? undefined : columns.value[hover.value];
  if (!c) return {};
  const right = c.center < width.value - 160;
  const edge = right ? c.left + colW.value + 8 : c.left - 8;
  return { left: `${edge}px`, transform: right ? "none" : "translateX(-100%)" };
});
</script>

<template>
  <figure ref="root" class="bar-chart">
    <figcaption class="legend">
      <span v-for="s in series" :key="s.key" class="key">
        <span class="swatch" :class="`t-${s.tone}`" aria-hidden="true" />
        {{ s.label }}
      </span>
    </figcaption>
    <div class="plot">
      <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true" @pointermove="onMove" @pointerleave="hover = null" @click="hover !== null && emit('pick', hover)">
        <g class="grid">
          <template v-for="t in ticks" :key="t">
            <line :x1="axisW" :x2="width" :y1="y(t)" :y2="y(t)" />
            <text :x="axisW - 8" :y="y(t)" dy="0.32em" text-anchor="end">{{ format(t) }}</text>
          </template>
        </g>
        <rect v-if="hover !== null && columns[hover]" class="band" :x="axisW + hover * slot" :y="top" :width="slot" :height="plotH" />
        <g v-for="(c, i) in columns" :key="i">
          <path v-for="s in c.segs" :key="s.key" :class="`t-${s.tone}`" :d="s.d" />
          <text v-if="i % every === 0" class="xlabel" :x="c.center" :y="height - 6" text-anchor="middle">{{ items[i]?.label }}</text>
        </g>
        <rect class="hit" :x="axisW" :y="0" :width="plotW" :height="height" />
      </svg>
      <div v-if="hovered" class="tip" :style="tipStyle" aria-hidden="true">
        <strong>{{ hovered.label }}</strong>
        <span v-for="s in series" :key="s.key" class="row">
          <span class="swatch" :class="`t-${s.tone}`" />
          <span class="name">{{ s.label }}</span>
          <span class="num">{{ format(hovered.values[s.key] ?? 0) }}</span>
        </span>
      </div>
    </div>
    <table class="sr-only">
      <caption>{{ label }}</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th v-for="s in series" :key="s.key" scope="col">{{ s.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in items" :key="i">
          <th scope="row">{{ it.label }}</th>
          <td v-for="s in series" :key="s.key">{{ it.values[s.key] ?? 0 }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
.bar-chart {
  position: relative;
  margin: 0;
  min-width: 0;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin-bottom: var(--space-2);
  color: var(--muted);
  font-size: 12px;
}
.key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
}
.plot {
  position: relative;
}
svg {
  display: block;
  overflow: visible;
}
.grid line {
  stroke: var(--line);
  stroke-width: 1;
  shape-rendering: crispEdges;
}
.grid text,
.xlabel {
  fill: var(--muted);
  font-size: 11px;
  font-family: var(--font-mono);
}
.band {
  fill: var(--hover);
}
.hit {
  fill: transparent;
  cursor: pointer;
}
.t-ok {
  fill: var(--ok);
  color: var(--ok);
}
.t-bad {
  fill: var(--bad);
  color: var(--bad);
}
.t-warn {
  fill: var(--warn);
  color: var(--warn);
}
.t-paused {
  fill: var(--paused);
  color: var(--paused);
}
.t-accent {
  fill: var(--accent);
  color: var(--accent);
}
.t-muted {
  fill: var(--line-strong);
  color: var(--line-strong);
}
.tip {
  position: absolute;
  top: 0;
  z-index: 5;
  display: grid;
  gap: 2px;
  min-width: 120px;
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  box-shadow: 0 6px 18px rgb(0 0 0 / 16%);
  pointer-events: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.name {
  flex: 1;
  color: var(--muted);
}
</style>
