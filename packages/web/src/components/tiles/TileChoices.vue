<script setup lang="ts">
// How often each answer of a choices (or yes/no) criterion was given, one bar per run. Choices
// are in order (none, minor, major), so they read as steps of one hue, strongest first, with a
// legend and the counts in words on hover and for screen readers.
import { computed } from "vue";
import { runName, type TileData } from "../../dashboard";
import { when } from "../../format";
import { vTip } from "../../tooltip";

const props = defineProps<{ data: TileData["choices"] }>();

// Steps of the accent from strong to light, by position in the choice list.
const strength = (i: number) => {
  const n = Math.max(1, props.data.choices.length - 1);
  return Math.round(100 - (i / n) * 70);
};
/** Runs shown, newest last; a long range keeps its latest ones so the tile stays short. */
const SHOWN = 10;
const answered = computed(() => props.data.runs.filter((r) => Object.values(r.counts).some((n) => n > 0)));
const rows = computed(() =>
  answered.value
    .slice(-SHOWN)
    .map((r) => {
      const total = props.data.choices.reduce((s, c) => s + (r.counts[c] ?? 0), 0);
      return {
        ...r,
        total,
        text: props.data.choices.map((c) => `${c} ${r.counts[c] ?? 0}`).join(", "),
        parts: props.data.choices.map((c, i) => ({ c, i, n: r.counts[c] ?? 0, pct: total ? ((r.counts[c] ?? 0) / total) * 100 : 0 })).filter((p) => p.n > 0),
      };
    })
    .filter((r) => r.total > 0),
);
</script>

<template>
  <div class="tile-choices">
    <p v-if="!rows.length" class="muted small">No answers to {{ data.criterion }} in range yet.</p>
    <template v-else>
      <p class="legend small">
        <span v-for="(c, i) in data.choices" :key="c" class="key"><span class="sw" :style="{ '--k': `${strength(i)}%` }" aria-hidden="true" />{{ c }}</span>
      </p>
      <ul>
        <li v-for="r in rows" :key="r.runId" v-tip="`${runName(r)} · ${when(r.at)}: ${r.text}`" class="row">
          <span class="bar" role="img" :aria-label="`${runName(r)}: ${r.text}`">
            <span v-for="p in r.parts" :key="p.c" class="seg" :style="{ width: `${p.pct}%`, '--k': `${strength(p.i)}%` }" />
          </span>
          <span class="num small muted">{{ r.total }}</span>
        </li>
      </ul>
      <p v-if="answered.length > SHOWN" class="muted small">The latest {{ SHOWN }} of {{ answered.length }} runs with answers</p>
    </template>
  </div>
</template>

<style scoped>
p {
  margin: 0;
}
.tile-choices {
  display: grid;
  gap: var(--space-2);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}
.key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sw {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) var(--k), var(--surface));
}
ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 3ch;
  align-items: center;
  gap: var(--space-2);
}
.bar {
  display: flex;
  gap: 2px;
  height: 10px;
}
.seg {
  min-width: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) var(--k), var(--surface));
}
.num {
  text-align: right;
}
</style>
