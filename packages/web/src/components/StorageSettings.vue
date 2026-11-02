<script setup lang="ts">
// Settings > Storage: how full the drive with the data folder is, what runs take, the largest
// runs, and the free space below which runs warn and then stop recording videos.
import { computed, onMounted, ref } from "vue";
import { getJson, runName, type StorageReport } from "../api";
import { countsText, fileSize, when } from "../format";
import { tildify } from "../paths";
import { saveSettings, settings } from "../settings";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import NumberInput from "./NumberInput.vue";
import ProgressBar from "./ProgressBar.vue";
import StatusChip from "./StatusChip.vue";

const report = ref<StorageReport | null>(null);
const error = ref<string | null>(null);

async function load() {
  const res = await getJson<StorageReport>("/api/v1/storage");
  if (res.ok) {
    report.value = res.data;
    error.value = null;
  } else error.value = res.error.message;
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
    </template>
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
</style>
