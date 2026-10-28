<script setup lang="ts">
// The home page: runs that are going (or waiting) first, then every earlier run with filters
// by pack and status, a page at a time. Filters live in the address so a list can be linked.
import { Ellipsis, Package, Play, SearchX } from "../icons";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type Pack, type RunSummary } from "../api";
import { ago, countsText, done, duration, isActive, runDuration, when } from "../format";
import { PERIODS, SERIES, anything, bars, tiles, type RunStats } from "../runstats";
import { LiveConnection } from "../live";
import { offerNotify } from "../notify";
import { replaceRoute } from "../router";
import { browserStore } from "../theme";
import { toast } from "../toasts";
import EmptyState from "../components/EmptyState.vue";
import MenuButton from "../components/MenuButton.vue";
import BarChart from "../components/BarChart.vue";
import ModalDialog from "../components/ModalDialog.vue";
import ProgressBar from "../components/ProgressBar.vue";
import SelectMenu from "../components/SelectMenu.vue";
import SkeletonBlock from "../components/SkeletonBlock.vue";
import TextField from "../components/TextField.vue";
import StatTile from "../components/StatTile.vue";
import StatusChip from "../components/StatusChip.vue";
import { vTip } from "../tooltip";

const props = defineProps<{ query: Record<string, string> }>();

const PAGE = 50;
const FINISHED = "finished,stopped,interrupted,failed_to_start";
const statusOptions = [
  { value: "", label: "Any status" },
  { value: "finished", label: "Finished" },
  { value: "stopped", label: "Stopped" },
  { value: "interrupted", label: "Interrupted" },
  { value: "failed_to_start", label: "Failed to start" },
];

const packs = ref<Pack[]>([]);
const active = ref<RunSummary[]>([]);
const runs = ref<RunSummary[]>([]);
const more = ref(false);
const loading = ref(true);
const loadError = ref<string | null>(null);
const packFilter = ref(props.query.pack ?? "");
const statusFilter = ref(statusOptions.some((o) => o.value === props.query.status) ? (props.query.status ?? "") : "");
const search = ref(props.query.q ?? "");
const now = ref(Date.now());

// At a glance: tiles and attempts per day for the last days, following the pack filter.
const store = browserStore();
const stats = ref<RunStats | null>(null);
const periodOptions = PERIODS.map((d) => ({ value: String(d), label: `Last ${d} days` }));
const period = ref(((): string => {
  try {
    const v = store?.getItem("ww.runs.period");
    return v && periodOptions.some((o) => o.value === v) ? v : "14";
  } catch {
    return "14";
  }
})());
const glanceTiles = computed(() => (stats.value ? tiles(stats.value) : []));
const glanceBars = computed(() => (stats.value ? bars(stats.value) : []));
const showGlance = computed(() => stats.value !== null && anything(stats.value));
async function loadStats() {
  const q = new URLSearchParams({ days: period.value, tz: String(new Date().getTimezoneOffset()) });
  if (packFilter.value) q.set("pack", packFilter.value);
  const res = await getJson<RunStats>(`/api/v1/runs/stats?${q}`);
  if (res.ok) stats.value = res.data;
}
watch(period, (v) => {
  try {
    store?.setItem("ww.runs.period", v);
  } catch {
    // remembered only when the browser allows it
  }
  void loadStats();
});

const packOptions = computed(() => [{ value: "", label: "All packs" }, ...packs.value.map((p) => ({ value: p.id, label: p.name }))]);
const filtered = computed(() => packFilter.value !== "" || statusFilter.value !== "" || search.value.trim() !== "");

function listUrl(before?: string) {
  const q = new URLSearchParams({ limit: String(PAGE), status: statusFilter.value || FINISHED });
  if (packFilter.value) q.set("pack", packFilter.value);
  if (search.value.trim()) q.set("q", search.value.trim());
  if (before) q.set("before", before);
  return `/api/v1/runs?${q}`;
}

async function load() {
  void loadStats();
  const [p, a, r] = await Promise.all([
    getJson<Pack[]>("/api/v1/packs"),
    getJson<RunSummary[]>("/api/v1/runs?status=queued,running,pausing,paused&limit=50"),
    getJson<RunSummary[]>(listUrl()),
  ]);
  loading.value = false;
  const failed = [p, a, r].find((x) => !x.ok);
  loadError.value = failed && !failed.ok ? failed.error.message : null;
  if (p.ok) packs.value = p.data;
  if (a.ok) active.value = a.data.slice().reverse(); // oldest first: the order they run in
  if (r.ok) {
    runs.value = r.data;
    more.value = r.data.length === PAGE;
  }
}

async function loadMore() {
  const last = runs.value[runs.value.length - 1];
  if (!last) return;
  const r = await getJson<RunSummary[]>(listUrl(last.createdAt));
  if (!r.ok) return void (loadError.value = r.error.message);
  runs.value = [...runs.value, ...r.data];
  more.value = r.data.length === PAGE;
}

watch([packFilter, statusFilter], () => {
  replaceRoute({ name: "runs", query: { pack: packFilter.value, status: statusFilter.value, q: search.value.trim() } });
  void load();
});
// A link to the list with a search (#/?q=…) while the list is open.
watch(
  () => props.query.q ?? "",
  (q) => {
    if (q !== search.value.trim()) search.value = q;
  },
);
// The search waits for a pause in typing.
let typing: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (typing) clearTimeout(typing);
  typing = setTimeout(() => {
    replaceRoute({ name: "runs", query: { pack: packFilter.value, status: statusFilter.value, q: search.value.trim() } });
    void load();
  }, 250);
});

// Delete, behind a confirm dialog.
const deleting = ref<RunSummary | null>(null);
const deleteOpen = computed({
  get: () => deleting.value !== null,
  set: (v) => {
    if (!v) deleting.value = null;
  },
});
const deleteError = ref<string | null>(null);
const busy = ref(false);
async function onRowMenu(r: RunSummary, value: string) {
  if (value === "delete") {
    deleteError.value = null;
    deleting.value = r;
  } else if (value === "run-again") {
    const res = await sendJson<RunSummary>(`/api/v1/runs/${r.id}/again`);
    if (!res.ok) return void toast(res.error.message, { tone: "bad" });
    offerNotify();
    window.location.hash = `#/runs/${res.data.id}`;
  }
}
async function confirmDelete() {
  const r = deleting.value;
  if (!r) return;
  busy.value = true;
  const res = await sendJson(`/api/v1/runs/${r.id}`, {}, "DELETE");
  busy.value = false;
  if (!res.ok) return void (deleteError.value = res.error.message);
  deleting.value = null;
  runs.value = runs.value.filter((x) => x.id !== r.id);
}

function rowMenu(r: RunSummary) {
  return [
    { value: "open", label: "Open", href: `#/runs/${r.id}` },
    ...(isActive(r.status) ? [] : [{ value: "run-again", label: "Run again" }]),
    { value: "again", label: "New run like this…", href: `#/new?pack=${r.packId}&from=${r.id}` },
    { value: "delete", label: "Delete…", danger: true },
  ];
}

/** Planned tests that didn't pass, fail or break (skipped, stopped or never run). */
const rest = (r: RunSummary) => Math.max(0, r.counts.planned - r.counts.passed - r.counts.failed - r.counts.broken);
const packName = (id: string) => packs.value.find((p) => p.id === id)?.name;

let live: LiveConnection | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  // Run and pack events refresh the lists (debounced).
  live = new LiveConnection(
    {},
    {
      onEvent: (e) => {
        if (!/^(run|pack)\./.test(e.type)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void load(), 300);
      },
    },
  );
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => {
  live?.close();
  if (timer) clearTimeout(timer);
  if (clock) clearInterval(clock);
  if (typing) clearTimeout(typing);
});
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h1 class="display">Runs</h1>
        <p class="muted">Start a run from a pack, watch it live, and come back to its results here.</p>
      </div>
    </div>
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>

    <section v-if="active.length" class="card" aria-labelledby="active-title">
      <h2 id="active-title" class="display">Going now</h2>
      <ul class="active">
        <li v-for="r in active" :key="r.id">
          <a class="arun" :href="`#/runs/${r.id}`">
            <span class="aname">{{ r.packName }} <span v-if="r.label" class="rlabel">{{ r.label }}</span> <span class="muted num small">{{ r.id }}</span></span>
            <StatusChip :status="r.status" />
            <ProgressBar class="aprog" :value="done(r.counts)" :max="Math.max(1, r.counts.planned)" :label="`${r.packName} progress`" :tone="r.counts.broken || r.counts.failed ? 'warn' : 'accent'" />
            <span class="muted small">
              {{ done(r.counts) }} of {{ r.counts.planned }} tests<template v-if="r.counts.failed"> · {{ r.counts.failed }} failed</template><template v-if="r.counts.broken"> · {{ r.counts.broken }} broken</template>
              <template v-if="r.startedAt"> · {{ duration(runDuration(r, now)) }}</template>
              <template v-else> · waiting for its site</template>
            </span>
            <span v-if="Object.keys(r.params).length" class="params small">
              <code v-for="(v, k) in r.params" :key="k">{{ k }}={{ v }}</code>
            </span>
          </a>
        </li>
      </ul>
    </section>

    <section v-if="showGlance" class="card glance" aria-labelledby="glance-title">
      <div class="list-head">
        <h2 id="glance-title" class="display">At a glance<template v-if="packFilter && packName(packFilter)">: {{ packName(packFilter) }}</template></h2>
        <label class="sr-only" for="glance-period">Period</label>
        <SelectMenu id="glance-period" v-model="period" class="period" :options="periodOptions" />
      </div>
      <div class="tiles">
        <StatTile
          v-for="t in glanceTiles"
          :key="t.key"
          :label="t.label"
          :value="t.value"
          :unit="t.unit"
          :delta="t.delta"
          :period="t.delta === undefined ? undefined : `the ${period} days before`"
          :good-when="t.goodWhen"
          v-bind="t.formatDelta ? { formatDelta: t.formatDelta } : {}"
          :trend="t.trend"
          :trend-labels="t.trendLabels"
        />
      </div>
      <BarChart :items="glanceBars" :series="SERIES" label="Attempts per day, by outcome" :height="200" />
    </section>

    <section class="card" aria-labelledby="runs-title">
      <div class="list-head">
        <h2 id="runs-title" class="display">Earlier runs</h2>
        <div class="filters">
          <label class="sr-only" for="f-search">Search runs</label>
          <TextField id="f-search" v-model="search" type="search" class="search" placeholder="Search: label, id, lang=de…" />
          <label class="sr-only" for="f-pack">Pack</label>
          <SelectMenu id="f-pack" v-model="packFilter" :options="packOptions" />
          <label class="sr-only" for="f-status">Status</label>
          <SelectMenu id="f-status" v-model="statusFilter" :options="statusOptions" />
        </div>
      </div>

      <div v-if="loading" class="skeleton-rows" aria-busy="true" aria-label="Loading runs">
        <div v-for="w in [52, 38, 61, 45, 30]" :key="w" class="skeleton-row">
          <SkeletonBlock :width="`${w}%`" />
          <SkeletonBlock shape="block" width="64px" height="20px" />
          <SkeletonBlock width="80px" />
        </div>
      </div>
      <table v-else-if="runs.length" class="runs">
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th>Results</th>
            <th>Started</th>
            <th>Took</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id">
            <td class="c-run">
              <a :href="`#/runs/${r.id}`" class="rname">{{ r.packName }}</a>
              <span v-if="r.label" class="rlabel">{{ r.label }}</span>
              <span class="muted num small">{{ r.id }}</span>
              <span v-if="Object.keys(r.params).length" class="params small">
                <code v-for="(v, k) in r.params" :key="k">{{ k }}={{ v }}</code>
              </span>
            </td>
            <td class="c-status"><StatusChip :status="r.status" /></td>
            <td class="c-res">
              <span class="tally" aria-hidden="true">
                <span v-if="r.counts.passed" class="seg ok" :style="{ flexGrow: r.counts.passed }" />
                <span v-if="r.counts.failed" class="seg bad" :style="{ flexGrow: r.counts.failed }" />
                <span v-if="r.counts.broken" class="seg warn" :style="{ flexGrow: r.counts.broken }" />
                <span v-if="rest(r) > 0" class="seg rest" :style="{ flexGrow: rest(r) }" />
              </span>
              <span class="small">{{ countsText(r.counts) }}</span>
            </td>
            <td class="c-when muted small"><span v-tip="when(r.startedAt ?? r.createdAt)">{{ ago(r.startedAt ?? r.createdAt, now) }}</span> · {{ r.startedBy }}</td>
            <td class="c-took muted small num">{{ duration(runDuration(r)) || "–" }}</td>
            <td class="c-act">
              <MenuButton :items="rowMenu(r)" :label="`Actions for run ${r.id}`" @select="onRowMenu(r, $event)">
                <template #button><Ellipsis :size="16" /></template>
              </MenuButton>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-else-if="!loadError">
        <EmptyState v-if="filtered" :icon="SearchX" heading="No runs match" compact :level="3">
          <p>{{ search.trim() ? `Nothing matches "${search.trim()}"${packFilter || statusFilter ? " with these filters" : ""}.` : "No runs have this pack and status." }}</p>
          <template #actions>
            <button class="btn" @click="(packFilter = ''), (statusFilter = ''), (search = '')">Clear the filters</button>
          </template>
        </EmptyState>
        <EmptyState v-else-if="packs.length === 0" :icon="Package" heading="No packs yet" compact :level="3">
          <p>Runs start from a test pack: a folder with a pack file and its tests. Add one first.</p>
          <template #actions>
            <a class="btn primary" href="#/packs?browse=add">Add a pack</a>
          </template>
        </EmptyState>
        <EmptyState v-else :icon="Play" heading="Nothing has run yet" compact :level="3">
          <p>Start a run to watch it live here. Runs keep their videos, screenshots and logs.</p>
          <template #actions>
            <a class="btn primary" href="#/new">Start a run</a>
          </template>
        </EmptyState>
      </template>
      <div v-if="more" class="more"><button class="btn" @click="loadMore">Show older runs</button></div>
    </section>

    <ModalDialog v-model="deleteOpen" heading="Delete this run?">
      <p v-if="deleting">
        <strong>{{ deleting.packName }}</strong> <span class="num">{{ deleting.id }}</span> ({{ countsText(deleting.counts) }}). Its results, screenshots, videos and traces are removed from the data folder. This can't be undone.
      </p>
      <p v-if="deleting && packName(deleting.packId) === undefined" class="muted small">Its pack is no longer added.</p>
      <p v-if="deleteError" class="error" role="alert">{{ deleteError }}</p>
      <template #actions>
        <button class="btn" :disabled="busy" @click="deleting = null">Cancel</button>
        <button class="btn danger" :disabled="busy" @click="confirmDelete">{{ busy ? "Deleting…" : "Delete run" }}</button>
      </template>
    </ModalDialog>
  </main>
</template>

<style scoped>
.active {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-3);
}
.arun {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  text-decoration: none;
}
.arun:hover {
  border-color: var(--accent);
}
.arun > :nth-child(n + 3) {
  grid-column: 1 / -1;
}
.aname {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.params {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.params code {
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--raised);
  color: var(--muted);
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.period {
  flex: none;
  width: 170px;
}
.list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.list-head h2 {
  margin: 0;
  font-size: 15px;
}
.filters {
  display: flex;
  gap: var(--space-2);
}
.filters > :deep(*) {
  min-width: 160px;
}
.filters > .search {
  min-width: 240px;
}
.runs {
  width: 100%;
  border-collapse: collapse;
}
.runs th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  font-size: 12px;
  padding: 4px 12px 6px 0;
}
.runs td {
  padding: 8px 12px 8px 0;
  border-top: var(--border-width) solid var(--line);
  vertical-align: middle;
}
.c-run {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}
.rname {
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
}
.rlabel {
  margin-right: 2px;
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 500;
}
.rname:hover {
  color: var(--accent-text);
  text-decoration: underline;
}
.c-res {
  min-width: 180px;
}
.tally {
  display: flex;
  gap: 2px;
  width: 140px;
  height: 6px;
  margin-bottom: 4px;
}
.seg {
  border-radius: 2px;
}
.seg.ok {
  background: var(--ok);
}
.seg.bad {
  background: var(--bad);
}
.seg.warn {
  background: var(--warn);
}
.seg.rest {
  background: var(--line);
}
.c-act {
  width: 1%;
  text-align: right;
  padding-right: 0;
}
.skeleton-rows {
  display: grid;
}
.skeleton-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--line);
}
.more {
  margin-top: var(--space-3);
  display: flex;
  justify-content: center;
}
@media (max-width: 720px) {
  .filters {
    width: 100%;
    flex-wrap: wrap;
  }
  .filters > :deep(*) {
    flex: 1;
    min-width: 0;
  }
  .filters > .search {
    flex-basis: 100%;
  }
  .runs thead {
    display: none;
  }
  .runs tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 8px;
    padding: 10px 0;
    border-top: var(--border-width) solid var(--line);
  }
  .runs td {
    border: 0;
    padding: 0;
  }
  .c-run {
    grid-column: 1;
  }
  .c-status {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
  }
  .c-res,
  .c-when {
    grid-column: 1;
  }
  .c-took {
    display: none;
  }
  .c-act {
    grid-column: 2;
    grid-row: 2 / span 2;
    align-self: center;
  }
}
</style>
