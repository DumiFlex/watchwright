<script setup lang="ts">
// Packs: every pack the server knows, whether it loads, and a form to add one by its folder.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getJson, sendJson, type Pack } from "../api";
import { ago, when } from "../format";
import { LiveConnection } from "../live";
import StatusChip from "../components/StatusChip.vue";
import TextField from "../components/TextField.vue";
import { vTip } from "../tooltip";

const packs = ref<Pack[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const newPath = ref("");
const addError = ref<string | null>(null);
const adding = ref(false);
const reloading = ref<string | null>(null);

async function load() {
  const res = await getJson<Pack[]>("/api/v1/packs");
  loading.value = false;
  if (!res.ok) return void (loadError.value = res.error.message);
  loadError.value = null;
  packs.value = res.data;
}

async function addPack() {
  addError.value = null;
  adding.value = true;
  const res = await sendJson<Pack>("/api/v1/packs", { path: newPath.value.trim() });
  adding.value = false;
  if (!res.ok) return void (addError.value = res.error.message);
  newPath.value = "";
  window.location.hash = `#/packs/${res.data.id}`;
}

async function reload(id: string) {
  reloading.value = id;
  await sendJson(`/api/v1/packs/${id}/reload`);
  reloading.value = null;
  await load();
}

function sections(p: Pack): string {
  const s = new Set(p.tests.map((t) => t.section).filter((x): x is string => !!x));
  return s.size ? `${s.size} section${s.size === 1 ? "" : "s"}` : "";
}

let live: LiveConnection | null = null;
onMounted(() => {
  void load();
  live = new LiveConnection({}, { onEvent: (e) => e.type.startsWith("pack.") && void load() });
});
onBeforeUnmount(() => live?.close());
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h1 class="display">Packs</h1>
        <p class="muted">A pack is a folder of tests for one site. The server builds it again when its files change.</p>
      </div>
    </div>
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>

    <p v-if="loading" class="muted">Loading…</p>
    <ul v-else-if="packs.length" class="packs">
      <li v-for="p in packs" :key="p.id" class="card pk">
        <div class="top">
          <a class="pname display" :href="`#/packs/${p.id}`">{{ p.name }}</a>
          <StatusChip v-if="p.status === 'error'" status="failed" />
        </div>
        <p v-if="p.description" class="desc">{{ p.description }}</p>
        <p class="facts muted small">
          {{ p.tests.length }} tests<template v-if="sections(p)"> · {{ sections(p) }}</template> · {{ p.browser }}<template v-if="p.baseURL"> · {{ p.baseURL }}</template>
        </p>
        <p class="path small"><code v-tip="p.path">{{ p.path }}</code></p>
        <p v-if="p.status === 'error'" class="error small">{{ p.error }}</p>
        <div class="acts">
          <a class="btn primary" :href="`#/new?pack=${p.id}`" :aria-disabled="p.status === 'error'" :class="{ off: p.status === 'error' }">New run</a>
          <button v-tip="'Build the pack again now'" class="btn" :disabled="reloading === p.id" @click="reload(p.id)">{{ reloading === p.id ? "Reloading…" : "Reload" }}</button>
          <span v-if="p.loadedAt" v-tip="when(p.loadedAt)" class="muted small">built {{ ago(p.loadedAt) }}</span>
        </div>
      </li>
    </ul>
    <p v-else class="muted">No packs yet.</p>

    <section class="card" aria-labelledby="add-title">
      <h2 id="add-title" class="display">Add a pack</h2>
      <form class="add" @submit.prevent="addPack">
        <label class="sr-only" for="pack-path">Pack folder</label>
        <TextField id="pack-path" v-model="newPath" placeholder="Absolute path of the folder with pack.ts, e.g. D:\sites\shop\watchwright" :invalid="!!addError" />
        <button class="btn primary" type="submit" :disabled="!newPath.trim() || adding">{{ adding ? "Adding…" : "Add pack" }}</button>
      </form>
      <p v-if="addError" class="error small" role="alert">{{ addError }}</p>
      <p class="muted small hint">Pack code runs on this machine with your rights, so add only packs you trust.</p>
    </section>
  </main>
</template>

<style scoped>
.packs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}
.pk {
  display: grid;
  align-content: start;
  gap: var(--space-1);
}
.pk p {
  margin: 0;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.pname {
  font-size: 16px;
  color: var(--text);
  text-decoration: none;
}
.pname:hover {
  color: var(--accent-text);
}
.path code {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}
.acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.acts a.btn {
  text-decoration: none;
}
.btn.off {
  opacity: 0.5;
  pointer-events: none;
}
.add {
  display: flex;
  gap: var(--space-2);
}
.add > :first-child {
  flex: 1;
}
.hint {
  margin: var(--space-2) 0 0;
}
@media (max-width: 720px) {
  .add {
    flex-direction: column;
  }
}
</style>
