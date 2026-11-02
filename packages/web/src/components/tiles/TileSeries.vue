<script setup lang="ts">
// A number per run over time (a metric, a review score, flagged attempts): the latest value big,
// its trend as a line. A split tile shows one row per value of its param (small multiples, one
// hue, the name beside each line), so models or formats are compared without a color legend.
import { computed } from "vue";
import { formatValue, meetsGoal, type Series } from "../../dashboard";
import { when } from "../../format";
import SparkLine from "../SparkLine.vue";
import { vTip } from "../../tooltip";

const props = defineProps<{
  series: Series[];
  /** The measure the values are, for formatting (`metric`, `score`, `flags`). */
  measure: string;
  unit?: string | null;
  goal?: { below?: number; above?: number } | null;
  /** For a score: the top of the scale ("of 5"). */
  scale?: number | null;
  label: string;
}>();

const rows = computed(() =>
  props.series.map((s) => {
    const pts = s.points.filter((p): p is typeof p & { value: number } => p.value !== null);
    const last = s.points.at(-1);
    return {
      group: s.group,
      values: pts.map((p) => p.value),
      labels: pts.map((p) => when(p.at)),
      latest: pts.at(-1)?.value ?? null,
      scored: last?.scored,
      total: last?.total,
      ok: meetsGoal(pts.at(-1)?.value, props.goal),
    };
  }),
);
const fmt = (v: number) => formatValue(v, props.measure, props.unit);
const split = computed(() => rows.value.length > 1 || rows.value[0]?.group !== null);
const goalText = computed(() => (props.goal ? (props.goal.below !== undefined ? `goal under ${fmt(props.goal.below)}` : `goal over ${fmt(props.goal.above ?? 0)}`) : ""));
</script>

<template>
  <div class="tile-series" :class="{ split }">
    <p v-if="!rows.some((r) => r.values.length)" class="muted small">No run in range recorded it yet.</p>
    <template v-else>
      <div v-for="r in rows" :key="r.group ?? ''" class="srow">
        <span v-if="split" class="group small">{{ r.group }}</span>
        <span class="latest num" :class="{ ok: r.ok === true, off: r.ok === false }">
          {{ r.latest === null ? "–" : fmt(r.latest) }}<span v-if="scale" class="of muted">/{{ scale }}</span>
        </span>
        <SparkLine class="spark" :values="r.values" :labels="r.labels" :label="`${label}${r.group ? `, ${r.group}` : ''}`" :format="fmt" :height="split ? 28 : 40" />
        <span v-if="r.total !== undefined" v-tip="'Attempts of the latest run with a score'" class="scored muted small num">{{ r.scored }} of {{ r.total }} scored</span>
      </div>
      <p v-if="goal" class="muted small goal">{{ goalText }}</p>
    </template>
  </div>
</template>

<style scoped>
.tile-series {
  display: grid;
  gap: var(--space-2);
}
.srow {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-1) var(--space-3);
}
.split .srow {
  grid-template-columns: minmax(4ch, 9ch) 9ch minmax(0, 1fr);
}
.group {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.latest {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
}
.split .latest {
  font-size: 14px;
}
.latest.off {
  color: var(--bad);
}
.latest.ok {
  color: var(--ok);
}
.of {
  font-size: 0.65em;
  font-weight: 500;
}
.scored {
  grid-column: 1 / -1;
}
.split .scored {
  grid-column: 2 / -1;
}
.goal {
  margin: 0;
}
p {
  margin: 0;
}
</style>
