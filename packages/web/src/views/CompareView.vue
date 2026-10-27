<script setup lang="ts">
// Compare: the same tests across runs of one pack, runs across the top and tests down the side
// (a model matrix is several runs with different parameter values). Each cell shows the attempt's
// status, score, flags and metrics, plus a screenshot or kept text picked for the whole grid.
import { computed, ref, watch } from "vue";
import { getJson, type CompareCell, type Comparison, type Pack, type RunSummary } from "../api";
import { MAX_COMPARE, differingParams, exportUrl, paramsText, runIdsOf, runScores, shotOf, showOptions } from "../compare";
import { countsText, duration, when } from "../format";
import { replaceRoute } from "../router";
import ImageViewer from "../components/ImageViewer.vue";
import MenuButton from "../components/MenuButton.vue";
import MultiSelect from "../components/MultiSelect.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusChip from "../components/StatusChip.vue";
import { vTip } from "../tooltip";

const props = defineProps<{ query: Record<string, string> }>();

const packs = ref<Pack[]>([]);
const packId = ref("");
const packRuns = ref<RunSummary[]>([]);
const chosen = ref<string[]>(runIdsOf(props.query.runs));
const show = ref(props.query.show ?? "");
const data = ref<Comparison | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const opened = ref<Set<string>>(new Set());

const packOptions = computed(() => [{ value: "", label: "Pick a pack" }, ...packs.value.filter((p) => p.status === "ok").map((p) => ({ value: p.id, label: p.name }))]);
const runOptions = computed(() =>
  packRuns.value.map((r) => ({
    value: r.id,
    label: [r.id, paramsText(r.params)].filter(Boolean).join("  "),
    note: `${when(r.createdAt)} · ${countsText(r.counts)}`,
  })),
);
const shows = computed(() => (data.value ? showOptions(data.value) : [{ value: "", label: "Status and scores" }]));
const differing = computed(() => (data.value ? differingParams(data.value.runs) : []));
const scores = computed(() => (data.value ? runScores(data.value) : []));
const exports = computed(() => [
  { value: "md", label: "Markdown", href: exportUrl("md", chosen.value) },
  { value: "zip", label: "Markdown and screenshots (zip)", href: exportUrl("zip", chosen.value) },
]);
/** Tests with more than one attempt show the attempt number on each row. */
const manyAttempts = computed(() => {
  const seen = new Map<string, number>();
  for (const r of data.value?.rows ?? []) seen.set(r.testId, (seen.get(r.testId) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([t]) => t));
});

async function loadPacks() {
  const res = await getJson<Pack[]>("/api/v1/packs");
  if (res.ok) packs.value = res.data;
  else error.value = res.error.message;
}
async function loadRuns(id: string) {
  packRuns.value = [];
  if (!id) return;
  const res = await getJson<RunSummary[]>(`/api/v1/runs?pack=${id}&limit=100&status=finished,stopped,interrupted,running,paused,pausing`);
  if (id !== packId.value) return;
  if (res.ok) packRuns.value = res.data;
}
async function loadComparison() {
  const ids = chosen.value;
  if (ids.length === 0) {
    data.value = null;
    return;
  }
  loading.value = true;
  const res = await getJson<Comparison>(`/api/v1/compare?runs=${ids.join(",")}`);
  if (ids !== chosen.value) return;
  loading.value = false;
  if (!res.ok) {
    error.value = res.error.message;
    data.value = null;
    return;
  }
  error.value = null;
  data.value = res.data;
  if (packId.value !== res.data.packId) packId.value = res.data.packId;
  if (show.value && !showOptions(res.data).some((o) => o.value === show.value)) show.value = "";
}

void loadPacks();
void loadComparison();
watch(packId, (id, old) => {
  void loadRuns(id);
  // A new pack starts a new comparison; the first load only fills in the pack of the runs given.
  if (old !== "" && id !== data.value?.packId) chosen.value = [];
});
watch(chosen, (ids, old) => {
  if (ids.length > MAX_COMPARE) {
    chosen.value = ids.slice(0, MAX_COMPARE);
    return;
  }
  if (ids.join() !== old.join()) void loadComparison();
});
watch([chosen, show], () => replaceRoute({ name: "compare", query: { runs: chosen.value.join(","), show: show.value } }), { immediate: true });

const shown = (cell: CompareCell) => {
  if (show.value.startsWith("shot:")) return { shot: shotOf(cell, show.value.slice(5)) };
  if (show.value.startsWith("text:")) return { text: cell.texts[show.value.slice(5)] ?? null };
  return {};
};
const scoreText = (n: number | null) => (n === null ? null : n.toFixed(1));
const metrics = (cell: CompareCell) => Object.entries(cell.metrics).slice(0, 4);
const rowKey = (r: { testId: string; number: number }) => `${r.testId}#${r.number}`;
function toggle(key: string) {
  const next = new Set(opened.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  opened.value = next;
}

// One viewer for every screenshot on the page; opening a cell's shot loads that cell's shots.
const viewerImages = ref<{ url: string; name: string }[]>([]);
const viewerAt = ref<number | null>(null);
function openShots(cell: CompareCell, url: string) {
  viewerImages.value = cell.shots.map((s) => ({ url: s.url, name: s.name }));
  viewerAt.value = Math.max(0, cell.shots.findIndex((s) => s.url === url));
}
const runTag = (i: number) => {
  const r = data.value?.runs[i];
  return r ? [r.id, paramsText(r.params, differing.value)].filter(Boolean).join(" · ") : "";
};
</script>

<template>
  <main class="page wide">
    <div class="page-head">
      <div>
        <h1 class="display">Compare</h1>
        <p class="muted">The same tests across runs of one pack. Runs with different parameter values make a matrix, for example one run per model.</p>
      </div>
      <MenuButton v-if="chosen.length" :items="exports" label="Export">
        <template #button><span class="exportlabel">Export</span></template>
      </MenuButton>
    </div>

    <section class="card picker" aria-label="Runs to compare">
      <div class="pick">
        <label class="label" for="cmp-pack">Pack</label>
        <SelectMenu id="cmp-pack" v-model="packId" :options="packOptions" />
      </div>
      <div class="pick runs">
        <label class="label" for="cmp-runs">Runs (up to {{ MAX_COMPARE }})</label>
        <MultiSelect id="cmp-runs" v-model="chosen" :options="runOptions" :disabled="!packId" placeholder="Search runs by id or parameter" empty-label="No runs picked" />
      </div>
      <div class="pick">
        <label class="label" for="cmp-show">Show in cells</label>
        <SelectMenu id="cmp-show" v-model="show" :options="shows" :disabled="!data" />
      </div>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <section v-else-if="!data" class="card empty">
      <p v-if="loading" class="muted">Loading…</p>
      <p v-else class="muted">Pick a pack, then the runs to put side by side.</p>
    </section>

    <section v-else class="card grid-card" :aria-busy="loading">
      <div class="scroll">
        <table class="cmp" :style="{ '--runs': data.runs.length }">
          <thead>
            <tr>
              <th scope="col" class="corner"><span class="muted small">{{ data.rows.length }} rows · {{ data.packName }}</span></th>
              <th v-for="(r, i) in data.runs" :key="r.id" scope="col" class="runhead">
                <a :href="`#/runs/${r.id}`" class="mono runid">{{ r.id }}</a>
                <span v-if="Object.keys(r.params).length" class="params">
                  <span v-for="(v, k) in r.params" :key="k" class="param" :class="{ differs: differing.includes(String(k)) }">{{ k }}={{ v }}</span>
                </span>
                <span v-if="Object.keys(r.info ?? {}).length" class="facts small">
                  <span v-for="(v, k) in r.info" :key="k" class="fact"><span class="muted">{{ k }}</span> {{ v }}</span>
                </span>
                <span class="line"><StatusChip :status="r.status" /> <span class="muted small">{{ countsText(r.counts) }}</span></span>
                <span class="small">Score <strong class="num">{{ scoreText(scores[i] ?? null) ?? "–" }}</strong></span>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in data.rows" :key="rowKey(row)">
              <tr>
                <th scope="row" class="test">
                  <span><span class="mono">{{ row.testId }}</span> {{ row.title }}</span>
                  <span v-if="manyAttempts.has(row.testId)" class="muted small">attempt {{ row.number }}</span>
                  <button
                    v-if="row.cells.some((c) => c && c.shots.length)"
                    type="button"
                    class="more small"
                    :aria-expanded="opened.has(rowKey(row))"
                    @click="toggle(rowKey(row))"
                  >
                    {{ opened.has(rowKey(row)) ? "Hide screenshots" : "All screenshots" }}
                  </button>
                </th>
                <td v-for="(cell, i) in row.cells" :key="i" class="cell">
                  <span class="runtag mono small">{{ runTag(i) }}</span>
                  <template v-if="cell">
                    <a :href="`#/runs/${cell.runId}/attempts/${cell.attemptId}`" class="head">
                      <StatusChip :status="cell.status" />
                      <span v-if="cell.score !== null" class="num score">{{ scoreText(cell.score) }}</span>
                      <span v-else class="muted small">not reviewed</span>
                      <span v-if="cell.flags.length" v-tip="cell.flags.map((f) => f.name).join(', ')" class="flags num">{{ cell.flags.length }}</span>
                      <span v-if="cell.durationMs !== null" class="muted small dur">{{ duration(cell.durationMs) }}</span>
                    </a>
                    <p v-if="cell.error" class="err small" :class="{ calm: cell.status === 'skipped' }">{{ cell.error.split("\n")[0] }}</p>
                    <dl v-if="metrics(cell).length" class="metrics small">
                      <template v-for="[k, m] in metrics(cell)" :key="k">
                        <dt>{{ k }}</dt>
                        <dd class="num">{{ m.unit ? `${m.value} ${m.unit}` : m.value }}</dd>
                      </template>
                    </dl>
                    <template v-if="shown(cell).shot !== undefined">
                      <button v-if="shown(cell).shot" type="button" class="thumb" :aria-label="`Open ${shown(cell).shot!.name}`" @click="openShots(cell, shown(cell).shot!.url)">
                        <img :src="shown(cell).shot!.url" alt="" loading="lazy" />
                      </button>
                      <p v-else class="muted small">No such screenshot.</p>
                    </template>
                    <template v-if="shown(cell).text !== undefined">
                      <pre v-if="shown(cell).text" class="text small">{{ shown(cell).text }}</pre>
                      <p v-else class="muted small">No such text.</p>
                    </template>
                  </template>
                  <p v-else class="muted small">Not in this run.</p>
                </td>
              </tr>
              <tr v-if="opened.has(rowKey(row))" class="detail">
                <th scope="row" class="test muted small">Screenshots</th>
                <td v-for="(cell, i) in row.cells" :key="i" class="cell">
                  <span class="runtag mono small">{{ runTag(i) }}</span>
                  <div v-if="cell && cell.shots.length" class="shots">
                    <button v-for="s in cell.shots" :key="s.url" type="button" class="thumb" :aria-label="`Open ${s.name}`" @click="openShots(cell, s.url)">
                      <img :src="s.url" alt="" />
                      <span class="muted small">{{ s.name }}</span>
                    </button>
                  </div>
                  <p v-else class="muted small">No screenshots.</p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
    <ImageViewer v-model="viewerAt" :images="viewerImages" label="Screenshots" />
  </main>
</template>

<style scoped>
.page.wide {
  max-width: 1600px;
}
.picker {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(260px, 2fr) minmax(180px, 1fr);
  gap: var(--space-4);
  align-items: end;
}
.pick {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.exportlabel {
  padding: 0 var(--space-2);
  font-size: 14px;
}
.empty p {
  margin: 0;
}
.grid-card {
  padding: 0;
  overflow: hidden;
}
.scroll {
  overflow-x: auto;
}
.cmp {
  width: 100%;
  min-width: calc(220px + var(--runs) * 240px);
  border-collapse: collapse;
  table-layout: fixed;
}
.cmp th,
.cmp td {
  padding: var(--space-3);
  border-bottom: var(--border-width) solid var(--line);
  text-align: left;
  vertical-align: top;
}
.cmp td + td,
.cmp th + td,
.cmp th + th {
  border-left: var(--border-width) solid var(--line);
}
.cmp thead th {
  background: var(--raised);
  font-weight: 400;
}
.corner,
.test {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 220px;
  background: var(--surface);
}
thead .corner {
  background: var(--raised);
}
.runhead {
  display: table-cell;
}
.runhead > * {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.runhead > :first-child {
  margin-top: 0;
}
.runid {
  font-weight: 600;
}
.param {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
}
.param.differs {
  color: var(--text);
  font-weight: 600;
}
.test {
  font-weight: 400;
}
.test > * {
  display: block;
}
.more {
  margin-top: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.more:hover {
  text-decoration: underline;
}
.cell {
  display: table-cell;
  min-width: 0;
}
.runtag {
  display: none;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: inherit;
  text-decoration: none;
}
.head:hover .score {
  text-decoration: underline;
}
.score {
  font-weight: 600;
}
.flags {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--raised);
  font-size: 12px;
  text-align: center;
}
.dur {
  margin-left: auto;
}
.err {
  margin: var(--space-2) 0 0;
  color: var(--bad);
  overflow-wrap: anywhere;
}
.err.calm {
  color: var(--muted);
}
.metrics {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 var(--space-2);
  margin: var(--space-2) 0 0;
}
.metrics dt {
  color: var(--muted);
}
.metrics dd {
  margin: 0;
}
.thumb {
  display: block;
  width: 100%;
  margin-top: var(--space-2);
  padding: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--raised);
  cursor: zoom-in;
  overflow: hidden;
  text-align: left;
}
.thumb img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  object-position: left top;
}
.shots .thumb span {
  display: block;
  padding: 2px 6px;
}
.shots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-2);
}
.shots .thumb {
  margin-top: 0;
}
.text {
  max-height: 9.5em;
  margin: var(--space-2) 0 0;
  padding: var(--space-2);
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--raised);
  font-family: var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.cell > p {
  margin: var(--space-2) 0 0;
}
.cell > .runtag + p {
  margin-top: 0;
}
.detail .cell {
  background: var(--raised);
}

@media (max-width: 900px) {
  .picker {
    grid-template-columns: 1fr;
  }
}
/* At phone width the grid becomes a list: one block per test, one entry per run. */
@media (max-width: 640px) {
  .cmp,
  .cmp tbody,
  .cmp tr,
  .cmp th,
  .cmp td {
    display: block;
    width: auto;
    min-width: 0;
  }
  .cmp thead {
    display: none;
  }
  .cmp tr {
    border-bottom: var(--border-width) solid var(--line-strong);
  }
  .cmp td + td,
  .cmp th + td {
    border-left: 0;
  }
  .corner,
  .test {
    position: static;
    width: auto;
  }
  .runtag {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--muted);
  }
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
}
.fact {
  overflow-wrap: anywhere;
}
</style>
