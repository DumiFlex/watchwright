<script setup lang="ts">
import { ArrowDown, ArrowLeft, ArrowUp, Ban, Undo2 } from "../icons";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type RunDetail, type WwEvent } from "../api";
import { LiveConnection, type LiveState } from "../live";
import LiveViewer from "../components/LiveViewer.vue";
import ModalDialog from "../components/ModalDialog.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusChip from "../components/StatusChip.vue";
import TextArea from "../components/TextArea.vue";
import { countsText, duration } from "../format";
import { href } from "../router";
import { canMove as canMoveRow, movable as movableRow } from "../queue";
import { vTip } from "../tooltip";

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
// Which test an attempt belongs to, so log lines can be filtered by test.
const attemptTests = new Map<string, string>();
watch(run, (r) => r?.attempts.forEach((a) => attemptTests.set(a.id, a.testId)));
function onEvent(e: WwEvent) {
  if (e.runId !== props.id) return;
  const d = e.data;
  switch (e.type) {
    case "attempt.log":
    case "run.log":
      log.value.push({ seq: e.seq, time: String(d.time ?? e.time), level: String(d.level ?? "info"), message: String(d.message ?? ""), test: (e.attemptId && attemptTests.get(e.attemptId)) || null });
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
      if (e.attemptId) attemptTests.set(e.attemptId, String(d.testId));
      log.value.push({ seq: e.seq, time: e.time, level: "info", message: `Started ${d.testId} ${titles.value.get(String(d.testId)) ?? ""} (attempt ${d.number} of ${d.of}${Number(d.try) > 1 ? `, try ${d.try}` : ""})`, test: String(d.testId) });
      scheduleLoad();
      break;
    case "attempt.finished":
      log.value.push({ seq: e.seq, time: e.time, level: d.status === "passed" ? "info" : "warn", message: `${d.testId} ${d.status}${d.error ? `: ${String(d.error).split("\n")[0]}` : ""}`, test: String(d.testId) });
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

function openAttempt(attemptId: string | null) {
  if (attemptId) window.location.hash = href({ name: "attempt", runId: props.id, attemptId });
}

// Queue edits: attempts that haven't started can be skipped, tests that haven't started moved.
type PlanRow = RunDetail["plan"][number];
const editable = (p: PlanRow) => active.value && p.status === "pending";
const movable = (i: number) => movableRow(run.value?.plan ?? [], i);
const canMove = (i: number, direction: -1 | 1) => canMoveRow(run.value?.plan ?? [], i, direction);
const queueAct = (path: "skip" | "move", body: Record<string, unknown>) => act(`queue/${path}`, body);

/** How long an attempt took, or has taken so far. */
function elapsed(p: PlanRow): string | null {
  const a = p.attemptId ? run.value?.attempts.find((x) => x.id === p.attemptId) : undefined;
  if (!a) return null;
  if (a.durationMs !== null) return duration(a.durationMs);
  return a.status === "running" ? duration(now.value - Date.parse(a.startedAt)) : null;
}

// Mark: saves the live view's newest frame to the running attempt, with a note.
const markOpen = ref(false);
const markNote = ref("");
const markSaved = ref<string | null>(null);
async function saveMark() {
  actionError.value = null;
  busy.value = true;
  const res = await sendJson<{ attemptId: string; artifact: { name: string; path: string } }>(`/api/v1/runs/${props.id}/mark`, { note: markNote.value.trim() });
  busy.value = false;
  markOpen.value = false;
  if (!res.ok) {
    actionError.value = res.error.message;
    return;
  }
  markSaved.value = `Marked ${res.data.artifact.path.split("/").pop()}${markNote.value.trim() ? `: ${markNote.value.trim()}` : ""}`;
  markNote.value = "";
}

// Log filters.
const logLevel = ref<"all" | "problems">("all");
const logTest = ref("");
const levelOptions = [
  { value: "all" as const, label: "Every line" },
  { value: "problems" as const, label: "Warnings and errors" },
];
const testOptions = computed(() => [{ value: "", label: "All tests" }, ...[...titles.value].map(([id, t]) => ({ value: id, label: t && t !== id ? `${id} · ${t}` : id }))]);
const shownLog = computed(() =>
  log.value.filter((l) => (logLevel.value === "all" || l.level !== "info") && (!logTest.value || l.test === logTest.value)).reverse(),
);

let conn: LiveConnection | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
function connect() {
  conn?.close();
  log.value = [];
  markSaved.value = null;
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
  <main class="page" :class="{ wide: active }">
    <p class="crumb"><a href="#/"><ArrowLeft :size="15" />Runs</a></p>
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
            <button v-tip="'Save the live view to this attempt, with a note'" class="btn" :disabled="busy || !live?.attemptId" @click="markOpen = true">Mark</button>
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
      <p v-if="markSaved" class="muted small" role="status">{{ markSaved }}</p>

      <div v-if="live" class="banner" :class="{ warn: live.state !== 'running' }" role="status">
        <template v-if="pausedBroken">
          <strong>{{ live.testId }} broke.</strong> Fix the test file and it retries by itself, or press Retry or Skip. Skips by itself in {{ countdown }}.
        </template>
        <template v-else-if="pausedManual"><strong>Paused</strong> during {{ live.testId ?? "the run" }}{{ step ? `, at ${step}` : "" }}.</template>
        <template v-else-if="live.state === 'pausing'"><strong>Pausing at the next step…</strong></template>
        <template v-else-if="live.stopping === 'after'"><strong>Stopping after this test.</strong> {{ testTitle }}</template>
        <template v-else>
          <strong>{{ live.testId ?? "Setting up" }}</strong> {{ testTitle && testTitle !== live.testId ? testTitle : "" }}
          <span v-if="step" class="muted"> · {{ step }}</span>
        </template>
      </div>

      <div class="grid" :class="{ done: !active }">
        <section v-if="active || run.status === 'queued'" class="card viewer-card" aria-label="Live view">
          <LiveViewer ref="viewer" :pages="pages" :active-page-id="activePageId" :running="active" />
          <p v-if="liveState !== 'open'" class="muted small">Live connection: {{ liveState === "connecting" ? "connecting…" : "lost, retrying" }}</p>
        </section>

        <section class="card" aria-labelledby="queue-title">
          <h2 id="queue-title" class="display">Queue <span class="muted small">{{ run.counts.passed }} passed · {{ run.counts.failed }} failed · {{ run.counts.broken }} broken · {{ run.counts.planned }} planned</span></h2>
          <ol class="queue">
            <li
              v-for="(p, i) in run.plan"
              :key="`${p.testId}#${p.number}`"
              :class="{ cur: live?.testId === p.testId && p.status === 'running', skip: p.skip && p.status === 'pending' }"
            >
              <div class="qline">
                <button class="qrow" :disabled="!p.attemptId" @click="openAttempt(p.attemptId)">
                  <code>{{ p.testId }}</code>
                  <span class="qt">{{ p.title !== p.testId ? p.title : "" }}<span v-if="p.of > 1" class="muted n">{{ p.number }}/{{ p.of }}</span></span>
                  <span v-if="elapsed(p)" class="muted small num">{{ elapsed(p) }}</span>
                  <StatusChip :status="p.skip && p.status === 'pending' ? 'skipped' : p.status" />
                </button>
                <span v-if="editable(p)" class="qedit">
                  <template v-if="movable(i)">
                    <button v-tip="'Move up'" class="ibtn" :aria-label="`Move ${p.testId} up`" :disabled="busy || !canMove(i, -1)" @click="queueAct('move', { testId: p.testId, direction: 'up' })">
                      <ArrowUp :size="15" />
                    </button>
                    <button v-tip="'Move down'" class="ibtn" :aria-label="`Move ${p.testId} down`" :disabled="busy || !canMove(i, 1)" @click="queueAct('move', { testId: p.testId, direction: 'down' })">
                      <ArrowDown :size="15" />
                    </button>
                  </template>
                  <button
                    v-tip="p.skip ? 'Run this attempt after all' : 'Skip this attempt'"
                    class="ibtn"
                    :aria-label="`${p.skip ? 'Run' : 'Skip'} attempt ${p.number} of ${p.testId}`"
                    :aria-pressed="!!p.skip"
                    :disabled="busy"
                    @click="queueAct('skip', { testId: p.testId, number: p.number, undo: !!p.skip })"
                  >
                    <Undo2 v-if="p.skip" :size="15" />
                    <Ban v-else :size="15" />
                  </button>
                </span>
              </div>
              <ul v-if="p.children" class="kids">
                <li v-for="a in run.attempts.filter((x) => x.parentId && x.parentId === p.attemptId)" :key="a.id">
                  <button class="qrow" @click="openAttempt(a.id)"><code>{{ a.testId }}</code><span class="qt">{{ a.title }}</span><StatusChip :status="a.status" /></button>
                </li>
              </ul>
            </li>
          </ol>
        </section>
      </div>

      <section class="card" aria-labelledby="log-title">
        <div class="loghead">
          <h2 id="log-title" class="display">Log</h2>
          <div class="logfilters">
            <label for="log-level" class="sr-only">Which lines</label>
            <SelectMenu id="log-level" v-model="logLevel" :options="levelOptions" />
            <label for="log-test" class="sr-only">Which test</label>
            <SelectMenu id="log-test" v-model="logTest" :options="testOptions" />
          </div>
        </div>
        <ol v-if="shownLog.length" class="log">
          <li v-for="l in shownLog" :key="l.seq" :class="l.level"><time>{{ time(l.time) }}</time> {{ l.message }}</li>
        </ol>
        <p v-else class="muted">{{ log.length ? "No lines match." : "Nothing logged yet." }}</p>
        <p v-if="run.attempts.length" class="muted small">
          {{ run.attempts.filter((a) => !a.parentId).length }} {{ run.attempts.filter((a) => !a.parentId).length === 1 ? "attempt" : "attempts" }} ·
          {{ duration(run.attempts.reduce((s, a) => s + (a.durationMs ?? 0), 0)) }} of test time
        </p>
      </section>
      <ModalDialog v-model="markOpen" heading="Mark this moment">
        <p class="muted small">Saves what the live view shows now to the running attempt{{ live?.testId ? ` (${live.testId})` : "" }}, with your note. It shows with the attempt's screenshots.</p>
        <TextArea v-model="markNote" :rows="3" placeholder="What you saw (optional)" />
        <template #actions>
          <button class="btn" :disabled="busy" @click="markOpen = false">Cancel</button>
          <button class="btn primary" :disabled="busy" @click="saveMark">{{ busy ? "Saving…" : "Save mark" }}</button>
        </template>
      </ModalDialog>
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
.page.wide {
  max-width: 1600px;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
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
.qline {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius);
}
.qline:hover {
  background: var(--hover);
}
.qedit {
  display: flex;
  gap: 2px;
  padding-right: 4px;
}
.ibtn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.ibtn:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.ibtn:disabled {
  opacity: 0.35;
  cursor: default;
}
.ibtn[aria-pressed="true"] {
  color: var(--accent);
}
.skip .qt,
.skip code {
  text-decoration: line-through;
  color: var(--muted);
}
.qrow {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
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
.kids .qrow {
  grid-template-columns: auto 1fr auto;
}
.kids .qrow:hover {
  background: var(--hover);
}
.cur > .qline {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
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
.loghead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.loghead h2 {
  margin: 0;
}
.logfilters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.logfilters > :not(label) {
  width: 200px;
}
@media (max-width: 640px) {
  .logfilters {
    width: 100%;
    flex-wrap: nowrap;
  }
  .logfilters > :not(label) {
    flex: 1 1 0;
    width: auto;
    min-width: 0;
  }
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
