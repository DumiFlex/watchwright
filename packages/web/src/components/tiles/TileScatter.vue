<script setup lang="ts">
// Two measures per value of a param (mean quality against mean AI seconds per model): one dot
// each, named beside it, one hue. Hovering or focusing a dot shows its numbers; a hidden table
// has them all for screen readers.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { niceTicks, scale } from "../../chart";
import { formatValue, type TileData } from "../../dashboard";

const props = defineProps<{ data: TileData["scatter"]; label: string }>();

const root = ref<HTMLElement | null>(null);
const width = ref(320);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!root.value) return;
  observer = new ResizeObserver(([e]) => {
    if (e) width.value = Math.max(200, Math.round(e.contentRect.width));
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const height = 200;
const left = 44;
const bottom = 30;
const top = 10;
const right = 12;
const fx = (v: number) => formatValue(v, props.data.x.key, props.data.x.unit);
const fy = (v: number) => formatValue(v, props.data.y.key, props.data.y.unit);
const xTicks = computed(() => niceTicks(Math.max(...props.data.points.map((p) => p.x), 0), 4, Math.min(0, ...props.data.points.map((p) => p.x))));
const yTicks = computed(() => niceTicks(Math.max(...props.data.points.map((p) => p.y), 0), 4, Math.min(0, ...props.data.points.map((p) => p.y))));
const x = computed(() => scale([xTicks.value[0] ?? 0, xTicks.value.at(-1) ?? 1], [left, width.value - right]));
const y = computed(() => scale([yTicks.value[0] ?? 0, yTicks.value.at(-1) ?? 1], [height - bottom, top]));
const dots = computed(() =>
  props.data.points.map((p) => {
    const cx = x.value(p.x);
    // Names go right of the dot, or left near the right edge.
    const end = cx > width.value - 70;
    return { ...p, cx, cy: y.value(p.y), lx: end ? cx - 8 : cx + 8, anchor: end ? "end" : "start" };
  }),
);
const hover = ref<number | null>(null);
const hovered = computed(() => (hover.value === null ? undefined : dots.value[hover.value]));
</script>

<template>
  <figure ref="root" class="tile-scatter">
    <p v-if="!data.points.length" class="muted small">No value of {{ data.by }} has both numbers yet.</p>
    <template v-else>
      <svg :width="width" :height="height" role="img" :aria-label="`${label}: ${data.points.length} values of ${data.by}`">
        <g class="grid">
          <line v-for="t in yTicks" :key="`y${t}`" :x1="left" :x2="width - right" :y1="y(t)" :y2="y(t)" />
          <text v-for="t in yTicks" :key="`yl${t}`" class="tick" :x="left - 6" :y="y(t) + 4" text-anchor="end">{{ fy(t) }}</text>
          <text v-for="t in xTicks" :key="`xl${t}`" class="tick" :x="x(t)" :y="height - bottom + 16" text-anchor="middle">{{ fx(t) }}</text>
        </g>
        <g v-for="(d, i) in dots" :key="d.group" class="dot-g" tabindex="0" :aria-label="`${d.group}: ${data.x.label} ${fx(d.x)}, ${data.y.label} ${fy(d.y)}`" @pointerenter="hover = i" @pointerleave="hover = null" @focus="hover = i" @blur="hover = null">
          <circle class="hit" :cx="d.cx" :cy="d.cy" r="12" />
          <circle class="dot" :class="{ on: hover === i }" :cx="d.cx" :cy="d.cy" r="5" />
          <text class="name" :x="d.lx" :y="d.cy + 4" :text-anchor="d.anchor">{{ d.group }}</text>
        </g>
      </svg>
      <figcaption class="axes muted small">
        <span>Across: {{ data.x.label }}</span><span>Up: {{ data.y.label }}</span>
      </figcaption>
      <div v-if="hovered" class="tip" :style="{ left: `${hovered.cx}px`, top: `${hovered.cy}px` }" aria-hidden="true">
        <strong>{{ hovered.group }}</strong>
        <span>{{ data.x.label }} <span class="num">{{ fx(hovered.x) }}</span></span>
        <span>{{ data.y.label }} <span class="num">{{ fy(hovered.y) }}</span></span>
        <span class="muted">{{ hovered.runs }} {{ hovered.runs === 1 ? "run" : "runs" }}</span>
      </div>
      <table class="sr-only">
        <caption>{{ label }}</caption>
        <thead>
          <tr><th scope="col">{{ data.by }}</th><th scope="col">{{ data.x.label }}</th><th scope="col">{{ data.y.label }}</th><th scope="col">Runs</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in data.points" :key="d.group"><th scope="row">{{ d.group }}</th><td>{{ fx(d.x) }}</td><td>{{ fy(d.y) }}</td><td>{{ d.runs }}</td></tr>
        </tbody>
      </table>
    </template>
  </figure>
</template>

<style scoped>
.tile-scatter {
  position: relative;
  margin: 0;
  min-width: 0;
}
svg {
  display: block;
  overflow: visible;
}
.grid line {
  stroke: var(--line);
  stroke-width: 1;
}
.tick {
  fill: var(--muted);
  font-size: 11px;
}
.dot {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 2;
}
.dot.on {
  fill: var(--accent-text);
  r: 6;
}
.hit {
  fill: transparent;
}
.dot-g {
  outline: none;
  cursor: default;
}
.dot-g:focus-visible .dot {
  stroke: var(--text);
}
.name {
  fill: var(--text);
  font-size: 12px;
}
.axes {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.tip {
  position: absolute;
  z-index: 5;
  display: grid;
  gap: 2px;
  padding: 4px 8px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  white-space: nowrap;
  transform: translate(-50%, calc(-100% - 12px));
  pointer-events: none;
}
p {
  margin: 0;
}
</style>
