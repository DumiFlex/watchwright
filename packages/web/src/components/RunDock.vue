<script setup lang="ts">
// A run beside the editor: its live view, the step it is on, and the controls a test author
// needs (pause, resume, retry or skip a broken attempt, stop). Saving a fix while an attempt is
// broken and pressing Retry runs the fixed step (the pack reloads before each attempt).
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getJson, sendJson, type Attempt, type ResultDocument, type RunDetail, type WwEvent } from "../api";
import { plainText } from "../attempt";
import { firstOwnFrame, type SourceSpot } from "../editor";
import { countsText } from "../format";
import { ExternalLink } from "../icons";
import { LiveConnection, type LiveState } from "../live";
import { href } from "../router";
import LiveViewer from "./LiveViewer.vue";
import StatusChip from "./StatusChip.vue";

const props = defineProps<{ runId: string }>();
const emit = defineEmits<{ close: []; finished: [run: RunDetail]; goto: [spot: SourceSpot] }>();

const run = ref<RunDetail | null>(null);
const pages = ref<{ id: string; url: string }[]>([]);
const activePageId = ref<string | null>(null);
const step = ref<string | null>(null);
const liveState = ref<LiveState>("connecting");
const busy = ref(false);
const error = ref<string | null>(null);
const viewer = ref<InstanceType<typeof LiveViewer> | null>(null);

const active = computed(() => run.value !== null && ["queued", "running", "pausing", "paused"].includes(run.value.status));
const live = computed(() => run.value?.live ?? null);
const pausedBroken = computed(() => live.value?.state === "paused" && live.value.pauseReason === "broken");
const pausedManual = computed(() => live.value?.state === "paused" && live.value.pauseReason === "manual");
const lastAttempt = computed<Attempt | null>(() => run.value?.attempts.at(-1) ?? null);

// Where the last attempt went wrong, from its result: the message and the line in the pack's files.
const result = ref<ResultDocument | null>(null);
const spot = computed(() => (result.value?.error?.stack ? firstOwnFrame(result.value.error.stack) : null));
const shownError = computed(() => (result.value?.error && result.value.status !== "passed" ? plainText(result.value.error.message).split("\n").slice(0, 6).join("\n") : null));
async function loadResult() {
  const a = lastAttempt.value;
  const wrong = a && (a.status === "failed" || a.status === "broken" || pausedBroken.value);
  if (!a || !wrong) {
    result.value = null;
    return;
  }
  const res = await getJson<ResultDocument>(`/api/v1/runs/${props.runId}/attempts/${a.id}`);
  result.value = res.ok ? res.data : null;
}
watch(() => [lastAttempt.value?.id, lastAttempt.value?.status, pausedBroken.value], () => void loadResult());

async function load() {
  const res = await getJson<RunDetail>(`/api/v1/runs/${props.runId}`);
  if (!res.ok) {
    error.value = res.error.message;
    return;
  }
  const was = active.value;
  run.value = res.data;
  if (res.data.live) {
    pages.value = res.data.live.pages;
    activePageId.value = res.data.live.activePageId;
    step.value = res.data.live.step;
  }
  if (was && !active.value) emit("finished", res.data);
}

let timer: ReturnType<typeof setTimeout> | null = null;
function later() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, 150);
}

function onEvent(e: WwEvent) {
  if (e.runId !== props.runId) return;
  const d = e.data;
  if (e.type === "attempt.step") step.value = (d.title as string | null) ?? null;
  else if (e.type === "page.opened" && !pages.value.some((p) => p.id === d.pageId)) pages.value.push({ id: String(d.pageId), url: String(d.url ?? "") });
  else if (e.type === "page.navigated") {
    const p = pages.value.find((x) => x.id === d.pageId);
    if (p) p.url = String(d.url ?? "");
  } else if (e.type === "page.closed") pages.value = pages.value.filter((p) => p.id !== d.pageId);
  else if (e.type === "page.active") activePageId.value = String(d.pageId);
  if (e.type.startsWith("run.") || e.type.startsWith("attempt.started") || e.type.startsWith("attempt.finished")) later();
}

let conn: LiveConnection | null = null;
function connect() {
  conn?.close();
  pages.value = [];
  step.value = null;
  conn = new LiveConnection({ runId: props.runId, frames: true, after: 0 }, { onState: (s) => (liveState.value = s), onEvent, onFrame: (h, jpeg) => void viewer.value?.push(h, jpeg) });
  void load();
}
watch(() => props.runId, connect, { immediate: true });
onBeforeUnmount(() => {
  conn?.close();
  if (timer) clearTimeout(timer);
});

async function act(path: string, body: unknown = {}) {
  busy.value = true;
  error.value = null;
  const res = await sendJson<RunDetail>(`/api/v1/runs/${props.runId}/${path}`, body);
  busy.value = false;
  if (!res.ok) error.value = res.error.message;
  else run.value = res.data;
}
</script>

<template>
  <section class="run-dock" aria-label="The test's run">
    <header class="top">
      <StatusChip v-if="run" :status="live?.state === 'paused' ? 'paused' : run.status" />
      <a class="rid num small" :href="href({ name: 'run', id: runId })">Run {{ runId }}<ExternalLink :size="13" /></a>
      <span class="grow"></span>
      <button type="button" class="btn" @click="emit('close')">Close</button>
    </header>
    <p v-if="active" class="now small">
      <template v-if="pausedBroken"><strong class="broken">Broken.</strong> Fix the step, save, then Retry.</template>
      <template v-else-if="step">{{ step }}</template>
      <template v-else-if="run?.status === 'queued'">Waiting for the site to be free…</template>
      <template v-else>Starting…</template>
    </p>
    <p v-else-if="run" class="done small">
      <StatusChip v-if="lastAttempt" :status="lastAttempt.status" />
      {{ countsText(run.counts) }}.
      <a v-if="lastAttempt" :href="href({ name: 'attempt', runId, attemptId: lastAttempt.id })">See the attempt</a>
    </p>
    <div v-if="shownError" class="err">
      <pre class="msg">{{ shownError }}</pre>
      <button v-if="spot" type="button" class="btn" @click="emit('goto', spot)">Go to line {{ spot.line }}</button>
    </div>
    <div v-if="active || pages.length" class="view">
      <LiveViewer ref="viewer" :pages="pages" :active-page-id="activePageId" :running="active" />
    </div>
    <p v-if="active && liveState !== 'open'" class="muted small">Live connection: {{ liveState === "connecting" ? "connecting…" : "lost, retrying" }}</p>
    <div v-if="active" class="controls">
      <button v-if="!live || live.state === 'running'" class="btn" :disabled="busy || !!live?.stopping" @click="act('pause')">Pause</button>
      <button v-if="live?.state === 'pausing' || pausedManual" class="btn primary" :disabled="busy" @click="act('resume')">Resume</button>
      <button v-if="pausedBroken" class="btn primary" :disabled="busy" @click="act('retry')">Retry</button>
      <button v-if="pausedBroken" class="btn" :disabled="busy" @click="act('skip')">Skip</button>
      <button class="btn danger" :disabled="busy || live?.stopping === 'now'" @click="act('stop', { when: 'now' })">Stop</button>
    </div>
    <p v-if="error" class="error small" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.run-dock {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  min-width: 0;
}
.top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.rid {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  text-decoration: none;
}
.rid:hover {
  color: var(--text);
}
.grow {
  flex: 1;
}
.now {
  margin: 0;
  min-height: 1.4em;
  color: var(--live);
  overflow-wrap: anywhere;
}
.done {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}
.err {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--bad);
  background: color-mix(in srgb, var(--bad) 7%, var(--surface));
  border-radius: var(--radius-sm);
}
.msg {
  margin: 0;
  max-width: 100%;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.broken {
  color: var(--warn);
}
.view {
  min-width: 0;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
