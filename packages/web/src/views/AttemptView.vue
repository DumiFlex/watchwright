<script setup lang="ts">
// Everything one attempt saved: error, flags, metrics and notes on top, then tabs for the
// screenshots (gallery, scroll sets as strips, marks), kept texts, the log, collector records,
// the video and the trace, with the review beside them (below on narrow screens). J and K step
// to the next and previous attempt of the run.
import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquarePlus, Pencil } from "../icons";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, type Artifact, type Pack, type ResultDocument, type RunDetail } from "../api";
import { attemptOrder, attemptSteps, cellOf, logMarks, plainText, recordColumns, shotGroups, traceViewerUrl } from "../attempt";
import { clock, type TimelineStep } from "../timeline";
import { duration, fileSize, when } from "../format";
import { firstOwnFrame } from "../editor";
import { relativeTo, tildify } from "../paths";
import { href } from "../router";
import { loadSettings, settings } from "../settings";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import CodeView from "../components/CodeView.vue";
import DataTable from "../components/DataTable.vue";
import FileLink from "../components/FileLink.vue";
import ImageViewer from "../components/ImageViewer.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import ReviewPanel from "../components/ReviewPanel.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusChip from "../components/StatusChip.vue";
import TabBar from "../components/TabBar.vue";
import TimelineScrubber from "../components/TimelineScrubber.vue";
import VideoPlayer from "../components/VideoPlayer.vue";

const props = defineProps<{ runId: string; attemptId: string }>();
/** Text files bigger than this open in a new tab instead of the code view. */
const TEXT_LIMIT = 2 * 1024 * 1024;

const doc = ref<ResultDocument | null>(null);
const run = ref<RunDetail | null>(null);
const error = ref<string | null>(null);

async function load() {
  error.value = null;
  const [d, r] = await Promise.all([getJson<ResultDocument>(`/api/v1/runs/${props.runId}/attempts/${props.attemptId}`), getJson<RunDetail>(`/api/v1/runs/${props.runId}`)]);
  if (!d.ok) {
    error.value = d.error.message;
    doc.value = null;
    return;
  }
  doc.value = d.data;
  if (r.ok) {
    run.value = r.data;
    void loadDescription(r.data.packId, d.data.test.id);
  }
}

// What the test says it does and what a good result looks like, from the pack (as it is now).
const description = ref<string | null>(null);
const testPack = ref<Pack | null>(null);
async function loadDescription(packId: string, testId: string) {
  const p = await getJson<Pack>(`/api/v1/packs/${packId}`);
  testPack.value = p.ok ? p.data : null;
  description.value = p.ok ? (p.data.tests.find((t) => t.id === testId)?.description ?? null) : null;
}

// "Edit this test" opens the pack's editor at the line the attempt went wrong on, else at the test.
const editLink = computed(() => {
  const p = testPack.value;
  const d = doc.value;
  if (!p || !d) return null;
  const frame = d.error?.stack ? firstOwnFrame(d.error.stack) : null;
  const rel = frame ? relativeTo(p.dir, frame.file) : null;
  if (frame && rel) return href({ name: "edit", id: p.id, file: rel, line: frame.line });
  const t = p.tests.find((x) => x.id === d.test.id);
  return t ? href({ name: "edit", id: p.id, file: t.file, line: t.line }) : null;
});

// Next and previous attempt of the run.
const order = computed(() => (run.value ? attemptOrder(run.value) : []));
const at = computed(() => order.value.indexOf(props.attemptId));
const prevId = computed(() => (at.value > 0 ? order.value[at.value - 1] : undefined));
const nextId = computed(() => (at.value >= 0 ? order.value[at.value + 1] : undefined));
const linkTo = (attemptId: string) => href({ name: "attempt", runId: props.runId, attemptId });

// Flags: robot problems (the harness couldn't do its job) apart from findings about the site.
const robot = computed(() => doc.value?.flags.filter((f) => f.kind === "robot") ?? []);
const findings = computed(() => doc.value?.flags.filter((f) => f.kind === "finding") ?? []);
const infos = computed(() => doc.value?.flags.filter((f) => f.kind === "info") ?? []);

// Tabs, shown only when there is something in them (the log always).
const artifacts = computed(() => doc.value?.artifacts ?? []);
const groups = computed(() => shotGroups(artifacts.value));
const images = computed(() => groups.value.flatMap((g) => g.shots));
const videos = computed(() => artifacts.value.filter((a) => a.kind === "video"));
const trace = computed(() => artifacts.value.find((a) => a.kind === "trace") ?? null);
const collectors = computed(() => artifacts.value.filter((a) => a.kind === "collector"));
const files = computed(() => artifacts.value.filter((a) => !["shot", "mark", "video", "trace", "collector", "text"].includes(a.kind)));
const texts = computed(() => Object.entries(doc.value?.texts ?? {}));

type Tab = "shots" | "texts" | "log" | "collectors" | "files" | "video" | "trace";
const tab = ref<Tab>("shots");
const tabs = computed(() => {
  const t: { value: Tab; label: string; count?: number }[] = [];
  if (images.value.length) t.push({ value: "shots", label: "Shots", count: images.value.length });
  if (texts.value.length) t.push({ value: "texts", label: "Texts", count: texts.value.length });
  t.push({ value: "log", label: "Log", count: doc.value?.log.length ?? 0 });
  if (collectors.value.length) t.push({ value: "collectors", label: "Collectors", count: collectors.value.length });
  if (files.value.length) t.push({ value: "files", label: "Files", count: files.value.length });
  if (videos.value.length) t.push({ value: "video", label: "Video" });
  if (trace.value) t.push({ value: "trace", label: "Trace" });
  return t;
});
watch(tabs, (t) => {
  if (!t.some((x) => x.value === tab.value)) tab.value = t[0]?.value ?? "log";
});

// Steps on a timeline, in the Steps card and under each video. The playhead follows the video as
// it plays; picking a step or moving the playhead seeks the video, which starts about when the
// attempt does.
const steps = computed(() => (doc.value ? attemptSteps(doc.value) : []));
const marks = computed(() => (doc.value ? logMarks(doc.value) : []));
const span = computed(() => {
  const d = doc.value;
  if (!d) return 0;
  const end = d.durationMs ?? Math.max(0, ...steps.value.map((x) => x.end));
  return Math.max(end, ...steps.value.map((x) => x.end), 1);
});
const playhead = ref(0);
const players = ref<InstanceType<typeof VideoPlayer>[]>([]);
function seekVideo(ms: number) {
  if (!videos.value.length) return;
  tab.value = "video";
  void nextTick(() => players.value[0]?.seekTo(ms / 1000));
}
function pickStep(s: TimelineStep) {
  playhead.value = s.start;
  seekVideo(s.start);
}
/** The playhead moved by hand: the video follows when it is showing. */
function scrub(ms: number) {
  playhead.value = ms;
  if (tab.value === "video") for (const p of players.value) p.seekTo(ms / 1000);
}
const stepLength = (s: TimelineStep) => duration(s.end - s.start);

// "Add to review": a shot or a step goes into the review note, ready for a word about it.
const review = ref<InstanceType<typeof ReviewPanel> | null>(null);
function reviewShot(image: { name: string; url: string }) {
  const file = decodeURIComponent(image.url.split("/").pop() ?? image.name);
  open.value = null;
  review.value?.addToNote(`Shot ${file}${image.name && !file.includes(image.name) ? ` (${image.name})` : ""}: `);
}
function reviewStep(s: TimelineStep) {
  review.value?.addToNote(`Step ${s.label} at ${clock(s.start)}: `);
}

// Shots open in the image viewer; its list is every image in the order taken.
const open = ref<number | null>(null);
const openShot = (a: Artifact) => (open.value = images.value.indexOf(a));
const viewerImages = computed(() => images.value.map((a) => ({ url: a.url, name: a.name, note: a.kind === "mark" ? "mark" : a.set ? `scroll set ${a.set}` : undefined })));

// Log, filtered by level.
const logLevel = ref<"all" | "problems">("all");
const levelOptions = [
  { value: "all" as const, label: "Every line" },
  { value: "problems" as const, label: "Warnings and errors" },
];
const shownLog = computed(() => (doc.value?.log ?? []).filter((l) => logLevel.value === "all" || l.level !== "info"));
const time = (iso: string) => new Date(iso).toLocaleTimeString();

// Collectors load their records when their tab opens.
const collectorPath = ref("");
const records = ref<unknown[] | null>(null);
const recordsError = ref<string | null>(null);
watch(collectors, (c) => (collectorPath.value = c[0]?.url ?? ""), { immediate: true });
watch([tab, collectorPath], async ([t, url]) => {
  if (t !== "collectors" || !url) return;
  records.value = null;
  recordsError.value = null;
  try {
    const res = await fetch(url);
    const data = (await res.json()) as unknown;
    if (collectorPath.value === url) records.value = Array.isArray(data) ? data : [data];
  } catch {
    recordsError.value = "The records couldn't be read.";
  }
});
const collectorOptions = computed(() => collectors.value.map((c) => ({ value: c.url, label: c.name })));
const recordRows = computed(() => (records.value ?? []).map((rec, i) => ({ i, rec: rec as Record<string, unknown> })));
const recordCols = computed(() =>
  recordColumns(records.value ?? []).map((k) => ({ key: k, label: k, sortable: true, value: (r: { rec: Record<string, unknown> }) => cellOf(r.rec?.[k]) })),
);

// Files the test or its collectors saved: text ones open in the code view.
const filePath = ref("");
const fileText = ref<string | null>(null);
const fileError = ref<string | null>(null);
watch(files, (f) => (filePath.value = f.some((a) => a.url === filePath.value) ? filePath.value : (f[0]?.url ?? "")), { immediate: true });
const shownFile = computed(() => files.value.find((a) => a.url === filePath.value) ?? null);
const isText = (a: Artifact) => /^(text\/|application\/(json|xml|javascript))/.test(a.contentType);
const fileLang = computed(() => (shownFile.value?.contentType.startsWith("application/json") ? "json" : "text"));
watch([tab, filePath], async ([t, url]) => {
  fileText.value = null;
  fileError.value = null;
  const a = shownFile.value;
  if (t !== "files" || !url || !a || !isText(a)) return;
  if (a.size > TEXT_LIMIT) {
    fileError.value = `This file is ${fileSize(a.size)}, too big to show here.`;
    return;
  }
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (filePath.value === url) fileText.value = text;
  } catch {
    fileError.value = "The file couldn't be read.";
  }
});
const fileOptions = computed(() => files.value.map((a) => ({ value: a.url, label: a.name })));

const traceHref = computed(() => (trace.value ? traceViewerUrl(window.location.origin, trace.value.url) : ""));

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", { tone: "ok", timeout: 2000 });
  } catch {
    toast("The browser didn't allow copying.", { tone: "warn" });
  }
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, [contenteditable], dialog[open], .vp")) return;
  if (e.key === "j" && nextId.value) window.location.hash = linkTo(nextId.value);
  else if (e.key === "k" && prevId.value) window.location.hash = linkTo(prevId.value);
}
onMounted(() => {
  void load();
  void loadSettings();
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
watch(
  () => props.attemptId,
  () => {
    open.value = null;
    void load();
  },
);
</script>

<template>
  <main class="page">
    <p class="crumb">
      <a :href="href({ name: 'run', id: runId })"><ArrowLeft :size="15" />{{ run ? run.packName : "Run" }} <span class="num">{{ runId }}</span></a>
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="doc">
      <header class="page-head">
        <div class="title">
          <h1 class="display"><code>{{ doc.test.id }}</code> {{ doc.test.title !== doc.test.id ? doc.test.title : "" }}</h1>
          <p class="muted meta">
            <StatusChip :status="doc.status" />
            <span>attempt {{ doc.attempt.number }} of {{ doc.attempt.of }}</span>
            <span v-if="doc.attempt.try > 1">try {{ doc.attempt.try }}</span>
            <span v-if="doc.attempt.parentId">ran inside <a :href="linkTo(doc.attempt.parentId)">its parent</a></span>
            <span v-tip="when(doc.startedAt)">{{ duration(doc.durationMs) }}</span>
          </p>
        </div>
        <div class="stepper">
          <a v-tip="'Previous attempt (K)'" class="btn" :class="{ off: !prevId }" :href="prevId ? linkTo(prevId) : undefined" :aria-disabled="!prevId"><ChevronLeft :size="16" />Previous</a>
          <span v-if="at >= 0" class="muted small num">{{ at + 1 }} / {{ order.length }}</span>
          <a v-tip="'Next attempt (J)'" class="btn" :class="{ off: !nextId }" :href="nextId ? linkTo(nextId) : undefined" :aria-disabled="!nextId">Next<ChevronRight :size="16" /></a>
        </div>
      </header>

      <section v-if="description" class="card about" aria-labelledby="about-title">
        <h2 id="about-title">About this test</h2>
        <p class="about-text">{{ description }}</p>
      </section>

      <section v-if="doc.error" class="card problem" :class="{ calm: doc.error.kind === 'skipped' }" aria-labelledby="err-title">
        <h2 id="err-title">{{ doc.error.kind === "assertion" ? "A check failed" : doc.error.kind === "timeout" ? "Timed out" : doc.error.kind === "stopped" ? "Stopped" : doc.error.kind === "skipped" ? "Skipped" : "The harness couldn't go on" }}</h2>
        <pre class="msg">{{ plainText(doc.error.message) }}</pre>
        <p v-if="doc.error.stack && firstOwnFrame(doc.error.stack)" class="where small">
          In your code:
          <FileLink :file="firstOwnFrame(doc.error.stack)!.file" :label="tildify(firstOwnFrame(doc.error.stack)!.file, settings.home)" :line="firstOwnFrame(doc.error.stack)!.line" :column="firstOwnFrame(doc.error.stack)!.column" />
          <a v-if="editLink" class="editlink" :href="editLink"><Pencil :size="14" /> Edit this test</a>
        </p>
        <details v-if="doc.error.stack" class="stack">
          <summary>Stack</summary>
          <pre>{{ plainText(doc.error.stack) }}</pre>
        </details>
      </section>

      <section v-if="doc.flags.length || doc.notes.length || Object.keys(doc.metrics).length" class="card summary" aria-label="Summary">
        <div v-if="robot.length" class="block">
          <h3>Robot problems</h3>
          <ul class="flags">
            <li v-for="f in robot" :key="f.name" class="robot"><code>{{ f.name }}</code><span v-if="f.detail" class="detail">{{ f.detail }}</span></li>
          </ul>
        </div>
        <div v-if="findings.length" class="block">
          <h3>Findings</h3>
          <ul class="flags">
            <li v-for="f in findings" :key="f.name" class="finding"><code>{{ f.name }}</code><span v-if="f.detail" class="detail">{{ f.detail }}</span></li>
          </ul>
        </div>
        <div v-if="infos.length" class="block">
          <h3>Info</h3>
          <ul class="flags">
            <li v-for="f in infos" :key="f.name"><code>{{ f.name }}</code><span v-if="f.detail" class="detail">{{ f.detail }}</span></li>
          </ul>
        </div>
        <div v-if="Object.keys(doc.metrics).length" class="block">
          <h3>Metrics</h3>
          <dl class="facts">
            <template v-for="(m, k) in doc.metrics" :key="k"><dt>{{ k }}</dt><dd class="num">{{ m.value }} {{ m.unit ?? "" }}</dd></template>
          </dl>
        </div>
        <div v-if="doc.notes.length" class="block">
          <h3>Notes</h3>
          <ul class="notes">
            <li v-for="(n, i) in doc.notes" :key="i">{{ n }}</li>
          </ul>
        </div>
      </section>

      <section v-if="steps.length" class="card steps" aria-labelledby="steps-title">
        <h2 id="steps-title">Steps <span class="hint">{{ videos.length ? "Pick a step to see it in the video." : "" }}</span></h2>
        <TimelineScrubber :model-value="playhead" :steps="steps" :duration="span" :marks="marks" label="Attempt time" @update:model-value="scrub" @pick="pickStep" />
        <ol class="steplist">
          <li v-for="s in steps" :key="s.id">
            <button type="button" class="steprow" :class="{ on: playhead >= s.start && playhead < s.end }" @click="pickStep(s)">
              <span class="num muted">{{ clock(s.start) }}</span>
              <span class="st">{{ s.label }}</span>
              <span class="num muted">{{ stepLength(s) }}</span>
              <StatusChip v-if="s.status" :status="s.status" />
              <span v-else aria-hidden="true" />
            </button>
            <button v-tip="'Add to review note'" type="button" class="ibtn" :aria-label="`Add step ${s.label} to the review note`" @click="reviewStep(s)">
              <MessageSquarePlus :size="15" />
            </button>
          </li>
        </ol>
      </section>

      <div class="body">
        <section class="card tabs-card">
          <TabBar v-model="tab" :tabs="tabs" id-prefix="att" label="What the attempt saved" />

          <div v-if="tab === 'shots'" id="att-panel-shots" role="tabpanel" aria-labelledby="att-tab-shots" class="panel">
            <template v-for="(g, gi) in groups" :key="gi">
              <div v-if="g.set === null" class="gallery">
                <button v-for="a in g.shots" :key="a.url" type="button" class="thumb" :class="{ mark: a.kind === 'mark' }" @click="openShot(a)">
                  <img :src="a.url" :alt="a.name" loading="lazy" />
                  <span class="cap"><span v-if="a.kind === 'mark'" class="tag">mark</span>{{ a.name }}</span>
                </button>
              </div>
              <figure v-else class="strip">
                <figcaption><strong>{{ g.set }}</strong> <span class="muted small">scroll set · {{ g.shots.length }} {{ g.shots.length === 1 ? "shot" : "shots" }}</span></figcaption>
                <div class="strip-body">
                  <button v-for="a in g.shots" :key="a.url" v-tip="a.name" type="button" class="strip-shot" @click="openShot(a)">
                    <img :src="a.url" :alt="a.name" loading="lazy" />
                  </button>
                </div>
              </figure>
            </template>
          </div>

          <div v-else-if="tab === 'texts'" id="att-panel-texts" role="tabpanel" aria-labelledby="att-tab-texts" class="panel texts">
            <article v-for="[name, text] in texts" :key="name" class="text">
              <header>
                <h3>{{ name }}</h3>
                <span class="muted small">{{ text.length }} characters</span>
                <button class="btn small-btn" type="button" @click="copy(text)">Copy</button>
              </header>
              <pre>{{ text }}</pre>
            </article>
          </div>

          <div v-else-if="tab === 'log'" id="att-panel-log" role="tabpanel" aria-labelledby="att-tab-log" class="panel">
            <div class="filters">
              <label for="att-log-level" class="sr-only">Which lines</label>
              <SelectMenu id="att-log-level" v-model="logLevel" :options="levelOptions" />
            </div>
            <ol v-if="shownLog.length" class="log">
              <li v-for="(l, i) in shownLog" :key="i" :class="l.level"><time>{{ time(l.time) }}</time> {{ l.message }}</li>
            </ol>
            <p v-else class="muted">{{ doc.log.length ? "No lines match." : "Nothing was logged." }}</p>
          </div>

          <div v-else-if="tab === 'collectors'" id="att-panel-collectors" role="tabpanel" aria-labelledby="att-tab-collectors" class="panel">
            <div v-if="collectors.length > 1" class="filters">
              <label for="att-collector" class="sr-only">Collector</label>
              <SelectMenu id="att-collector" v-model="collectorPath" :options="collectorOptions" />
            </div>
            <p v-if="recordsError" class="error">{{ recordsError }}</p>
            <DataTable
              v-else
              :columns="recordCols"
              :rows="recordRows"
              :row-key="(r) => r.i"
              :label="collectors.find((c) => c.url === collectorPath)?.name ?? 'Records'"
              height="480px"
              :loading="records === null"
            >
              <template #empty>No records.</template>
            </DataTable>
            <p class="muted small"><a :href="collectorPath" target="_blank" rel="noopener">Open the JSON</a></p>
          </div>

          <div v-else-if="tab === 'files'" id="att-panel-files" role="tabpanel" aria-labelledby="att-tab-files" class="panel">
            <div class="file-bar">
              <label for="att-file" class="sr-only">File</label>
              <SelectMenu id="att-file" v-model="filePath" :options="fileOptions" />
              <span v-if="shownFile" class="muted small">{{ fileSize(shownFile.size) }}</span>
              <a v-if="shownFile" class="btn small-btn" :href="shownFile.url" target="_blank" rel="noopener">Open</a>
              <button v-if="fileText" class="btn small-btn" type="button" @click="copy(fileText)">Copy</button>
            </div>
            <p v-if="fileError" class="muted">{{ fileError }}</p>
            <CodeView v-else-if="fileText !== null && shownFile" :code="fileText" :lang="fileLang" :label="shownFile.name" max-height="560px" wrap />
            <p v-else-if="shownFile && !isText(shownFile)" class="muted">This file isn't text. Open it to see it.</p>
            <p v-else-if="shownFile" class="muted">Loading…</p>
          </div>

          <div v-else-if="tab === 'video'" id="att-panel-video" role="tabpanel" aria-labelledby="att-tab-video" class="panel videos">
            <div v-for="v in videos" :key="v.url" class="video">
              <VideoPlayer ref="players" :src="v.url" :label="v.name" @time="(sec) => (playhead = sec * 1000)">
                <TimelineScrubber
                  v-if="steps.length"
                  class="vtimeline"
                  :model-value="playhead"
                  :steps="steps"
                  :duration="span"
                  :marks="marks"
                  :label="`Steps in ${v.name}`"
                  @update:model-value="scrub"
                  @pick="pickStep"
                />
              </VideoPlayer>
              <p class="muted small">{{ v.name }} · {{ fileSize(v.size) }} · <a :href="v.url" download>Download</a></p>
            </div>
          </div>

          <div v-else-if="tab === 'trace' && trace" id="att-panel-trace" role="tabpanel" aria-labelledby="att-tab-trace" class="panel trace">
            <p>
              The trace holds every action of this attempt with the page before and after it, the call log, console and network. It opens in Playwright's trace viewer, served by
              Watchwright, in a new tab.
            </p>
            <p class="actions">
              <a class="btn primary" :href="traceHref" target="_blank" rel="noopener">Open in the trace viewer</a>
              <a class="btn" :href="trace.url" download>Download trace.zip</a>
              <span class="muted small">{{ fileSize(trace.size) }}</span>
            </p>
          </div>
        </section>
        <ReviewPanel ref="review" :run-id="runId" :attempt-id="attemptId" />
      </div>

      <ImageViewer v-model="open" :images="viewerImages" :label="`Shots of ${doc.test.id}`">
        <template #actions="{ image }">
          <button v-tip="'Add to review note'" type="button" class="ib" aria-label="Add to review note" @click="reviewShot(image)">
            <MessageSquarePlus :size="17" />
          </button>
        </template>
      </ImageViewer>
    </template>
    <PageSkeleton v-else-if="!error" label="Loading the attempt" :cards="2" />
  </main>
</template>

<style scoped>
.editlink {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: var(--space-3);
}
.page {
  max-width: 1440px;
}
.crumb .num {
  color: var(--muted);
}
.title h1 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  margin: var(--space-2) 0 0;
}
.stepper {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.btn.off {
  opacity: 0.45;
  pointer-events: none;
}
.problem {
  border-color: color-mix(in srgb, var(--bad) 45%, var(--line));
}
.problem h2 {
  color: var(--bad);
}
.problem.calm {
  border-color: var(--line);
}
.problem.calm h2 {
  color: var(--muted);
}
.msg,
.stack pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 13px;
}
.stack {
  margin-top: var(--space-2);
}
.where {
  margin: var(--space-2) 0 0;
  color: var(--muted);
}
.stack summary {
  cursor: pointer;
  color: var(--muted);
}
.stack pre {
  margin-top: var(--space-2);
  max-height: 300px;
  overflow: auto;
  color: var(--muted);
}
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}
.block h3 {
  margin: 0 0 var(--space-2);
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
}
.flags,
.notes {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-1);
}
.flags .detail {
  margin-left: var(--space-2);
}
.flags li {
  padding-left: var(--space-3);
  border-left: 3px solid var(--line-strong);
}
.flags li.robot {
  border-color: var(--warn);
}
.flags li.finding {
  border-color: var(--bad);
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px var(--space-4);
  margin: 0;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--space-4);
  align-items: start;
}
.steps {
  display: grid;
  gap: var(--space-3);
}
.steplist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}
.ibtn {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.ibtn:hover {
  background: var(--raised);
  color: var(--text);
}
.steplist li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.steprow {
  display: grid;
  grid-template-columns: 52px 1fr auto auto;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: 4px var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.steprow:hover,
.steprow.on {
  background: var(--raised);
}
.st {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tabs-card {
  padding-top: var(--space-2);
}
@media (max-width: 960px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}
.panel {
  padding-top: var(--space-4);
  display: grid;
  gap: var(--space-4);
}
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-3);
}
.thumb {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  text-align: left;
  cursor: zoom-in;
}
.thumb img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  object-position: top center;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
}
.thumb:hover img {
  border-color: var(--accent);
}
.thumb.mark img {
  border-color: var(--warn);
}
.cap {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.tag {
  margin-right: 6px;
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: color-mix(in srgb, var(--warn) 18%, transparent);
  color: var(--text);
  font-size: 11px;
}
.strip {
  margin: 0;
  display: grid;
  gap: var(--space-2);
}
.strip-body {
  display: grid;
  max-width: 720px;
  max-height: 70vh;
  overflow-y: auto;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
}
.strip-shot {
  display: block;
  padding: 0;
  border: 0;
  border-bottom: 1px dashed var(--line-strong);
  background: none;
  cursor: zoom-in;
}
.strip-shot:last-child {
  border-bottom: 0;
}
.strip-shot img {
  display: block;
  width: 100%;
}
.texts {
  gap: var(--space-3);
}
.text header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.text h3 {
  margin: 0;
  font-size: 14px;
}
.small-btn {
  margin-left: auto;
  padding: 2px 10px;
  font-size: 13px;
}
.text pre {
  margin: 0;
  padding: var(--space-3);
  max-height: 360px;
  overflow: auto;
  border-radius: var(--radius);
  background: var(--raised);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 13px;
}
.filters {
  display: flex;
  gap: var(--space-2);
}
.filters > :not(label) {
  width: 220px;
}
.steps h2 {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.steps .hint {
  font-weight: normal;
  margin-left: var(--space-2);
}
.about h2 {
  margin: 0 0 var(--space-2);
  font-size: 13px;
  color: var(--muted);
}
.about-text {
  margin: 0;
  max-width: 90ch;
  white-space: pre-line;
}
.file-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.file-bar > :nth-child(2) {
  width: min(420px, 100%);
}
.log {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 520px;
  overflow-y: auto;
  font-family: var(--font-mono);
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
.videos {
  max-width: 960px;
}
.video p {
  margin: var(--space-1) 0 0;
}
.trace p {
  margin: 0;
  max-width: 68ch;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
@media (max-width: 640px) {
  .stepper {
    width: 100%;
    justify-content: space-between;
  }
  .gallery {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .filters > :not(label) {
    width: 100%;
  }
}
</style>
