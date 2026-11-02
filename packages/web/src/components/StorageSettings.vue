<script setup lang="ts">
// Admin > Storage (users see it on Settings): how full the drive with the data folder is, what runs take, the largest
// runs, and the free space below which runs warn and then stop recording videos.
import { computed, onMounted, ref } from "vue";
import { getJson, runName, sendJson, type CleanupPlan, type StorageReport } from "../api";
import { countsText, fileSize, when } from "../format";
import { tildify } from "../paths";
import { saveSettings, settings } from "../settings";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import ModalDialog from "./ModalDialog.vue";
import NumberInput from "./NumberInput.vue";
import ProgressBar from "./ProgressBar.vue";
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
onMounted(load);

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
</style>
