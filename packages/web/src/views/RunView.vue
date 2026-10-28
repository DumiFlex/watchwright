<script setup lang="ts">
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Ban, Keyboard, Pencil, Plus, Repeat, Undo2 } from "../icons";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type ChangeSide, type Criterion, type Pack, type Review, type RunChanges, type RunDetail, type WwEvent } from "../api";
import { LiveConnection, type LiveState } from "../live";
import DataTable from "../components/DataTable.vue";
import LiveViewer from "../components/LiveViewer.vue";
import MenuButton from "../components/MenuButton.vue";
import KeyHint from "../components/KeyHint.vue";
import LogViewer from "../components/LogViewer.vue";
import ModalDialog from "../components/ModalDialog.vue";
import MultiSelect from "../components/MultiSelect.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusChip from "../components/StatusChip.vue";
import TextArea from "../components/TextArea.vue";
import TextField from "../components/TextField.vue";
import { exportUrl } from "../compare";
import { countsText, duration } from "../format";
import { levelOf, type LogLine } from "../logview";
import { href } from "../router";
import { resultRows, type ResultRow } from "../review";
import { canMove as canMoveRow, movable as movableRow } from "../queue";
import { useShortcut } from "../keys";
import { offerNotify } from "../notify";
import { resetHead, setIconDot, setTitle } from "../pagehead";
import { openModals } from "../popup";
import { runTitle, runTone } from "../runstate";
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
// Steps as they start, for the live view's rewind scrubber.
const recentSteps = ref<{ at: number; label: string }[]>([]);
const rewound = ref<{ pageId: string; at: number } | null>(null);
function noteStep(time: string, label: string) {
  recentSteps.value.push({ at: Date.parse(time), label });
  if (recentSteps.value.length > 300) recentSteps.value.splice(0, recentSteps.value.length - 300);
}

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
// The log keeps its newest lines; line numbers count from the first line since the page opened.
const LOG_LIMIT = 5000;
const logDropped = ref(0);
function addLog(line: (typeof log.value)[number]) {
  log.value.push(line);
  const over = log.value.length - LOG_LIMIT;
  if (over > 0) {
    log.value.splice(0, over);
    logDropped.value += over;
  }
}
// Which test an attempt belongs to, so log lines can be filtered by test.
const attemptTests = new Map<string, string>();
watch(run, (r) => r?.attempts.forEach((a) => attemptTests.set(a.id, a.testId)));
function onEvent(e: WwEvent) {
  if (e.runId !== props.id) return;
  const d = e.data;
  switch (e.type) {
    case "attempt.log":
    case "run.log":
      addLog({ seq: e.seq, time: String(d.time ?? e.time), level: String(d.level ?? "info"), message: String(d.message ?? ""), test: (e.attemptId && attemptTests.get(e.attemptId)) || null });
      break;
    case "attempt.step":
      step.value = (d.title as string | null) ?? null;
      if (step.value) noteStep(e.time, step.value);
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
      noteStep(e.time, `${String(d.testId)} starts`);
      if (e.attemptId) attemptTests.set(e.attemptId, String(d.testId));
      addLog({ seq: e.seq, time: e.time, level: "info", message: `Started ${d.testId} ${titles.value.get(String(d.testId)) ?? ""} (attempt ${d.number} of ${d.of}${Number(d.try) > 1 ? `, try ${d.try}` : ""})`, test: String(d.testId) });
      scheduleLoad();
      break;
    case "attempt.finished":
      addLog({ seq: e.seq, time: e.time, level: d.status === "passed" ? "info" : "warn", message: `${d.testId} ${d.status}${d.error ? `: ${String(d.error).split("\n")[0]}` : ""}`, test: String(d.testId) });
      scheduleLoad();
      break;
    case "review.saved":
      void loadReviews();
      break;
    case "video.unavailable":
      addLog({ seq: e.seq, time: e.time, level: "warn", message: String(d.message), test: null });
      break;
    default:
      if (e.type.startsWith("run.") || e.type.startsWith("pack.")) scheduleLoad();
  }
}

// "Run again": the same pack, tests, values, options and label, started right away.
async function again() {
  actionError.value = null;
  busy.value = true;
  const res = await sendJson<RunDetail>(`/api/v1/runs/${props.id}/again`);
  busy.value = false;
  if (!res.ok) return void (actionError.value = res.error.message);
  offerNotify();
  window.location.hash = href({ name: "run", id: res.data.id });
}

// The run's label, edited in place beside the title.
const editingLabel = ref(false);
const labelDraft = ref("");
function editLabel() {
  labelDraft.value = run.value?.label ?? "";
  editingLabel.value = true;
}
async function saveLabel() {
  const res = await sendJson<RunDetail>(`/api/v1/runs/${props.id}/label`, { label: labelDraft.value });
  if (!res.ok) return void (actionError.value = res.error.message);
  if (run.value) run.value = { ...run.value, label: res.data.label };
  editingLabel.value = false;
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

// Add tests: tests of the pack that aren't in the run go at the end of the queue, with what they need.
const addOpen = ref(false);
const addChosen = ref<string[]>([]);
const addPack = ref<Pack | null>(null);
const addError = ref<string | null>(null);
const inRun = computed(() => {
  const ids = new Set<string>();
  for (const p of run.value?.plan ?? []) {
    ids.add(p.testId);
    for (const c of p.children ?? []) ids.add(c);
  }
  return ids;
});
const addOptions = computed(() =>
  (addPack.value?.tests ?? [])
    .filter((t) => !inRun.value.has(t.id))
    .map((t) => {
      const bits = [t.inside.length ? `inside ${t.inside.join(" or ")}` : "", t.needs.length ? `needs ${t.needs.join(", ")}` : "", ...t.tags.map((x) => `#${x}`)].filter(Boolean);
      return { value: t.id, label: t.title !== t.id ? `${t.id} · ${t.title}` : t.id, group: t.section ?? "Tests", note: bits.join(" · ") || undefined };
    }),
);
async function openAdd() {
  addOpen.value = true;
  addChosen.value = [];
  addError.value = null;
  if (!run.value) return;
  const res = await getJson<Pack>(`/api/v1/packs/${run.value.packId}`);
  if (res.ok) addPack.value = res.data;
  else addError.value = res.error.message;
}
async function addTests() {
  addError.value = null;
  busy.value = true;
  const res = await sendJson<RunDetail>(`/api/v1/runs/${props.id}/queue/add`, { tests: addChosen.value });
  busy.value = false;
  if (!res.ok) {
    addError.value = res.error.message;
    return;
  }
  run.value = res.data;
  addOpen.value = false;
}

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
  const at = rewound.value ? { pageId: rewound.value.pageId, at: rewound.value.at } : {};
  const res = await sendJson<{ attemptId: string; artifact: { name: string; path: string } }>(`/api/v1/runs/${props.id}/mark`, { note: markNote.value.trim(), ...at });
  busy.value = false;
  markOpen.value = false;
  if (!res.ok) {
    actionError.value = res.error.message;
    return;
  }
  markSaved.value = `Marked ${res.data.artifact.path.split("/").pop()}${markNote.value.trim() ? `: ${markNote.value.trim()}` : ""}`;
  markNote.value = "";
}

// Log, with a filter by test (the viewer has the level filters and search).
const logTest = ref("");
const testOptions = computed(() => [{ value: "", label: "All tests" }, ...[...titles.value].map(([id, t]) => ({ value: id, label: t && t !== id ? `${id} · ${t}` : id }))]);
const logLines = computed<LogLine[]>(() =>
  log.value.flatMap((l, i) => (!logTest.value || l.test === logTest.value ? [{ key: l.seq, n: logDropped.value + i + 1, time: l.time, level: levelOf(l.level), message: l.message, test: l.test }] : [])),
);

// Results with review scores, once the run is over.
const showResults = computed(() => run.value !== null && !active.value && run.value.status !== "queued" && run.value.attempts.length > 0);
const exports = computed(() => [
  { value: "md", label: "Markdown", href: exportUrl("md", [props.id]) },
  { value: "zip", label: "Markdown and screenshots (zip)", href: exportUrl("zip", [props.id]) },
]);
const reviews = ref<Review[]>([]);
const rubric = ref<Record<string, Criterion[]>>({});
async function loadReviews() {
  if (!showResults.value) return;
  const [r, c] = await Promise.all([getJson<Review[]>(`/api/v1/reviews?run=${props.id}`), getJson<Record<string, Criterion[]>>(`/api/v1/runs/${props.id}/rubric`)]);
  if (r.ok) reviews.value = r.data;
  if (c.ok) rubric.value = c.data;
}
watch(showResults, () => void loadReviews(), { immediate: true });

// Since the last run: attempts whose status, flags, score or time moved since the newest earlier
// run of the same pack and params.
const changes = ref<RunChanges | null>(null);
async function loadChanges() {
  if (!showResults.value) return;
  const res = await getJson<RunChanges>(`/api/v1/runs/${props.id}/changes`);
  changes.value = res.ok ? res.data : null;
}
watch(showResults, () => void loadChanges(), { immediate: true });
const flagDiff = (before: ChangeSide | null, after: ChangeSide | null) => {
  const b = new Set(before?.flags ?? []);
  const a = new Set(after?.flags ?? []);
  return { added: [...a].filter((f) => !b.has(f)), dropped: [...b].filter((f) => !a.has(f)) };
};
const scoreOf = (s: ChangeSide | null) => (s?.score === null || s?.score === undefined ? "–" : s.score.toFixed(1));
const results = computed(() => (run.value ? resultRows(run.value, reviews.value, rubric.value) : []));
const maxAttempts = computed(() => Math.max(1, ...results.value.flatMap((r) => Object.keys(r.cells).map(Number))));
const resultColumns = computed(() => [
  { key: "test", label: "Test", sortable: true, value: (r: ResultRow) => r.testId },
  ...Array.from({ length: maxAttempts.value }, (_, i) => ({
    key: `a${i + 1}`,
    label: maxAttempts.value > 1 ? `Attempt ${i + 1}` : "Attempt",
    sortable: true,
    value: (r: ResultRow) => r.cells[i + 1]?.score ?? null,
  })),
  { key: "score", label: "Score", sortable: true, align: "end" as const, value: (r: ResultRow) => r.score },
]);
function openRow(r: ResultRow) {
  const first = Object.values(r.cells)[0];
  if (first) openAttempt(first.attemptId);
}

let conn: LiveConnection | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
function connect() {
  conn?.close();
  log.value = [];
  logDropped.value = 0;
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
  resetHead();
});

// The tab says how the run is going, so a tab in the background still tells you.
watch([run, live], ([r, l]) => {
  if (!r) return;
  setTitle(runTitle(r, l));
  void setIconDot(runTone(r, l));
});

// Keyboard: the run's controls, each only when its button is there. Not while a dialog is open.
const canPause = computed(() => active.value && (!live.value || live.value.state === "running") && !live.value?.stopping);
const canResume = computed(() => live.value?.state === "pausing" || pausedManual.value);
const keyed = (fn: () => void) => () => {
  if (openModals.length === 0 && !busy.value) fn();
};
useShortcut("Space", keyed(() => (canPause.value ? void act("pause") : canResume.value ? void act("resume") : undefined)));
useShortcut("R", keyed(() => pausedBroken.value && void act("retry")));
useShortcut("S", keyed(() => pausedBroken.value && void act("skip")));
useShortcut("M", keyed(() => active.value && live.value?.attemptId && (markOpen.value = true)));
useShortcut("Shift+S", keyed(() => active.value && !live.value?.stopping && void act("stop", { when: "after" })));
const keysOpen = ref(false);
useShortcut("?", keyed(() => (keysOpen.value = true)));
const KEYS = [
  { keys: "Space", what: "Pause, or resume a pause you made" },
  { keys: "R", what: "Retry the broken attempt the run paused on" },
  { keys: "S", what: "Skip it: keep its result and go on" },
  { keys: "M", what: "Mark: save the live view to the running attempt" },
  { keys: "Shift+S", what: "Stop after this test" },
  { keys: "?", what: "This list" },
];


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
</script>

<template>
  <main class="page">
    <p class="crumb"><a href="#/"><ArrowLeft :size="15" />Runs</a></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="run">
      <header class="head">
        <div class="title">
          <h1 class="display">{{ run.packName }} <span class="muted rid">{{ run.id }}</span></h1>
          <form v-if="editingLabel" class="labelform" @submit.prevent="saveLabel" @keydown.esc.stop="editingLabel = false">
            <label for="run-label" class="sr-only">Label</label>
            <TextField id="run-label" v-model="labelDraft" class="labelfield" placeholder="A name for this run, e.g. nightly" />
            <button class="btn primary" type="submit">Save</button>
            <button class="btn" type="button" @click="editingLabel = false">Cancel</button>
          </form>
          <p v-else class="named">
            <span v-if="run.label" class="lbltxt">{{ run.label }}</span>
            <button v-tip="run.label ? 'Rename this run' : 'Give this run a name'" type="button" class="ib" :aria-label="run.label ? 'Rename this run' : 'Give this run a name'" @click="editLabel">
              <Pencil :size="14" /><span v-if="!run.label" class="small">Name this run</span>
            </button>
          </p>
          <p class="muted">
            <StatusChip :status="run.status" />
            <span v-if="run.mode !== 'normal'">&nbsp;{{ run.mode === "redo" ? "redoing broken tests" : "resumed" }}</span>
            · started by {{ run.startedBy }}
            <template v-for="(v, k) in run.params" :key="k"> · {{ k }}={{ v }}</template>
          </p>
          <p v-if="Object.keys(run.info ?? {}).length" class="facts small" aria-label="Run facts">
            <span v-for="(v, k) in run.info" :key="k" class="fact"><span class="muted">{{ k }}</span> {{ v }}</span>
          </p>
        </div>
        <div class="controls">
          <template v-if="active">
            <button v-if="!live || live.state === 'running'" v-tip="'Pause (Space)'" class="btn" aria-keyshortcuts="Space" :disabled="busy || !!live?.stopping" @click="act('pause')">Pause</button>
            <button v-if="live?.state === 'pausing' || pausedManual" v-tip="'Resume (Space)'" class="btn primary" aria-keyshortcuts="Space" :disabled="busy" @click="act('resume')">Resume</button>
            <button v-if="pausedBroken" v-tip="'Retry (R)'" class="btn primary" aria-keyshortcuts="R" :disabled="busy" @click="act('retry')">Retry</button>
            <button v-if="pausedBroken" v-tip="'Skip (S)'" class="btn" aria-keyshortcuts="S" :disabled="busy" @click="act('skip')">Skip</button>
            <button v-tip="'Save the live view to this attempt, with a note (M)'" class="btn" aria-keyshortcuts="M" :disabled="busy || !live?.attemptId" @click="markOpen = true">Mark</button>
            <button v-tip="'Stop after this test (Shift+S)'" class="btn" aria-keyshortcuts="Shift+S" :disabled="busy || !!live?.stopping" @click="act('stop', { when: 'after' })">Stop after this test</button>
            <button class="btn danger" :disabled="busy || live?.stopping === 'now'" @click="act('stop', { when: 'now' })">Stop now</button>
            <button v-tip="'Keyboard shortcuts (?)'" class="btn keysbtn" aria-label="Keyboard shortcuts" aria-keyshortcuts="?" @click="keysOpen = true"><Keyboard :size="15" /></button>
          </template>
          <button v-if="run.status === 'queued'" class="btn danger" :disabled="busy" @click="act('stop', { when: 'now' })">Cancel</button>
          <button v-if="canResumeRun" class="btn primary" :disabled="busy" @click="act('resume')">Resume run</button>
          <button v-if="canRedo" class="btn" :disabled="busy" @click="act('redo-broken')">Redo broken</button>
          <button v-if="!active && run.status !== 'queued'" v-tip="'Start the same pack, tests, values and options now'" class="btn" :disabled="busy" @click="again"><Repeat :size="15" /> Run again</button>
          <a v-if="!active" class="btn" :href="`#/new?pack=${run.packId}&from=${run.id}`">New run like this…</a>
          <a v-if="showResults" class="btn" :href="`#/compare?runs=${run.id}`">Compare</a>
          <MenuButton v-if="showResults" :items="exports" label="Export" class="export">
            <template #button><span class="exportlabel">Export</span></template>
          </MenuButton>
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
          <LiveViewer ref="viewer" :pages="pages" :active-page-id="activePageId" :running="active" :run-id="run.id" :steps="recentSteps" @rewound="(m) => (rewound = m)" />
          <p v-if="liveState !== 'open'" class="muted small">Live connection: {{ liveState === "connecting" ? "connecting…" : "lost, retrying" }}</p>
        </section>

        <section v-if="!showResults" class="card" aria-labelledby="queue-title">
          <div class="qhead">
            <h2 id="queue-title" class="display">Queue</h2>
            <button v-if="active" class="btn" :disabled="busy" @click="openAdd"><Plus :size="15" /> Add tests</button>
          </div>
          <p class="qcounts muted small">{{ run.counts.passed }} passed · {{ run.counts.failed }} failed · {{ run.counts.broken }} broken · {{ run.counts.planned }} planned</p>
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
                  <StatusChip :status="p.skip && p.status === 'pending' ? 'skipped' : p.status" :kind="run.kind" />
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
                  <template v-else>
                    <span class="ibtn-gap" aria-hidden="true" />
                    <span class="ibtn-gap" aria-hidden="true" />
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
                  <button class="qrow" @click="openAttempt(a.id)"><code>{{ a.testId }}</code><span class="qt">{{ a.title }}</span><StatusChip :status="a.status" :kind="a.kind" /></button>
                </li>
              </ul>
            </li>
          </ol>
        </section>
      </div>

      <section v-if="showResults && changes?.previous" class="card" aria-labelledby="changes-title">
        <div class="reshead">
          <h2 id="changes-title" class="display">Since the last run</h2>
          <span class="muted small">
            Against <a :href="href({ name: 'run', id: changes.previous.id })" class="num">{{ changes.previous.id }}</a>, the last run of this pack with the same parameters.
            <template v-if="changes.rows.length"> {{ changes.same }} {{ changes.same === 1 ? "attempt" : "attempts" }} didn't change.</template>
            {{ " " }}<a :href="`#/compare?runs=${changes.previous.id},${run.id}`">Compare side by side</a>
          </span>
        </div>
        <p v-if="changes.rows.length === 0" class="muted">Nothing changed: every attempt has the same status and flags, and no score or time moved.</p>
        <ul v-else class="changes">
          <li v-for="c in changes.rows" :key="`${c.testId}#${c.number}`">
            <a class="chrow" :href="c.after ? href({ name: 'attempt', runId: run.id, attemptId: c.after.attemptId }) : href({ name: 'attempt', runId: c.before!.runId, attemptId: c.before!.attemptId })">
              <span class="chtest"><code>{{ c.testId }}</code> {{ c.title !== c.testId ? c.title : "" }}<span v-if="c.number > 1" class="muted n"> #{{ c.number }}</span></span>
              <span class="chwhat">
                <template v-if="c.changes.includes('new')"><span class="muted">new</span> <StatusChip :status="c.after!.status" /></template>
                <template v-else-if="c.changes.includes('gone')"><StatusChip :status="c.before!.status" /> <span class="muted">not in this run</span></template>
                <template v-else>
                  <span v-if="c.changes.includes('status')" class="pair"><StatusChip :status="c.before!.status" /><ArrowRight :size="13" class="muted" /><StatusChip :status="c.after!.status" /></span>
                  <span v-if="c.changes.includes('flags')" class="pair small">
                    <span v-for="f in flagDiff(c.before, c.after).added" :key="`+${f}`" class="flag add">+ {{ f }}</span>
                    <span v-for="f in flagDiff(c.before, c.after).dropped" :key="`-${f}`" class="flag drop">− {{ f }}</span>
                  </span>
                  <span v-if="c.changes.includes('score')" class="pair small"><span class="muted">score</span> <span class="num">{{ scoreOf(c.before) }}</span><ArrowRight :size="13" class="muted" /><span class="num">{{ scoreOf(c.after) }}</span></span>
                  <span v-if="c.changes.includes('time')" class="pair small"><span class="muted">time</span> <span class="num">{{ duration(c.before!.durationMs) }}</span><ArrowRight :size="13" class="muted" /><span class="num">{{ duration(c.after!.durationMs) }}</span></span>
                </template>
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section v-if="showResults" class="card" aria-labelledby="results-title">
        <div class="reshead">
          <h2 id="results-title" class="display">Results <span class="muted small">{{ countsText(run.counts) }}</span></h2>
          <span class="muted small">Score: the mean of the scale scores, on 1 to 5. Click a cell to open the attempt and review it.</span>
        </div>
        <DataTable :columns="resultColumns" :rows="results" :row-key="(r) => r.testId" label="Results by test and attempt" clickable @row-click="openRow">
          <template #cell-test="{ row }">
            <span :class="{ child: row.parent }"><code>{{ row.testId }}</code> {{ row.title !== row.testId ? row.title : "" }}</span>
          </template>
          <template v-for="n in maxAttempts" :key="n" #[`cell-a${n}`]="{ row }">
            <a v-if="row.cells[n]" class="cell" :href="href({ name: 'attempt', runId: run.id, attemptId: row.cells[n].attemptId })" @click.stop>
              <StatusChip :status="row.cells[n].status" />
              <span v-if="row.cells[n].score !== null" class="num">{{ row.cells[n].score.toFixed(1) }}</span>
              <span v-else-if="!row.cells[n].reviewed" class="muted small">not reviewed</span>
              <span v-if="row.cells[n].flags" v-tip="`${row.cells[n].flags} ${row.cells[n].flags === 1 ? 'flag' : 'flags'}`" class="flags num">{{ row.cells[n].flags }}</span>
            </a>
          </template>
          <template #cell-score="{ row }">
            <span class="num">{{ row.score === null ? "–" : row.score.toFixed(1) }}</span>
          </template>
        </DataTable>
      </section>

      <section class="card" aria-labelledby="log-title">
        <div class="loghead">
          <h2 id="log-title" class="display">Log</h2>
          <span v-if="active" class="live-tag">live</span>
        </div>
        <LogViewer :lines="logLines" label="Run log" :live="active" height="360px" :empty-text="log.length ? 'No lines from this test.' : 'Nothing logged yet.'">
          <template #filters>
            <div class="logtest">
              <label for="log-test" class="sr-only">Which test</label>
              <SelectMenu id="log-test" v-model="logTest" :options="testOptions" />
            </div>
          </template>
        </LogViewer>
        <p v-if="run.attempts.length" class="muted small">
          {{ run.attempts.filter((a) => !a.parentId).length }} {{ run.attempts.filter((a) => !a.parentId).length === 1 ? "attempt" : "attempts" }} ·
          {{ duration(run.attempts.reduce((s, a) => s + (a.durationMs ?? 0), 0)) }} of test time
        </p>
      </section>
      <ModalDialog v-model="markOpen" heading="Mark this moment">
        <p class="muted small">Saves what the live view shows {{ rewound ? "at the rewound moment" : "now" }} to the running attempt{{ live?.testId ? ` (${live.testId})` : "" }}, with your note. It shows with the attempt's screenshots.</p>
        <TextArea v-model="markNote" :rows="3" placeholder="What you saw (optional)" />
        <template #actions>
          <button class="btn" :disabled="busy" @click="markOpen = false">Cancel</button>
          <button class="btn primary" :disabled="busy" @click="saveMark">{{ busy ? "Saving…" : "Save mark" }}</button>
        </template>
      </ModalDialog>
      <ModalDialog v-model="addOpen" heading="Add tests to this run">
        <p class="muted small">They go at the end of the queue, after what they need. A test the run doesn't have yet that they need comes along.</p>
        <MultiSelect id="run-add-tests" v-model="addChosen" :options="addOptions" placeholder="Search by id, title, section or tag" empty-label="Pick tests" :max-chips="8" />
        <p v-if="addPack && addOptions.length === 0" class="muted small">Every test of the pack is in the run.</p>
        <p v-if="addError" class="error" role="alert">{{ addError }}</p>
        <template #actions>
          <button class="btn" :disabled="busy" @click="addOpen = false">Cancel</button>
          <button class="btn primary" :disabled="busy || addChosen.length === 0" @click="addTests">{{ busy ? "Adding…" : addChosen.length > 1 ? `Add ${addChosen.length} tests` : "Add test" }}</button>
        </template>
      </ModalDialog>
      <ModalDialog v-model="confirmDelete" heading="Delete this run?">
        <p><strong>{{ run.packName }}</strong> <span class="num">{{ run.id }}</span> ({{ countsText(run.counts) }}). Its results, screenshots, videos and traces are removed from the data folder. This can't be undone.</p>
        <template #actions>
          <button class="btn" :disabled="busy" @click="confirmDelete = false">Cancel</button>
          <button class="btn danger" :disabled="busy" @click="remove">{{ busy ? "Deleting…" : "Delete run" }}</button>
        </template>
      </ModalDialog>
      <ModalDialog v-model="keysOpen" heading="Keyboard shortcuts">
        <dl class="shortcut-list">
          <template v-for="k in KEYS" :key="k.keys">
            <dt><KeyHint :keys="k.keys" /></dt>
            <dd>{{ k.what }}</dd>
          </template>
        </dl>
        <p class="muted small keysnote">Each works only when its button shows, and not while a dialog is open.</p>
      </ModalDialog>
    </template>
    <PageSkeleton v-else-if="!error" label="Loading the run" :cards="2" />
  </main>
</template>

<style scoped>
.shortcut-list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  margin: 0;
}
.shortcut-list dd {
  margin: 0;
}
.shortcut-list + .keysnote {
  margin: var(--space-4) 0 0;
}
/* no keyboard to speak of at phone width */
@media (max-width: 720px) {
  .keysbtn {
    display: none;
  }
}
.qhead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.qhead h2 {
  margin: 0;
}
.qcounts {
  margin: var(--space-1) 0 var(--space-3);
}
.exportlabel {
  padding: 0 var(--space-2);
  font-size: 14px;
}
/* One width while running and after, so the page doesn't jump when the run ends. */
.page {
  max-width: 1600px;
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
.head .named {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-1);
}
.lbltxt {
  font-weight: 600;
}
.ib {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 26px;
  padding: 0 var(--space-1);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
.labelform {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  max-width: 520px;
}
.labelfield {
  flex: 1;
  min-width: 200px;
}
.controls .btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
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
/* Keeps the skip button and the status in line on rows that can't move. */
.ibtn-gap {
  width: 26px;
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
.reshead {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  margin-bottom: 10px;
}
.reshead h2 {
  margin: 0;
}
.changes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.chrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 16px;
  padding: 8px 4px;
  border-top: var(--border-width) solid var(--line);
  color: var(--text);
  text-decoration: none;
}
.changes li:first-child .chrow {
  border-top: 0;
}
.chrow:hover {
  background: var(--raised);
}
.chwhat {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
}
.pair {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.flag {
  padding: 0 6px;
  border-radius: var(--radius-chip);
  font-size: 12px;
}
.flag.add {
  color: var(--bad);
  background: var(--raised);
}
.flag.drop {
  color: var(--ok);
  background: var(--raised);
}
.child {
  padding-left: 18px;
}
.cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  text-decoration: none;
}
.cell:hover .num {
  color: var(--accent);
}
.flags {
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: color-mix(in srgb, var(--warn) 18%, transparent);
  font-size: 12px;
}
.loghead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}
.loghead h2 {
  margin: 0;
}
.logtest {
  width: 200px;
}
@media (max-width: 640px) {
  .logtest {
    width: 100%;
  }
}
.live-tag {
  padding: 1px var(--space-2);
  border-radius: var(--radius-chip);
  background: color-mix(in srgb, var(--live) 15%, transparent);
  color: var(--live);
  font-size: 12px;
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
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  margin: var(--space-1) 0 0;
}
.fact {
  padding: 1px 8px;
  border-radius: var(--radius-chip);
  background: var(--raised);
  overflow-wrap: anywhere;
}
</style>
