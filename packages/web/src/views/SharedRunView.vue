<script setup lang="ts">
// One run, read-only, for someone without an account: through a share link (#/s/<token>) or
// from the public dashboard (#/status/<id>). It shows what the run recorded (results, errors,
// screenshots, videos, files) and nothing to change it; everything comes from `api`, which
// answers only for this run (docs/plans/self-hosting.md, section 4).
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ArrowLeft, ChevronDown, ChevronRight, Download, Link } from "../icons";
import { getJson, type Artifact, type ResultDocument, type SharedRun } from "../api";
import { attemptOrder, shotGroups } from "../attempt";
import { countsText, duration, fileSize, runDuration, when } from "../format";
import EmptyState from "../components/EmptyState.vue";
import ImageViewer from "../components/ImageViewer.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import StatusChip from "../components/StatusChip.vue";
import VideoPlayer from "../components/VideoPlayer.vue";
import { resetHead, setTitle } from "../pagehead";

const props = defineProps<{
  /** Where the run is read from: `/api/v1/shared/<token>` or `/api/v1/public/runs/<id>`. */
  api: string;
  /** A link back (the public dashboard), when there is one. */
  back?: string | null;
}>();

const run = ref<SharedRun | null>(null);
const error = ref<string | null>(null);
const open = ref<Record<string, ResultDocument | "loading" | string>>({});
let timer: ReturnType<typeof setTimeout> | null = null;

async function load() {
  const res = await getJson<SharedRun>(props.api);
  if (!res.ok) {
    error.value = res.error.code === "not_shared" || res.error.code === "http_404" ? "This link doesn't work any more. It was taken back, it expired, or its run was deleted." : res.error.message;
    return;
  }
  error.value = null;
  run.value = res.data;
  setTitle(`${res.data.packName}${res.data.label ? ` · ${res.data.label}` : ""}`);
  // A run still going is asked about again now and then; a finished one stays as it is.
  if (timer) clearTimeout(timer);
  if (res.data.running || res.data.status === "queued") timer = setTimeout(() => void load(), 10_000);
}
watch(
  () => props.api,
  () => {
    run.value = null;
    open.value = {};
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  resetHead();
});

/** Attempts in the run page's order: each planned one, then those that ran inside it. */
const attempts = computed(() => {
  const r = run.value;
  if (!r) return [];
  const order = attemptOrder(r);
  const byId = new Map(r.attempts.map((a) => [a.id, a]));
  const rest = r.attempts.filter((a) => !order.includes(a.id));
  return [...order.map((id) => byId.get(id)).filter((a) => a !== undefined), ...rest];
});
const took = computed(() => (run.value ? runDuration(run.value) : null));

// Each attempt opens in place; its document loads the first time.
async function toggle(id: string) {
  if (open.value[id] !== undefined) {
    const next = { ...open.value };
    delete next[id];
    open.value = next;
    return;
  }
  open.value = { ...open.value, [id]: "loading" };
  const res = await getJson<ResultDocument>(`${props.api}/attempts/${id}`);
  open.value = { ...open.value, [id]: res.ok ? res.data : res.error.message };
}
const docOf = (id: string): ResultDocument | null => {
  const d = open.value[id];
  return d && typeof d === "object" ? d : null;
};
const shots = (d: ResultDocument) => shotGroups(d.artifacts).flatMap((g) => g.shots);
const videos = (d: ResultDocument) => d.artifacts.filter((a) => a.kind === "video");
const files = (d: ResultDocument) => d.artifacts.filter((a) => !["shot", "mark", "video", "text"].includes(a.kind));

const viewer = ref<{ images: Artifact[]; index: number | null }>({ images: [], index: null });
const showShot = (d: ResultDocument, a: Artifact) => {
  const images = shots(d);
  viewer.value = { images, index: images.indexOf(a) };
};
const viewerIndex = computed({
  get: () => viewer.value.index,
  set: (i: number | null) => (viewer.value = { ...viewer.value, index: i }),
});
const errorTitle = (kind: string) => (kind === "assertion" ? "A check failed" : kind === "timeout" ? "Timed out" : kind === "stopped" ? "Stopped" : kind === "skipped" ? "Skipped" : "The harness couldn't go on");
</script>

<template>
  <main class="page shared">
    <p v-if="back" class="crumb">
      <a :href="back"><ArrowLeft :size="14" /> Status</a>
    </p>
    <section v-if="error" class="card">
      <EmptyState :icon="Link" heading="This run isn't shared">{{ error }}</EmptyState>
    </section>
    <PageSkeleton v-else-if="!run" label="Loading the run" :cards="2" />
    <template v-else>
      <header class="page-head">
        <div>
          <h1 class="display">{{ run.packName }}<span v-if="run.label" class="muted lbl"> · {{ run.label }}</span></h1>
          <p class="muted">
            <StatusChip :status="run.status" />
            · {{ countsText(run.counts) }}
            <template v-if="run.startedAt"> · started {{ when(run.startedAt) }}</template>
            <template v-if="took !== null && !run.running"> · took {{ duration(took) }}</template>
            <template v-for="(v, k) in run.params" :key="k"> · {{ k }}={{ v }}</template>
          </p>
          <p v-if="Object.keys(run.info).length" class="facts small" aria-label="Run facts">
            <span v-for="(v, k) in run.info" :key="k" class="fact"><span class="muted">{{ k }}</span> {{ v }}</span>
          </p>
        </div>
        <span class="ro muted small">Read-only</span>
      </header>
      <p v-if="run.running" class="banner" role="status"><strong>Still running.</strong> This page updates by itself.</p>
      <p v-if="run.error" class="error">{{ run.error }}</p>

      <section v-if="run.runVideos.length" class="card" aria-labelledby="sh-video">
        <h2 id="sh-video" class="display">Video of the run</h2>
        <div class="videos">
          <figure v-for="(v, i) in run.runVideos" :key="v.url">
            <VideoPlayer :src="v.url" :label="`Run video, part ${i + 1}`" />
            <figcaption class="muted small">Part {{ i + 1 }} · {{ fileSize(v.size) }} · <a :href="v.url" download>Download</a></figcaption>
          </figure>
        </div>
      </section>

      <section class="card" aria-labelledby="sh-results">
        <h2 id="sh-results" class="display">Results</h2>
        <EmptyState v-if="!attempts.length" compact :level="3" heading="Nothing has run yet">The results show here as the tests finish.</EmptyState>
        <ul v-else class="attempts">
          <li v-for="a in attempts" :key="a.id" :class="{ inside: a.parentId }">
            <button type="button" class="row" :aria-expanded="open[a.id] !== undefined" @click="toggle(a.id)">
              <component :is="open[a.id] !== undefined ? ChevronDown : ChevronRight" :size="15" class="chev" />
              <code>{{ a.testId }}</code>
              <span class="t">{{ a.title !== a.testId ? a.title : "" }}<span v-if="a.of > 1" class="muted n">{{ a.number }}/{{ a.of }}</span><span v-if="a.try > 1" class="muted n">try {{ a.try }}</span></span>
              <span v-if="a.durationMs !== null" class="muted small num">{{ duration(a.durationMs) }}</span>
              <StatusChip :status="a.status" />
            </button>
            <div v-if="open[a.id] === 'loading'" class="doc muted small">Loading…</div>
            <div v-else-if="typeof open[a.id] === 'string'" class="doc error small">{{ open[a.id] }}</div>
            <div v-else-if="docOf(a.id)" class="doc">
              <template v-for="d in [docOf(a.id)!]" :key="d.attemptId">
                <div v-if="d.error" class="problem" :class="{ calm: d.error.kind === 'skipped' }">
                  <strong>{{ errorTitle(d.error.kind) }}</strong>
                  <pre>{{ d.error.message }}</pre>
                </div>
                <ul v-if="d.notes.length" class="notes small">
                  <li v-for="(n, i) in d.notes" :key="i">{{ n }}</li>
                </ul>
                <p v-if="Object.keys(d.metrics).length" class="facts small">
                  <span v-for="(m, k) in d.metrics" :key="k" class="fact"><span class="muted">{{ k }}</span> {{ m.value }}{{ m.unit ? ` ${m.unit}` : "" }}</span>
                </p>
                <div v-if="shots(d).length" class="gallery">
                  <button v-for="s in shots(d)" :key="s.url" type="button" class="thumb" @click="showShot(d, s)">
                    <img :src="s.url" :alt="s.name" loading="lazy" />
                    <span class="cap">{{ s.name }}</span>
                  </button>
                </div>
                <figure v-for="v in videos(d)" :key="v.url" class="video">
                  <VideoPlayer :src="v.url" :label="v.name" />
                  <figcaption class="muted small">{{ v.name }} · {{ fileSize(v.size) }}</figcaption>
                </figure>
                <ul v-if="files(d).length" class="files small">
                  <li v-for="f in files(d)" :key="f.url">
                    <a :href="f.url" download><Download :size="14" /> {{ f.name }}</a>
                    <span class="muted">{{ f.kind }} · {{ fileSize(f.size) }}</span>
                  </li>
                </ul>
                <p v-if="!d.error && !d.notes.length && !d.artifacts.length" class="muted small">This attempt saved no screenshots or files.</p>
              </template>
            </div>
          </li>
        </ul>
      </section>
      <p class="muted small foot">Shared from Watchwright. {{ run.traces ? "Traces and network files are included." : "Traces and network files aren't shared." }}</p>
    </template>
    <ImageViewer v-model="viewerIndex" :images="viewer.images" label="Screenshots" />
  </main>
</template>

<style scoped>
.lbl {
  font-weight: normal;
}
.ro {
  padding: 2px var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: var(--space-1) 0 0;
}
.banner {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--accent-soft);
}
.videos {
  display: grid;
  gap: var(--space-3);
}
figure {
  margin: 0;
  display: grid;
  gap: var(--space-1);
}
.attempts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  margin: 0;
  padding: 0;
  list-style: none;
}
.attempts > li + li {
  border-top: var(--border-width) solid var(--line);
}
.inside .row {
  padding-left: var(--space-6);
}
.row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 40px;
  padding: var(--space-2) var(--space-1);
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: var(--hover);
}
.chev {
  flex: none;
  color: var(--muted);
}
.t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.n {
  margin-left: var(--space-2);
}
.doc {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-2) var(--space-1) var(--space-4) calc(var(--space-6) + var(--space-1));
}
.problem {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--bad);
  background: color-mix(in srgb, var(--bad) 7%, var(--surface));
  border-radius: var(--radius-sm);
}
.problem.calm {
  border-left-color: var(--muted);
  background: var(--hover);
}
.problem pre {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 12px;
}
.notes {
  margin: 0;
  padding-left: var(--space-4);
}
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-2);
}
.thumb {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  overflow: hidden;
  cursor: zoom-in;
}
.thumb img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  object-position: top;
  display: block;
}
.cap {
  padding: 0 var(--space-2) var(--space-1);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.files {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.files li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.files a {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.foot {
  margin: 0;
  text-align: center;
}
@media (max-width: 640px) {
  .row .num {
    display: none;
  }
  .doc {
    padding-left: var(--space-1);
  }
  .gallery {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
