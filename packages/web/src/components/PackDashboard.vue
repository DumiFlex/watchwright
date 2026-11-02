<script setup lang="ts">
// A pack's dashboard on its page: the tiles the pack's `dashboard:` block sets (or the default),
// over a range of runs the person can change, with the pack's filters (a param value that applies
// to every tile) in one row above. Four columns wide, two on a narrow screen, one on a phone.
import { computed, ref, watch } from "vue";
import { getJson } from "../api";
import { filterQuery, type DashboardReply } from "../dashboard";
import { ago, when } from "../format";
import { vTip } from "../tooltip";
import SelectMenu from "./SelectMenu.vue";
import SkeletonBlock from "./SkeletonBlock.vue";
import DashboardTile from "./tiles/DashboardTile.vue";

const props = defineProps<{
  packId: string;
  /** The pack's latest run ids, newest first (for the links tile). */
  latestRuns: readonly string[];
  /** Bumped by the page when runs change, to load the numbers again. */
  stamp: number;
}>();

const reply = ref<DashboardReply | null>(null);
const error = ref<string | null>(null);
const range = ref("");
const picked = ref<Record<string, string>>({});

const rangeOptions = computed(() => {
  const own = reply.value?.dashboard;
  const base = own?.days ? `Last ${own.days} days` : `Last ${own?.runs ?? 20} runs`;
  return [
    { value: "", label: `${base} (the dashboard's)` },
    { value: "runs=10", label: "Last 10 runs" },
    { value: "runs=50", label: "Last 50 runs" },
    { value: "runs=200", label: "Last 200 runs" },
    { value: "days=7", label: "Last 7 days" },
    { value: "days=30", label: "Last 30 days" },
  ];
});

let seq = 0;
async function load() {
  const n = ++seq;
  const q = new URLSearchParams();
  if (range.value) {
    const [k, v] = range.value.split("=");
    q.set(k!, v!);
  }
  const f = filterQuery(picked.value);
  if (f) q.set("filter", f);
  const res = await getJson<DashboardReply>(`/api/v1/packs/${props.packId}/dashboard${q.size ? `?${q}` : ""}`);
  if (n !== seq) return;
  if (!res.ok) return void (error.value = res.error.message);
  error.value = null;
  reply.value = res.data;
}
watch(() => [props.packId, props.stamp], () => void load(), { immediate: true });
watch(
  () => props.packId,
  () => {
    range.value = "";
    picked.value = {};
  },
);
watch([range, picked], () => void load(), { deep: true });

const filterOptions = (f: DashboardReply["filters"][number]) => [{ value: "", label: `Any ${f.name}` }, ...f.values.map((v) => ({ value: v, label: v }))];
const setFilter = (name: string, v: string) => (picked.value = { ...picked.value, [name]: v });
const rangeText = computed(() => {
  const r = reply.value?.range;
  if (!r) return "";
  return r.count === 0 ? "No runs in range" : `${r.count} ${r.count === 1 ? "run" : "runs"}`;
});
</script>

<template>
  <section class="pack-dashboard" aria-labelledby="pd-title" :aria-busy="!reply && !error">
    <div class="pd-head">
      <h2 id="pd-title" class="display">Dashboard</h2>
      <span v-if="reply" class="muted small">
        <span v-if="reply.range.from" v-tip="`${when(reply.range.from)} to ${when(reply.range.to)}`">{{ rangeText }}, since {{ ago(reply.range.from) }}</span>
        <span v-else>{{ rangeText }}</span>
        <template v-if="reply.source === 'override' && reply.updatedBy"> · changed on this page by {{ reply.updatedBy }}</template>
        <template v-else-if="reply.source === 'default'"> · the default; a pack sets its own with <code>dashboard:</code></template>
      </span>
      <div class="pd-filters">
        <template v-for="f in reply?.filters ?? []" :key="f.name">
          <label class="sr-only" :for="`pd-f-${f.name}`">{{ f.name }}</label>
          <SelectMenu :id="`pd-f-${f.name}`" :model-value="picked[f.name] ?? ''" :options="filterOptions(f)" @update:model-value="(v: string) => setFilter(f.name, v)" />
        </template>
        <label class="sr-only" for="pd-range">Runs to show</label>
        <SelectMenu id="pd-range" v-model="range" :options="rangeOptions" />
      </div>
    </div>
    <p v-if="error" class="error small" role="alert">{{ error }}</p>
    <div v-else-if="!reply" class="pd-grid">
      <SkeletonBlock v-for="i in 3" :key="i" class="sk" shape="block" height="140px" />
    </div>
    <template v-else>
      <div v-for="(g, gi) in reply.groups" :key="gi" class="pd-group">
        <h3 v-if="g.title" class="gtitle">{{ g.title }}</h3>
        <div class="pd-grid">
          <DashboardTile v-for="(t, ti) in g.tiles" :key="`${gi}-${ti}-${t.tile.type}`" :result="t" :pack-id="packId" :latest-runs="latestRuns" />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.pack-dashboard {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.pd-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
}
.pd-head h2 {
  margin: 0;
}
.pd-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-left: auto;
}
.pd-filters .sel {
  width: auto;
  min-width: 14rem;
}
.pd-group {
  display: grid;
  gap: var(--space-2);
}
.gtitle {
  margin: var(--space-2) 0 0;
  font-size: 14px;
  font-weight: 600;
}
.pd-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}
.sk {
  grid-column: span 2;
}
p {
  margin: 0;
}
@media (max-width: 1000px) {
  .pd-grid {
    --cols: 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .pd-grid {
    --cols: 1;
    grid-template-columns: minmax(0, 1fr);
  }
  .sk {
    grid-column: span 1;
  }
  .pd-filters {
    width: 100%;
    margin-left: 0;
  }
  .pd-filters .sel {
    flex: 1 1 100%;
  }
}
</style>
