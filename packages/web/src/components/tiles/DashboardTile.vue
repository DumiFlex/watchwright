<script setup lang="ts">
// One tile of a pack's dashboard: a card with the tile's title that shows its kind's view of the
// data. Outcomes, run times, a single number, a note and links are drawn here; the other kinds
// have components of their own beside this one.
import { computed } from "vue";
import { formatChange, formatValue, measureLabel, runName, type DashLink, type TileData, type TileResult } from "../../dashboard";
import { duration, when } from "../../format";
import { href } from "../../router";
import { CircleAlert, Download, ExternalLink, Play } from "../../icons";
import { vTip } from "../../tooltip";
import BarChart from "../BarChart.vue";
import MarkdownView from "../MarkdownView.vue";
import SparkLine from "../SparkLine.vue";
import TileChoices from "./TileChoices.vue";
import TileList from "./TileList.vue";
import TileMade from "./TileMade.vue";
import TileMatrix from "./TileMatrix.vue";
import TileScatter from "./TileScatter.vue";
import TileSeries from "./TileSeries.vue";
import TileTable from "./TileTable.vue";
import { ArrowDown, ArrowUp, Minus } from "../../icons";

const props = defineProps<{
  result: TileResult;
  packId: string;
  /** The pack's latest run ids, newest first, for the links tile. */
  latestRuns: readonly string[];
}>();

const t = computed(() => props.result.tile);
// The data typed by the tile's kind (the server shapes it per kind).
function as<K extends keyof TileData>(kind: K): TileData[K] {
  if (props.result.tile.type !== kind) throw new Error(`A ${props.result.tile.type} tile read as ${kind}.`);
  return props.result.data as unknown as TileData[K];
}
const outcomeSeries = [
  { key: "passed", label: "Passed", tone: "ok" as const },
  { key: "failed", label: "Failed", tone: "bad" as const },
  { key: "broken", label: "Broken", tone: "warn" as const },
  { key: "skipped", label: "Skipped or stopped", tone: "muted" as const },
];
const outcomeItems = computed(() =>
  t.value.type === "outcome" ? as("outcome").runs.map((r) => ({ label: runName(r).slice(0, 10), values: { passed: r.counts.passed, failed: r.counts.failed, broken: r.counts.broken, skipped: r.counts.skipped + r.counts.stopped } })) : [],
);

const stat = computed(() => (t.value.type === "stat" ? as("stat") : null));
const statVerdict = computed(() => {
  const s = stat.value;
  if (!s || s.change === null || s.change === 0 || s.better === null) return "flat";
  return (s.change > 0) === (s.better === "high") ? "good" : "bad";
});

function linkOf(l: DashLink): { href: string; label: string; external: boolean } | null {
  const [last, before, older] = props.latestRuns;
  if ("preset" in l) return { href: href({ name: "new", query: { pack: props.packId, preset: l.preset } }), label: l.label ?? `Run ${l.preset}`, external: false };
  if ("compare" in l) {
    const pair = l.compare === "last" ? [before, last] : [older, before];
    return pair[0] && pair[1] ? { href: href({ name: "compare", query: { runs: pair.join(",") } }), label: l.label ?? (l.compare === "last" ? "Compare the last two runs" : "Compare the two runs before"), external: false } : null;
  }
  if ("export" in l) return last ? { href: `/api/v1/export.md?runs=${last}`, label: l.label ?? "Export the latest run", external: false } : null;
  return { href: l.url, label: l.label, external: true };
}
</script>

<template>
  <article class="dash-tile" :class="`w-${t.width}`">
    <h3 class="ttitle">{{ result.title }}</h3>
    <p v-if="result.error" class="err small"><CircleAlert :size="14" /> {{ result.error }}</p>
    <template v-else-if="result.data">
      <BarChart v-if="t.type === 'outcome'" :items="outcomeItems" :series="outcomeSeries" :label="result.title" :height="150" />
      <TileSeries v-else-if="t.type === 'metric'" :series="as('metric').series" :measure="`metric.${as('metric').name}`" :unit="as('metric').unit" :goal="as('metric').goal" :label="result.title" />
      <TileSeries v-else-if="t.type === 'score'" :series="as('score').series" measure="score" :goal="as('score').goal" :scale="as('score').scale" :label="result.title" />
      <TileSeries v-else-if="t.type === 'flags'" :series="as('flags').series" measure="flags" :label="result.title" />
      <TileChoices v-else-if="t.type === 'choices'" :data="as('choices')" />
      <div v-else-if="t.type === 'duration'" class="dur">
        <p v-if="!as('duration').runs.length" class="muted small">No finished run in range yet.</p>
        <template v-else>
          <p class="latest-run"><span class="big num">{{ duration(as("duration").runs.at(-1)!.ms) }}</span> <span class="muted small">latest run</span></p>
          <SparkLine kind="bars" :values="as('duration').runs.map((r) => r.ms)" :labels="as('duration').runs.map((r) => `${runName(r)} · ${when(r.at)}`)" :label="result.title" :format="(v) => duration(v)" :height="40" />
          <p v-if="as('duration').slowest.length" class="sub muted small">Slowest tests</p>
          <ul class="slow">
            <li v-for="s in as('duration').slowest" :key="s.testId" class="small">
              <span class="mono">{{ s.testId }}</span> <span class="stitle">{{ s.title !== s.testId ? s.title : "" }}</span>
              <span v-tip="`Mean of ${s.attempts} ${s.attempts === 1 ? 'attempt' : 'attempts'}`" class="num">{{ duration(s.ms) }}</span>
            </li>
          </ul>
        </template>
      </div>
      <div v-else-if="stat" class="stat">
        <p class="big num">{{ formatValue(stat.value, stat.measure, stat.unit) }}</p>
        <p v-if="stat.change !== null" class="delta small" :class="statVerdict">
          <ArrowUp v-if="stat.change > 0" :size="14" /><ArrowDown v-else-if="stat.change < 0" :size="14" /><Minus v-else :size="14" />
          <span class="num">{{ stat.change === 0 ? "No change" : formatChange(stat.change, stat.measure, stat.unit) }}</span>
          <span class="muted">vs the runs before</span>
        </p>
        <p v-else class="muted small">{{ measureLabel(stat.measure) }} over the runs in range</p>
      </div>
      <TileTable v-else-if="t.type === 'leaderboard'" kind="leaderboard" :data="as('leaderboard')" />
      <TileTable v-else-if="t.type === 'breakdown'" kind="breakdown" :data="as('breakdown')" />
      <TileScatter v-else-if="t.type === 'scatter'" :data="as('scatter')" :label="result.title" />
      <TileMatrix v-else-if="t.type === 'matrix'" :data="as('matrix')" />
      <TileList v-else-if="t.type === 'failures'" kind="failures" :data="as('failures')" />
      <TileList v-else-if="t.type === 'lowest'" kind="lowest" :data="as('lowest')" />
      <TileList v-else-if="t.type === 'flaky'" kind="flaky" :data="as('flaky')" />
      <TileList v-else-if="t.type === 'unreviewed'" kind="unreviewed" :data="as('unreviewed')" />
      <TileMade v-else-if="t.type === 'value'" kind="value" :data="as('value')" />
      <TileMade v-else-if="t.type === 'shot'" kind="shot" :data="as('shot')" />
      <TileMade v-else-if="t.type === 'output'" kind="output" :data="as('output')" />
      <TileMade v-else-if="t.type === 'latest'" kind="latest" :data="as('latest')" />
      <MarkdownView v-else-if="t.type === 'note'" :source="as('note').markdown" :label="result.title" id-prefix="note-" />
      <div v-else-if="t.type === 'links'" class="links">
        <template v-for="(l, i) in as('links').links" :key="i">
          <a v-if="linkOf(l)" class="btn" :href="linkOf(l)!.href" v-bind="linkOf(l)!.external ? { target: '_blank', rel: 'noopener' } : {}">
            <Play v-if="'preset' in l" :size="14" /><Download v-else-if="'export' in l" :size="14" /><ExternalLink v-else-if="'url' in l" :size="14" />
            {{ linkOf(l)!.label }}
          </a>
        </template>
      </div>
    </template>
  </article>
</template>

<style scoped>
.dash-tile {
  display: grid;
  align-content: start;
  gap: var(--space-3);
  /* The grid says how many columns it has (--cols): fewer on a narrow screen. */
  grid-column: span min(var(--w, 1), var(--cols, 4));
  min-width: 0;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.w-2 {
  --w: 2;
}
.w-3 {
  --w: 3;
}
.w-4 {
  --w: 4;
}
.ttitle {
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
p {
  margin: 0;
}
.err {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--bad);
}
.big {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
}
.latest-run {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}
.dur,
.stat {
  display: grid;
  gap: var(--space-2);
}
.sub {
  margin-top: var(--space-1);
}
.slow {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.slow li {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
}
.stitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.delta {
  display: flex;
  align-items: center;
  gap: 4px;
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
.links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.links .btn {
  text-decoration: none;
}
</style>
