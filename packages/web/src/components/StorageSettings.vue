<script setup lang="ts">
// Admin > Storage (users see it on Settings): how full the drive with the data folder is, what runs take, the largest
// runs, and the free space below which runs warn and then stop recording videos.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getJson, runName, sendJson, type CleanupPlan, type CompressJob, type FfmpegFetchReport, type StorageReport, type VideoEncoderMode, type VideoQuality, type VideoReport } from "../api";
import { countsText, fileSize, when } from "../format";
import { tildify } from "../paths";
import { saveSettings, settings } from "../settings";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import ModalDialog from "./ModalDialog.vue";
import NumberInput from "./NumberInput.vue";
import ProgressBar from "./ProgressBar.vue";
import RadioGroup from "./RadioGroup.vue";
import StatusChip from "./StatusChip.vue";

const report = ref<StorageReport | null>(null);
const plan = ref<CleanupPlan | null>(null);
const error = ref<string | null>(null);

async function load() {
  const [res, p] = await Promise.all([getJson<StorageReport>("/api/v1/storage"), getJson<CleanupPlan>("/api/v1/storage/cleanup")]);
  if (res.ok) {
    report.value = res.data;
    error.value = null;
  } else error.value = res.error.message;
  if (p.ok) plan.value = p.data;
}
onMounted(() => {
  void load();
  void loadVideos();
});

// Videos: the quality runs record at, and Compress kept videos.
const videos = ref<VideoReport | null>(null);
let poll: ReturnType<typeof setTimeout> | null = null;
async function loadVideos() {
  const res = await getJson<VideoReport>("/api/v1/storage/videos");
  if (res.ok) videos.value = res.data;
  if (poll) clearTimeout(poll);
  poll = null;
  // While a job goes (or attempt videos are being encoded), its progress every 2 seconds; at the end the run sizes changed too.
  if (res.ok && (res.data.job?.state === "running" || res.data.finishing.pending > 0 || res.data.ffmpegFetch.state === "downloading"))
    poll = setTimeout(() => {
      void loadVideos().then(() => {
        if (videos.value?.job?.state !== "running") void load();
      });
    }, 2000);
}
onBeforeUnmount(() => poll && clearTimeout(poll));

const qualityOptions: { value: VideoQuality; label: string; note: string }[] = [
  { value: "high", label: "High", note: "Sharp text and every frame the browser sends, for videos people watch. About the size of Full on busy pages, far less on still ones." },
  { value: "full", label: "Full", note: "What Playwright records." },
  { value: "compact", label: "Compact", note: "Same size and smoothness, about 80% smaller. Text stays sharp." },
  { value: "small", label: "Small", note: "3/4 of the size and 10 frames a second, about 94% smaller. Text stays readable." },
];
const quality = computed<VideoQuality>({
  get: () => (settings.values["runs.videoQuality"] as VideoQuality | undefined) ?? "full",
  set: (v) =>
    void saveSettings({ "runs.videoQuality": v }).then((err) => {
      if (err) toast(err, { tone: "bad" });
      void loadVideos();
    }),
});
const fpsOptions: { value: string; label: string; note?: string }[] = [
  { value: "0", label: "Every frame", note: "All the browser sends: Chromium up to about 60 a second, Firefox fewer when the page is busy." },
  { value: "60", label: "60 a second" },
  { value: "30", label: "30 a second" },
  { value: "15", label: "15 a second" },
  { value: "10", label: "10 a second", note: "Enough to follow what happens, at a fraction of the room." },
];
const fps = computed<string>({
  get: () => String((settings.values["runs.videoFps"] as number | undefined) ?? 0),
  set: (v) =>
    void saveSettings({ "runs.videoFps": Number(v) }).then((err) => {
      if (err) toast(err, { tone: "bad" });
    }),
});
const encoderOptions: { value: VideoEncoderMode; label: string; note: string }[] = [
  { value: "auto", label: "Automatic", note: "The graphics card (AV1) when a full ffmpeg on this machine can use it, else the CPU (VP9). The card's video encoder is separate from the part that runs AI models." },
  { value: "cpu", label: "CPU only", note: "Always Playwright's ffmpeg on the CPU, at the lowest priority so tests come first." },
];
const encoderMode = computed<VideoEncoderMode>({
  get: () => (settings.values["runs.videoEncoder"] as VideoEncoderMode | undefined) ?? "auto",
  set: (v) =>
    void saveSettings({ "runs.videoEncoder": v }).then((err) => {
      if (err) toast(err, { tone: "bad" });
      void loadVideos();
    }),
});
const ffmpegFetch = computed<FfmpegFetchReport | null>(() => videos.value?.ffmpegFetch ?? null);
const offerFetch = computed(() => !!videos.value && !!ffmpegFetch.value?.supported && !ffmpegFetch.value.installed && ffmpegFetch.value.state !== "downloading" && encoderMode.value === "auto" && !videos.value.finishing.gpu);
const fetchBusy = ref(false);
async function fetchCall(path: string) {
  fetchBusy.value = true;
  const res = await sendJson<FfmpegFetchReport>(`/api/v1/storage/videos/ffmpeg${path}`, {});
  fetchBusy.value = false;
  if (!res.ok) toast(res.error.message, { tone: "bad" });
  await loadVideos();
}
const job = computed<CompressJob | null>(() => videos.value?.job ?? null);
const going = computed(() => job.value?.state === "running");
const videosText = (n: number) => `${n} ${n === 1 ? "video" : "videos"}`;
const saved = (j: CompressJob) => fileSize(Math.max(0, j.beforeBytes - j.afterBytes));
const jobText = computed(() => {
  const j = job.value;
  if (!j || j.state === "running") return "";
  const head = j.state === "done" ? "Last compress" : j.state === "stopped" ? "Compress stopped" : "Compress failed";
  return `${head}, ${new Date(j.finishedAt ?? j.startedAt).toLocaleString()}: ${videosText(j.done - j.kept - j.failed)} smaller, ${saved(j)} freed.`;
});
const compressOpen = ref(false);
const starting = ref(false);
async function compress() {
  starting.value = true;
  const res = await sendJson<CompressJob>("/api/v1/storage/videos/compress", {});
  starting.value = false;
  compressOpen.value = false;
  if (!res.ok) toast(res.error.message, { tone: "bad" });
  void loadVideos();
}
async function stopCompress() {
  const res = await sendJson<CompressJob | null>("/api/v1/storage/videos/compress/stop", {});
  if (!res.ok) toast(res.error.message, { tone: "bad" });
  await loadVideos();
  void load();
}

const used = computed(() => {
  const r = report.value;
  return r && r.freeBytes !== null && r.totalBytes !== null ? r.totalBytes - r.freeBytes : null;
});
const tone = computed(() => {
  const r = report.value;
  if (!r || r.freeBytes === null) return "accent";
  if (r.freeBytes < r.limits.stopBelowGB * 1024 ** 3) return "bad";
  if (r.freeBytes < r.limits.warnBelowGB * 1024 ** 3) return "warn";
  return "accent";
});

// The limits save when a field changes; the value shown comes from the server's answer.
const warnGB = computed<number>({
  get: () => (settings.values["runs.storageWarnGB"] as number | undefined) ?? 5,
  set: (v) => void save({ "runs.storageWarnGB": v }),
});
const stopGB = computed<number>({
  get: () => (settings.values["runs.storageStopGB"] as number | undefined) ?? 1,
  set: (v) => void save({ "runs.storageStopGB": v }),
});
// Cleanup rules: 0 keeps every run.
const keepDays = computed<number>({
  get: () => (settings.values["runs.keepDays"] as number | undefined) ?? 0,
  set: (v) => void save({ "runs.keepDays": v }),
});
const keepPerPack = computed<number>({
  get: () => (settings.values["runs.keepPerPack"] as number | undefined) ?? 0,
  set: (v) => void save({ "runs.keepPerPack": v }),
});
const rulesOn = computed(() => keepDays.value > 0 || keepPerPack.value > 0);
const runsText = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;
/** "12 runs, 3.4 GB" (and how many of them aren't measured yet). */
const planText = computed(() => {
  const p = plan.value;
  if (!p) return "";
  return `${runsText(p.runs.length)}, ${fileSize(p.bytes)}${p.unmeasured ? ` and ${p.unmeasured} not measured yet` : ""}`;
});

const confirmOpen = ref(false);
const cleaning = ref(false);
async function cleanUp() {
  cleaning.value = true;
  const res = await sendJson<CleanupPlan>("/api/v1/storage/cleanup", {});
  cleaning.value = false;
  confirmOpen.value = false;
  if (!res.ok) return toast(res.error.message, { tone: "bad" });
  toast(`Deleted ${runsText(res.data.runs.length)}, ${fileSize(res.data.bytes)}`, { tone: "ok" });
  void load();
}

async function save(values: Record<string, unknown>) {
  const err = await saveSettings(values);
  if (err) toast(err, { tone: "bad" });
  else void load();
}
</script>

<template>
  <section class="card" aria-labelledby="s-storage">
    <h2 id="s-storage" class="display">Storage</h2>
    <p class="muted small">
      Runs keep their results, screenshots, videos and traces in the data folder<template v-if="report">, <code>{{ tildify(report.dataDir, settings.home) }}</code></template>. Videos take the most room.
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="report">
      <div v-if="used !== null && report.totalBytes" class="drive">
        <ProgressBar :value="used" :max="report.totalBytes" label="Drive space used" :tone="tone" />
        <p class="small">
          <strong>{{ fileSize(report.freeBytes!) }}</strong> free of {{ fileSize(report.totalBytes) }} on this drive. Runs take
          <strong>{{ fileSize(report.runsBytes) }}</strong> ({{ report.runs }} {{ report.runs === 1 ? "run" : "runs" }}<template v-if="report.unmeasured">, {{ report.unmeasured }} not measured yet</template>).
        </p>
      </div>
      <p v-else class="small">Runs take <strong>{{ fileSize(report.runsBytes) }}</strong> ({{ report.runs }} {{ report.runs === 1 ? "run" : "runs" }}). The system doesn't say how much room the drive has.</p>

      <h3 class="label">Largest runs</h3>
      <ul v-if="report.largest.length" class="largest">
        <li v-for="r in report.largest" :key="r.id">
          <a :href="`#/runs/${r.id}`" class="name">{{ runName(r) }}</a>
          <StatusChip :status="r.status" />
          <span v-tip="when(r.createdAt)" class="muted small when">{{ new Date(r.createdAt).toLocaleDateString() }} · {{ countsText(r.counts) }}</span>
          <span class="num size">{{ fileSize(r.sizeBytes ?? 0) }}</span>
        </li>
      </ul>
      <p v-else class="muted small">No run is measured yet.</p>
      <p class="muted small">Delete a run from its page or the runs list to free its room.</p>

      <h3 class="label">Videos</h3>
      <RadioGroup v-model="quality" :options="qualityOptions" label="Video quality" />
      <p class="muted small">For runs that start from now on, attempt videos and run videos alike. A pack (<code>run.videoQuality</code>) or a run (in New run) can choose its own. Which attempts keep a video (all, or only failed and broken ones) is a run option in New run.</p>
      <h3 class="label">Frame rate</h3>
      <RadioGroup v-model="fps" :options="fpsOptions" label="Frame rate" />
      <p class="muted small">At most this many frames a second in videos of runs that start from now on. It only caps: a page that stands still costs nothing either way. A pack (<code>run.videoFps</code>) or a run (in New run) can choose its own. Small keeps 10 a second at most.</p>
      <h3 class="label">Video encoder</h3>
      <RadioGroup v-model="encoderMode" :options="encoderOptions" label="Video encoder" />
      <p class="muted small">
        Attempt videos are recorded frame by frame as the browser sends them and encoded after each attempt, one at a time, so encoding never slows a test or drops frames.
        <template v-if="videos">
          Encoding now: <strong>{{ videos.finishing.encoder }}</strong><template v-if="videos.finishing.pending">, {{ videosText(videos.finishing.pending) }} waiting</template>.
          <template v-if="videos.finishing.note && encoderMode === 'auto'">{{ videos.finishing.note }}</template>
        </template>
      </p>
      <div v-if="ffmpegFetch?.state === 'downloading'" class="drive">
        <ProgressBar :value="ffmpegFetch.done" :max="Math.max(1, ffmpegFetch.total ?? ffmpegFetch.bytes)" label="ffmpeg downloaded" />
        <div class="inline">
          <span class="small grow">Downloading ffmpeg: {{ fileSize(ffmpegFetch.done) }} of {{ fileSize(ffmpegFetch.total ?? ffmpegFetch.bytes) }}. The graphics card is tried again when it's done.</span>
          <button class="btn" :disabled="fetchBusy" @click="fetchCall('/stop')">Stop</button>
        </div>
      </div>
      <div v-else-if="offerFetch && ffmpegFetch" class="inline">
        <span class="small grow">Get ffmpeg downloads a full build (about {{ fileSize(ffmpegFetch.bytes) }}) into Watchwright's data folder and checks it against its published checksum. No restart, no admin rights, nothing added to the PATH.</span>
        <button class="btn" :disabled="fetchBusy" @click="fetchCall('')">Get ffmpeg</button>
      </div>
      <div v-else-if="ffmpegFetch?.installed" class="inline">
        <span class="small grow muted">Watchwright downloaded ffmpeg into its data folder. An ffmpeg you install yourself comes first.</span>
        <button class="btn" :disabled="fetchBusy || (videos?.finishing.pending ?? 0) > 0" @click="fetchCall('/remove')">Remove ffmpeg</button>
      </div>
      <p v-if="ffmpegFetch?.state === 'failed' && ffmpegFetch.error" class="small warn-text" role="status">{{ ffmpegFetch.error }}</p>
      <p v-if="videos && !videos.ffmpeg" class="small warn-text" role="status">Playwright's ffmpeg isn't installed, so runs record no video. <code>npx playwright install ffmpeg</code> adds it.</p>
      <template v-if="videos">
        <div v-if="going && job" class="drive">
          <ProgressBar :value="job.done" :max="Math.max(1, job.total)" label="Videos compressed" />
          <div class="inline">
            <span class="small grow">Compressing {{ job.done }} of {{ videosText(job.total) }}, {{ saved(job) }} freed so far. It stops by itself when a run starts.</span>
            <button class="btn" @click="stopCompress">Stop</button>
          </div>
        </div>
        <div v-else class="inline">
          <span class="small grow">
            Runs keep <strong>{{ videosText(videos.videos) }}</strong> ({{ fileSize(videos.bytes) }}).
            <template v-if="quality === 'full' || quality === 'high'">Choose Compact or Small to compress them. Videos recorded at High are never compressed.</template>
            <template v-else-if="videos.toCompress">{{ videosText(videos.toCompress) }} ({{ fileSize(videos.toCompressBytes) }}) can get smaller.</template>
            <template v-else>All of them are {{ quality }} or smaller already.</template>
          </span>
          <button class="btn" :disabled="quality === 'full' || quality === 'high' || !videos.toCompress || !videos.ffmpeg" @click="compressOpen = true">Compress kept videos</button>
        </div>
        <p v-if="jobText" class="muted small">{{ jobText }}<template v-if="job?.reason"> {{ job.reason }}</template></p>
      </template>

      <h3 class="label">When the drive runs low</h3>
      <div class="limits">
        <div class="inline">
          <span class="small">Warn below</span>
          <span class="inline">
            <NumberInput id="s-storage-warn" v-model="warnGB" label="Warn below, in GB" :min="0" :max="100000" />
            <span class="muted small nowrap">GB free</span>
          </span>
        </div>
        <div class="inline">
          <span class="small">Stop recording videos below</span>
          <span class="inline">
            <NumberInput id="s-storage-stop" v-model="stopGB" label="Stop recording videos below, in GB" :min="0" :max="100000" />
            <span class="muted small nowrap">GB free</span>
          </span>
        </div>
      </div>
      <p class="muted small">A run checks once a minute. It says so on its page and in its log, and an alert rule can send it on. Runs never stop for it: below the second limit they go on without videos.</p>

      <h3 class="label">Clean up old runs</h3>
      <div class="limits">
        <div class="inline">
          <span class="small">Keep runs for</span>
          <span class="inline">
            <NumberInput id="s-keep-days" v-model="keepDays" label="Keep runs for, in days" :min="0" :max="36500" />
            <span class="muted small nowrap">days</span>
          </span>
        </div>
        <div class="inline">
          <span class="small">Keep the newest</span>
          <span class="inline">
            <NumberInput id="s-keep-per-pack" v-model="keepPerPack" label="Keep the newest runs of each pack" :min="0" :max="100000" />
            <span class="muted small nowrap">runs of each pack</span>
          </span>
        </div>
      </div>
      <p class="muted small">0 keeps them all. A run either rule keeps stays, and so does a run with a name and a run that is going. Once a rule is set, cleanup runs once a day.</p>
      <div v-if="rulesOn && plan" class="inline">
        <span class="small grow">
          <template v-if="plan.runs.length">Cleaning up now deletes <strong>{{ planText }}</strong>.</template>
          <template v-else>Nothing to clean up now.</template>
        </span>
        <button class="btn" :disabled="!plan.runs.length" @click="confirmOpen = true">Clean up now</button>
      </div>
    </template>
    <ModalDialog v-model="confirmOpen" heading="Delete old runs?">
      <p v-if="plan">
        This deletes <strong>{{ planText }}</strong>, the oldest from {{ plan.runs[0] ? new Date(plan.runs[0].createdAt).toLocaleDateString() : "" }}, with their results, screenshots, videos and traces. This can't be undone.
      </p>
      <ul v-if="plan" class="largest preview">
        <li v-for="r in plan.runs.slice(0, 5)" :key="r.id">
          <span class="name">{{ runName(r) }}</span>
          <span class="muted small when">{{ new Date(r.createdAt).toLocaleDateString() }} · {{ countsText(r.counts) }}</span>
          <span class="num size">{{ r.sizeBytes == null ? "" : fileSize(r.sizeBytes) }}</span>
        </li>
      </ul>
      <p v-if="plan && plan.runs.length > 5" class="muted small">And {{ runsText(plan.runs.length - 5) }} more.</p>
      <template #actions>
        <button class="btn" :disabled="cleaning" @click="confirmOpen = false">Cancel</button>
        <button class="btn danger" :disabled="cleaning" @click="cleanUp">{{ cleaning ? "Deleting…" : "Delete runs" }}</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="compressOpen" heading="Compress kept videos?">
      <p v-if="videos">
        This encodes <strong>{{ videosText(videos.toCompress) }}</strong> ({{ fileSize(videos.toCompressBytes) }}) again at the {{ quality }} quality and replaces the old files, which can't be brought back.
      </p>
      <p class="muted small dialog-note">It goes one video at a time on one core, oldest run first, and stops by itself when a run starts. A video that doesn't get smaller stays as it is.</p>
      <template #actions>
        <button class="btn" :disabled="starting" @click="compressOpen = false">Cancel</button>
        <button class="btn primary" :disabled="starting" @click="compress">{{ starting ? "Starting…" : "Compress videos" }}</button>
      </template>
    </ModalDialog>
  </section>
</template>

<style scoped>
.card {
  display: grid;
  gap: var(--space-3);
}
.card > h2:first-child,
.card p {
  margin: 0;
}
.card > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.card > .label {
  margin: var(--space-2) 0 0;
}
.drive {
  display: grid;
  gap: var(--space-2);
}
.largest {
  list-style: none;
  margin: 0;
  padding: 0;
}
.largest li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) 0;
  border-top: var(--border-width) solid var(--line);
}
.largest li:last-child {
  border-bottom: var(--border-width) solid var(--line);
}
.largest .name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.largest .when {
  grid-column: 1 / span 2;
  grid-row: 2;
}
.largest .size {
  grid-column: 3;
  grid-row: 1 / span 2;
  text-align: end;
}
.limits {
  display: grid;
  gap: var(--space-2);
}
.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.nowrap {
  white-space: nowrap;
}
.grow {
  flex: 1;
  min-width: 12em;
}
.preview {
  margin: var(--space-3) 0;
}
.card p.dialog-note {
  margin-top: var(--space-2);
}
.warn-text {
  color: var(--warn);
}
</style>
