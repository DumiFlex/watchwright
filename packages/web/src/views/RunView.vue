<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type ResultDocument, type RunDetail, type WwEvent } from "../api";
import { LiveConnection, type LiveState } from "../live";
import LiveViewer from "../components/LiveViewer.vue";
import ModalDialog from "../components/ModalDialog.vue";
import StatusChip from "../components/StatusChip.vue";
import { countsText, duration } from "../format";

const props = defineProps<{ id: string }>();

const run = ref<RunDetail | null>(null);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
const busy = ref(false);
const liveState = ref<LiveState>("connecting");
const viewer = ref<InstanceType<typeof LiveViewer> | null>(null);
const log = ref<{ seq: number; time: string; level: string; message: string; test: string | null }[]>([]);
const pages = ref<{ id: string; url: string }[]>([]);
const activePageId = ref<string | null>(null);
const step = ref<string | null>(null);
const selected = ref<string | null>(null);
const result = ref<ResultDocument | null>(null);
const now = ref(Date.now());

const active = computed(() => run.value !== null && ["running", "pausing", "paused"].includes(run.value.status));
const live = computed(() => run.value?.live ?? null);
const pausedBroken = computed(() => live.value?.state === "paused" && live.value.pauseReason === "broken");
const pausedManual = computed(() => live.value?.state === "paused" && live.value.pauseReason === "manual");
const canResumeRun = computed(() => run.value !== null && ["interrupted", "stopped", "failed_to_start"].includes(run.value.status));
const canRedo = computed(() => run.value !== null && !active.value && run.value.status !== "queued" && run.value.counts.broken > 0);
const countdown = computed(() => {
  const d = live.value?.deadline;
  if (!d) return null;
  const s = Math.max(0, Math.round((Date.parse(d) - now.value) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});
const testTitle = computed(() => {
  const id = live.value?.testId;
  return id ? (run.value?.plan.find((p) => p.testId === id)?.title ?? id) : null;
});

async function load() {
  const res = await getJson<RunDetail>(`/api/v1/runs/${props.id}`);
  if (!res.ok) {
    error.value = res.error.message;
    return;
  }
  error.value = null;
  run.value = res.data;
  if (res.data.live) {
    pages.value = res.data.live.pages;
    activePageId.value = res.data.live.activePageId;
    step.value = res.data.live.step;
  } else {
    pages.value = [];
    step.value = null;
  }
}

let refresh: ReturnType<typeof setTimeout> | null = null;
function scheduleLoad() {
  if (refresh) return;
  refresh = setTimeout(() => {
    refresh = null;
    void load();
  }, 150);
}

const titles = computed(() => new Map((run.value?.plan ?? []).map((p) => [p.testId, p.title])));
function onEvent(e: WwEvent) {
  if (e.runId !== props.id) return;
  const d = e.data;
  switch (e.type) {
    case "attempt.log":
    case "run.log":
      log.value.push({ seq: e.seq, time: String(d.time ?? e.time), level: String(d.level ?? "info"), message: String(d.message ?? ""), test: null });
      if (log.value.length > 500) log.value.splice(0, log.value.length - 500);
      break;
    case "attempt.step":
      step.value = (d.title as string | null) ?? null;
      break;
    case "page.opened":
      if (!pages.value.some((p) => p.id === d.pageId)) pages.value.push({ id: String(d.pageId), url: String(d.url ?? "") });
      break;
    case "page.navigated": {
      const p = pages.value.find((x) => x.id === d.pageId);
      if (p) p.url = String(d.url ?? "");
      break;
    }
    case "page.closed":
      pages.value = pages.value.filter((p) => p.id !== d.pageId);
      break;
    case "page.active":
      activePageId.value = String(d.pageId);
      break;
    case "attempt.started":
      step.value = null;
      log.value.push({ seq: e.seq, time: e.time, level: "info", message: `▶ ${d.testId} ${titles.value.get(String(d.testId)) ?? ""} (attempt ${d.number} of ${d.of}${Number(d.try) > 1 ? `, try ${d.try}` : ""})`, test: String(d.testId) });
      scheduleLoad();
      break;
    case "attempt.finished":
      log.value.push({ seq: e.seq, time: e.time, level: d.status === "passed" ? "info" : "warn", message: `■ ${d.testId} ${d.status}${d.error ? `: ${String(d.error).split("\n")[0]}` : ""}`, test: String(d.testId) });
      scheduleLoad();
      break;
    case "video.unavailable":
      log.value.push({ seq: e.seq, time: e.time, level: "warn", message: String(d.message), test: null });
      break;
    default:
      if (e.type.startsWith("run.") || e.type.startsWith("pack.")) scheduleLoad();
  }
}

async function act(path: string, body: unknown = {}) {
  actionError.value = null;
  busy.value = true;
  const res = await sendJson<RunDetail>(`/api/v1/runs/${props.id}/${path}`, body);
  busy.value = false;
  if (!res.ok) actionError.value = res.error.message;
  else run.value = res.data;
}

async function openAttempt(attemptId: string | null) {
  selected.value = attemptId;
  result.value = null;
  if (!attemptId) return;
  const res = await getJson<ResultDocument>(`/api/v1/runs/${props.id}/attempts/${attemptId}`);
  if (res.ok && selected.value === attemptId) result.value = res.data;
}

let conn: LiveConnection | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
function connect() {
  conn?.close();
  log.value = [];
  conn = new LiveConnection(
    { runId: props.id, frames: true, after: 0 },
    { onState: (s) => (liveState.value = s), onEvent, onFrame: (h, jpeg) => void viewer.value?.push(h, jpeg) },
  );
}
onMounted(() => {
  void load();
  connect();
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
watch(
  () => props.id,
  () => {
    run.value = null;
    void load();
    connect();
  },
);
onBeforeUnmount(() => {
  conn?.close();
  if (clock) clearInterval(clock);
  if (refresh) clearTimeout(refresh);
});


// Delete, behind a confirm dialog; afterwards back to the runs list.
const confirmDelete = ref(false);
async function remove() {
  actionError.value = null;
  busy.value = true;
  const res = await sendJson(`/api/v1/runs/${props.id}`, {}, "DELETE");
  busy.value = false;
  confirmDelete.value = false;
  if (!res.ok) actionError.value = res.error.message;
  else window.location.hash = "#/";
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString();
}
</script>

<template>
  <main class="page">
    <p class="crumb"><a href="#/">← Runs</a></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="run">
      <header class="head">
        <div class="title">
          <h1 class="display">{{ run.packName }} <span class="muted rid">{{ run.id }}</span></h1>
          <p class="muted">
            <StatusChip :status="run.status" />
            <span v-if="run.mode !== 'normal'">&nbsp;{{ run.mode === "redo" ? "redoing broken tests" : "resumed" }}</span>
            · started by {{ run.startedBy }}
            <template v-for="(v, k) in run.params" :key="k"> · {{ k }}={{ v }}</template>
          </p>
        </div>
        <div class="controls">
          <template v-if="active">
            <button v-if="!live || live.state === 'running'" class="btn" :disabled="busy || !!live?.stopping" @click="act('pause')">Pause</button>
            <button v-if="live?.state === 'pausing' || pausedManual" class="btn primary" :disabled="busy" @click="act('resume')">Resume</button>
            <button v-if="pausedBroken" class="btn primary" :disabled="busy" @click="act('retry')">Retry</button>
            <button v-if="pausedBroken" class="btn" :disabled="busy" @click="act('skip')">Skip</button>
            <button class="btn" :disabled="busy || !!live?.stopping" @click="act('stop', { when: 'after' })">Stop after this test</button>
            <button class="btn danger" :disabled="busy || live?.stopping === 'now'" @click="act('stop', { when: 'now' })">Stop now</button>
          </template>
          <button v-if="run.status === 'queued'" class="btn danger" :disabled="busy" @click="act('stop', { when: 'now' })">Cancel</button>
          <button v-if="canResumeRun" class="btn primary" :disabled="busy" @click="act('resume')">Resume run</button>
          <button v-if="canRedo" class="btn" :disabled="busy" @click="act('redo-broken')">Redo broken</button>
          <a v-if="!active" class="btn" :href="`#/new?pack=${run.packId}&from=${run.id}`">New run like this</a>
          <button v-if="!active && run.status !== 'queued'" class="btn danger" :disabled="busy" @click="confirmDelete = true">Delete</button>
        </div>
      </header>
      <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
      <p v-if="run.error" class="error">{{ run.error }}</p>

      <div v-if="live" class="banner" :class="{ warn: live.state !== 'running' }" role="status">
        <template v-if="pausedBroken">
          <strong>{{ live.testId }} broke.</strong> Fix the test file and it retries by itself, or press Retry or Skip. Skips by itself in {{ countdown }}.
        </template>
        <template v-else-if="pausedManual"><strong>Paused</strong> during {{ live.testId ?? "the run" }}{{ step ? ` › ${step}` : "" }}.</template>
        <template v-else-if="live.state === 'pausing'"><strong>Pausing at the next step…</strong></template>
        <template v-else-if="live.stopping === 'after'"><strong>Stopping after this test.</strong> {{ testTitle }}</template>
        <template v-else>
          <strong>{{ live.testId ?? "Setting up" }}</strong> {{ testTitle && testTitle !== live.testId ? testTitle : "" }}
          <span v-if="step" class="muted"> › {{ step }}</span>
        </template>
      </div>

      <div class="grid" :class="{ done: !active }">
        <section v-if="active || run.status === 'queued'" class="card viewer-card" aria-label="Live view">
          <LiveViewer ref="viewer" :pages="pages" :active-page-id="activePageId" :running="active" />
          <p v-if="liveState !== 'open'" class="muted small">Live connection: {{ liveState === "connecting" ? "connecting…" : "lost, retrying" }}</p>
        </section>

        <section class="card" aria-labelledby="queue-title">
          <h2 id="queue-title" class="display">Tests <span class="muted small">{{ run.counts.passed }} passed · {{ run.counts.failed }} failed · {{ run.counts.broken }} broken · {{ run.counts.planned }} planned</span></h2>
          <ol class="queue">
            <li v-for="p in run.plan" :key="`${p.testId}#${p.number}`" :class="{ cur: live?.testId === p.testId && p.status === 'running', sel: selected === p.attemptId && !!p.attemptId }">
              <button class="qrow" :disabled="!p.attemptId" @click="openAttempt(p.attemptId)">
                <code>{{ p.testId }}</code>
                <span class="qt">{{ p.title !== p.testId ? p.title : "" }}<span v-if="p.of > 1" class="muted n">{{ p.number }}/{{ p.of }}</span></span>
                <StatusChip :status="p.status" />
              </button>
              <ul v-if="p.children" class="kids">
                <li v-for="a in run.attempts.filter((x) => x.parentId && x.parentId === p.attemptId)" :key="a.id">
                  <button class="qrow" @click="openAttempt(a.id)"><code>{{ a.testId }}</code><span class="qt">{{ a.title }}</span><StatusChip :status="a.status" /></button>
                </li>
              </ul>
            </li>
          </ol>
        </section>
      </div>

      <section v-if="selected" class="card" aria-labelledby="result-title">
        <h2 id="result-title" class="display">
          Result <template v-if="result">· {{ result.test.id }} {{ result.test.title }}</template>
          <button class="btn close" @click="openAttempt(null)">Close</button>
        </h2>
        <p v-if="!result" class="muted">Loading…</p>
        <template v-else>
          <p><StatusChip :status="result.status" /> <span v-if="result.error" class="error inline">{{ result.error.message }}</span></p>
          <ul v-if="result.flags.length" class="plain">
            <li v-for="f in result.flags" :key="f.name">Flag <code>{{ f.name }}</code> ({{ f.kind }}){{ f.detail ? `: ${f.detail}` : "" }}</li>
          </ul>
          <ul v-if="result.notes.length" class="plain">
            <li v-for="(n, i) in result.notes" :key="i">{{ n }}</li>
          </ul>
          <dl v-if="Object.keys(result.metrics).length" class="facts">
            <template v-for="(m, k) in result.metrics" :key="k"><dt>{{ k }}</dt><dd>{{ m.value }} {{ m.unit ?? "" }}</dd></template>
          </dl>
          <div class="shots">
            <a v-for="a in result.artifacts.filter((x) => x.kind === 'shot')" :key="a.url" :href="a.url" target="_blank" rel="noopener">
              <img :src="a.url" :alt="a.name" loading="lazy" />
              <span>{{ a.name }}</span>
            </a>
          </div>
          <ul class="plain files">
            <li v-for="a in result.artifacts.filter((x) => x.kind !== 'shot')" :key="a.url">
              <a :href="a.url" target="_blank" rel="noopener">{{ a.name }}</a> <span class="muted small">{{ a.kind }} · {{ Math.max(1, Math.round(a.size / 1024)) }} KB</span>
            </li>
          </ul>
        </template>
      </section>

      <section class="card" aria-labelledby="log-title">
        <h2 id="log-title" class="display">Log</h2>
        <ol v-if="log.length" class="log">
          <li v-for="l in log.slice().reverse()" :key="l.seq" :class="l.level"><time>{{ time(l.time) }}</time> {{ l.message }}</li>
        </ol>
        <p v-else class="muted">Nothing logged yet.</p>
        <p v-if="run.attempts.length" class="muted small">
          {{ run.attempts.filter((a) => !a.parentId).length }} attempts ·
          {{ duration(run.attempts.reduce((s, a) => s + (a.durationMs ?? 0), 0)) }} of test time
        </p>
      </section>
      <ModalDialog v-model="confirmDelete" heading="Delete this run?">
        <p><strong>{{ run.packName }}</strong> <span class="num">{{ run.id }}</span> ({{ countsText(run.counts) }}). Its results, screenshots, videos and traces are removed from the data folder. This can't be undone.</p>
        <template #actions>
          <button class="btn" :disabled="busy" @click="confirmDelete = false">Cancel</button>
          <button class="btn danger" :disabled="busy" @click="remove">{{ busy ? "Deleting…" : "Delete run" }}</button>
        </template>
      </ModalDialog>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 16px 24px 32px;
  display: grid;
  gap: 14px;
}
.crumb {
  margin: 0;
  font-size: 14px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.head h1 {
  margin: 0;
  font-size: 20px;
}
.head p {
  margin: 4px 0 0;
}
.rid {
  font-size: 14px;
  font-weight: 400;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.banner {
  padding: 10px 14px;
  border-radius: var(--radius);
  border: var(--border-width) solid var(--line);
  background: var(--surface);
}
.banner.warn {
  border-color: var(--warn);
  background: color-mix(in srgb, var(--warn) 10%, var(--surface));
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.grid.done {
  grid-template-columns: 1fr;
}
.card {
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  padding: 14px 16px;
  min-width: 0;
}
.card h2 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 13px;
  font-weight: 400;
}
.error {
  color: var(--bad);
  margin: 0;
}
.error.inline {
  margin-left: 6px;
}
.queue,
.kids {
  list-style: none;
  margin: 0;
  padding: 0;
}
.queue {
  display: grid;
  gap: 2px;
  max-height: 60vh;
  overflow-y: auto;
}
.kids {
  margin-left: 18px;
}
.qrow {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.qrow:disabled {
  cursor: default;
}
.qrow:hover:not(:disabled) {
  background: var(--hover);
}
.cur > .qrow {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.sel > .qrow {
  outline: 1px solid var(--accent);
}
.qt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.n {
  margin-left: 6px;
}
.close {
  margin-left: auto;
  font-size: 13px;
  padding: 2px 10px;
}
.plain {
  margin: 6px 0;
  padding-left: 18px;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 16px;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
}
.shots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  margin: 10px 0;
}
.shots a {
  display: grid;
  gap: 4px;
  font-size: 13px;
  text-decoration: none;
  color: var(--muted);
}
.shots img {
  width: 100%;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
}
.log {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow-y: auto;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 12.5px;
}
.log li {
  padding: 1px 0;
  overflow-wrap: anywhere;
}
.log li.warn {
  color: var(--warn);
}
.log li.error {
  color: var(--bad);
}
.log time {
  color: var(--muted);
  margin-right: 6px;
}
@media (max-width: 860px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .page {
    padding: 12px 16px 24px;
  }
}
</style>
