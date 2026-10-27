<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { getJson, sendJson, type Pack, type ParamValue, type RunSummary } from "../api";
import { LiveConnection } from "../live";
import CheckBox from "../components/CheckBox.vue";
import NumberInput from "../components/NumberInput.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusChip from "../components/StatusChip.vue";

const packs = ref<Pack[]>([]);
const runs = ref<RunSummary[]>([]);
const loadError = ref<string | null>(null);
const newPath = ref("");
const addError = ref<string | null>(null);
const adding = ref(false);

const packId = ref<string | null>(null);
const chosen = ref<Set<string>>(new Set());
const params = reactive<Record<string, ParamValue>>({});
const pauseOnBroken = ref(true);
const startError = ref<string | null>(null);
const starting = ref(false);

const pack = computed(() => packs.value.find((p) => p.id === packId.value) ?? null);
const sections = computed(() => {
  const out = new Map<string, Pack["tests"]>();
  for (const t of pack.value?.tests ?? []) {
    if (t.inside) continue; // children run inside their parent
    const key = t.section ?? "Tests";
    out.set(key, [...(out.get(key) ?? []), t]);
  }
  return [...out.entries()];
});

async function load() {
  const [p, r] = await Promise.all([getJson<Pack[]>("/api/v1/packs"), getJson<RunSummary[]>("/api/v1/runs?limit=50")]);
  if (!p.ok) loadError.value = p.error.message;
  else {
    loadError.value = null;
    packs.value = p.data;
    if (!packId.value && p.data.length > 0) packId.value = p.data[0]!.id;
  }
  if (r.ok) runs.value = r.data;
}

watch(pack, (p, old) => {
  if (!p || p.id === old?.id) return;
  chosen.value = new Set();
  for (const k of Object.keys(params)) delete params[k];
  for (const [k, d] of Object.entries(p.params)) params[k] = d.default ?? d.choices?.[0] ?? (d.type === "number" ? 0 : d.type === "boolean" ? false : "");
});

async function addPack() {
  addError.value = null;
  adding.value = true;
  const res = await sendJson<Pack>("/api/v1/packs", { path: newPath.value.trim() });
  adding.value = false;
  if (!res.ok) {
    addError.value = res.error.message;
    return;
  }
  newPath.value = "";
  await load();
  packId.value = res.data.id;
}

async function reloadPack(id: string) {
  await sendJson(`/api/v1/packs/${id}/reload`);
  await load();
}

function toggle(id: string) {
  const next = new Set(chosen.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  chosen.value = next;
}

async function start() {
  if (!pack.value) return;
  startError.value = null;
  starting.value = true;
  const res = await sendJson<RunSummary>("/api/v1/runs", { packId: pack.value.id, tests: [...chosen.value], params: { ...params }, pauseOnBroken: pauseOnBroken.value });
  starting.value = false;
  if (!res.ok) {
    startError.value = res.error.message;
    return;
  }
  window.location.hash = `#/runs/${res.data.id}`;
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "–";
}
function summary(r: RunSummary) {
  const c = r.counts;
  const parts = [`${c.passed} passed`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.broken) parts.push(`${c.broken} broken`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  return `${parts.join(", ")} of ${c.planned}`;
}

let live: LiveConnection | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  void load();
  // Any run or pack event refreshes the lists (debounced).
  live = new LiveConnection(
    {},
    {
      onEvent: (e) => {
        if (!/^(run|pack)\./.test(e.type)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void load(), 250);
      },
    },
  );
});
onBeforeUnmount(() => {
  live?.close();
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <main class="page">
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>

    <section class="card" aria-labelledby="packs-title">
      <h2 id="packs-title" class="display">Packs</h2>
      <ul v-if="packs.length" class="packs">
        <li v-for="p in packs" :key="p.id" :class="{ sel: p.id === packId }">
          <button class="pick" :aria-pressed="p.id === packId" @click="packId = p.id">
            <span class="pname">{{ p.name }}</span>
            <span class="psub">{{ p.tests.length }} tests · {{ p.browser }}<template v-if="p.baseURL"> · {{ p.baseURL }}</template></span>
          </button>
          <StatusChip v-if="p.status === 'error'" status="failed" />
          <button class="btn" title="Build the pack again" @click="reloadPack(p.id)">Reload</button>
          <div v-if="p.status === 'error'" class="perr">
            <p>{{ p.error }}</p>
            <ul v-if="p.problems.length">
              <li v-for="(x, i) in p.problems" :key="i"><code>{{ x }}</code></li>
            </ul>
          </div>
        </li>
      </ul>
      <p v-else class="muted">No packs yet. Add the folder of a test pack (the folder with its <code>pack.ts</code>).</p>
      <form class="add" @submit.prevent="addPack">
        <label class="sr" for="pack-path">Pack folder</label>
        <input id="pack-path" v-model="newPath" class="field" placeholder="Absolute path, e.g. D:\sites\shop\watchwright" autocomplete="off" />
        <button class="btn" type="submit" :disabled="!newPath.trim() || adding">{{ adding ? "Adding…" : "Add pack" }}</button>
      </form>
      <p v-if="addError" class="error" role="alert">{{ addError }}</p>
    </section>

    <section v-if="pack && pack.status === 'ok'" class="card" aria-labelledby="start-title">
      <h2 id="start-title" class="display">Start a run of {{ pack.name }}</h2>
      <div class="cols">
        <fieldset>
          <legend>Tests <span class="muted">({{ chosen.size ? `${chosen.size} chosen` : "all" }})</span></legend>
          <div v-for="[section, tests] in sections" :key="section" class="section">
            <p class="sec">{{ section }}</p>
            <CheckBox v-for="t in tests" :key="t.id" class="test" :model-value="chosen.has(t.id)" @update:model-value="toggle(t.id)">
              <code>{{ t.id }}</code> {{ t.title !== t.id ? t.title : "" }}
              <span v-if="t.needs.length" class="muted">needs {{ t.needs.join(", ") }}</span>
            </CheckBox>
          </div>
        </fieldset>
        <fieldset>
          <legend>Settings</legend>
          <div v-for="(d, key) in pack.params" :key="key" class="param">
            <label class="name" :for="`p-${key}`">{{ key }}</label>
            <SelectMenu v-if="d.choices" :id="`p-${key}`" v-model="params[key]!" :options="d.choices.map((c) => ({ value: c, label: String(c) }))" />
            <NumberInput v-else-if="d.type === 'number'" :id="`p-${key}`" v-model="params[key] as number" :label="String(key)" />
            <CheckBox v-else-if="d.type === 'boolean'" :id="`p-${key}`" v-model="params[key] as boolean">{{ d.description ?? "On" }}</CheckBox>
            <input v-else :id="`p-${key}`" v-model="params[key]" class="field" />
            <span v-if="d.description && d.type !== 'boolean'" class="muted small">{{ d.description }}</span>
          </div>
          <CheckBox v-model="pauseOnBroken" class="test">Pause when a test breaks, and wait for Retry or Skip</CheckBox>
        </fieldset>
      </div>
      <div class="go">
        <button class="btn primary" :disabled="starting" @click="start">{{ starting ? "Starting…" : "Start run" }}</button>
        <span v-if="startError" class="error" role="alert">{{ startError }}</span>
      </div>
    </section>

    <section class="card" aria-labelledby="runs-title">
      <h2 id="runs-title" class="display">Runs</h2>
      <table v-if="runs.length" class="runs">
        <thead>
          <tr><th>Run</th><th>Status</th><th>Results</th><th>Started</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id">
            <td><a :href="`#/runs/${r.id}`">{{ r.packName }}</a> <span class="muted small">{{ r.id }}</span></td>
            <td><StatusChip :status="r.status" /></td>
            <td>{{ summary(r) }}</td>
            <td class="muted">{{ when(r.startedAt ?? r.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">No runs yet.</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px;
  display: grid;
  gap: 16px;
}
.card {
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  padding: 18px 20px;
  min-width: 0;
}
.card h2 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 13px;
}
.error {
  color: var(--bad);
  margin: 8px 0 0;
}
.packs {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: grid;
  gap: 8px;
}
.packs > li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  padding: 8px 10px;
}
.packs > li.sel {
  border-color: var(--accent);
}
.pick {
  flex: 1;
  min-width: 0;
  display: grid;
  text-align: left;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
.pname {
  font-weight: 600;
}
.psub {
  color: var(--muted);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.perr {
  flex-basis: 100%;
  color: var(--bad);
  font-size: 13px;
}
.perr p {
  margin: 0;
}
.add {
  display: flex;
  gap: 8px;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.cols {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
}
fieldset {
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  margin: 0;
  padding: 10px 12px;
  min-width: 0;
}
legend {
  padding: 0 4px;
  font-weight: 600;
}
.sec {
  margin: 6px 0 2px;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.test {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  cursor: pointer;
}
.param {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}
.param .name {
  font-weight: 600;
  font-size: 13px;
}
.go {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.runs {
  width: 100%;
  border-collapse: collapse;
}
.runs th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  font-size: 13px;
  padding: 4px 8px 4px 0;
}
.runs td {
  padding: 6px 8px 6px 0;
  border-top: var(--border-width) solid var(--line);
}
@media (max-width: 720px) {
  .page {
    padding: 16px;
  }
  .cols {
    grid-template-columns: 1fr;
  }
  .add {
    flex-direction: column;
  }
  .runs thead {
    display: none;
  }
  .runs tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    border-top: var(--border-width) solid var(--line);
    padding: 6px 0;
  }
  .runs td {
    border: 0;
    padding: 0;
  }
}
</style>
