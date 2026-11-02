<script setup lang="ts">
// The public dashboard (#/status): for each pack an admin picked, how its latest run went and
// the trend of its last runs, for anyone who can reach the server (docs/plans/self-hosting.md,
// section 4). With "open runs" on, each run opens read-only at #/status/<id>.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Globe } from "../icons";
import { getJson, type PublicStatus } from "../api";
import { countsText, duration, when } from "../format";
import EmptyState from "../components/EmptyState.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import StatusChip from "../components/StatusChip.vue";
import { resetHead, setTitle } from "../pagehead";
import { href } from "../router";
import { runTone } from "../runstate";
import { vTip } from "../tooltip";
import TileGroups from "../components/TileGroups.vue";
import { provideTileLinks } from "../tilelinks";

type StatusRun = PublicStatus["packs"][number]["runs"][number];

const status = ref<PublicStatus | null>(null);
const error = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
// A tile's runs and attempts open read-only when the page lets its runs open; nothing else links.
provideTileLinks({
  run: (id) => (status.value?.linkRuns ? href({ name: "status-run", id }) : null),
  attempt: (runId) => (status.value?.linkRuns ? href({ name: "status-run", id: runId }) : null),
  actions: false,
});

async function load() {
  const res = await getJson<PublicStatus>("/api/v1/public/status");
  if (!res.ok) {
    error.value = res.error.code === "dashboard_off" || res.error.code === "http_404" ? "This server has no public status page." : res.error.message;
    return;
  }
  error.value = null;
  status.value = res.data;
  setTitle(res.data.title);
}
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 60_000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  resetHead();
});

const tone = (r: StatusRun) => runTone({ ...r, packName: "" }, null) ?? "rest";
const tickText = (r: StatusRun) => [r.label || r.id, r.status === "finished" ? countsText(r.counts) : r.status.replaceAll("_", " "), r.startedAt ? when(r.startedAt) : ""].filter(Boolean).join(" · ");
const runLink = (r: StatusRun) => (status.value?.linkRuns ? href({ name: "status-run", id: r.id }) : undefined);

// The latest run first in the card; the trend oldest to newest, left to right.
const cards = computed(() => (status.value?.packs ?? []).map((p) => ({ ...p, latest: p.runs[0] ?? null, trend: p.runs.slice().reverse(), hasTiles: !!p.tiles?.length })));
</script>

<template>
  <main class="page status">
    <section v-if="error" class="card">
      <EmptyState :icon="Globe" heading="Nothing to see here">{{ error }}</EmptyState>
    </section>
    <PageSkeleton v-else-if="!status" label="Loading the status" :cards="2" />
    <template v-else>
      <header class="page-head">
        <div>
          <h1 class="display">{{ status.title }}</h1>
          <p class="muted">How the latest runs went. Updates every minute.</p>
        </div>
      </header>
      <section v-if="!cards.length" class="card">
        <EmptyState compact :icon="Globe" heading="No packs shown yet">An admin picks the packs this page shows in Settings, Sharing.</EmptyState>
      </section>
      <div v-else class="cards">
        <section v-for="p in cards" :key="p.packId" class="card pack" :class="{ wide: p.hasTiles }" :aria-labelledby="`st-${p.packId}`">
          <div class="top">
            <h2 :id="`st-${p.packId}`" class="display">{{ p.name }}</h2>
            <StatusChip v-if="p.latest" :status="p.latest.status" />
          </div>
          <template v-if="p.latest">
            <p class="muted small">
              {{ countsText(p.latest.counts) }}
              <template v-if="p.latest.startedAt"> · {{ when(p.latest.startedAt) }}</template>
              <template v-if="p.latest.durationMs !== null"> · took {{ duration(p.latest.durationMs) }}</template>
            </p>
            <ul class="trend" :aria-label="`Last ${p.trend.length} runs of ${p.name}`">
              <li v-for="r in p.trend" :key="r.id">
                <a v-if="runLink(r)" v-tip="tickText(r)" class="tick" :class="tone(r)" :href="runLink(r)" :aria-label="tickText(r)" />
                <span v-else v-tip="tickText(r)" class="tick" :class="tone(r)" tabindex="0" :aria-label="tickText(r)" />
              </li>
            </ul>
            <a v-if="runLink(p.latest)" class="small" :href="runLink(p.latest)">See the latest run</a>
          </template>
          <p v-else class="muted small">No runs yet.</p>
          <TileGroups v-if="p.hasTiles" class="ptiles" :groups="p.tiles!" :pack-id="p.packId" />
        </section>
      </div>
      <p class="muted small foot">Shown by Watchwright.</p>
    </template>
  </main>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}
.pack {
  display: grid;
  gap: var(--space-2);
  align-content: start;
}
/* A pack with tiles takes the whole row. */
.pack.wide {
  grid-column: 1 / -1;
}
.ptiles {
  margin-top: var(--space-2);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.top h2 {
  margin: 0;
  font-size: 16px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pack p {
  margin: 0;
}
.trend {
  display: flex;
  gap: 3px;
  margin: var(--space-1) 0;
  padding: 0;
  list-style: none;
}
.trend li {
  display: flex;
}
.tick {
  display: block;
  width: 8px;
  height: 24px;
  border-radius: 2px;
  background: var(--line-strong);
}
.tick.ok {
  background: var(--ok);
}
.tick.bad {
  background: var(--bad);
}
.tick.warn {
  background: var(--warn);
}
.tick.accent {
  background: var(--accent);
}
.tick.paused {
  background: var(--paused);
}
.tick:hover,
.tick:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.foot {
  margin: 0;
  text-align: center;
}
@media (max-width: 640px) {
  .cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
