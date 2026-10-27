<script setup lang="ts">
// Start a run: a pack, its tests (none chosen means all), parameter values and options.
// `?pack=<id>` picks the pack, and `&from=<run id>` copies an earlier run's tests and values.
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { getJson, sendJson, type Pack, type ParamValue, type RunSummary } from "../api";
import { replaceRoute } from "../router";
import CheckBox from "../components/CheckBox.vue";
import NumberInput from "../components/NumberInput.vue";
import SelectMenu from "../components/SelectMenu.vue";
import TextField from "../components/TextField.vue";

const props = defineProps<{ query: Record<string, string> }>();

const packs = ref<Pack[]>([]);
const loaded = ref(false);
const loadError = ref<string | null>(null);
const packId = ref<string>("");
const chosen = ref<Set<string>>(new Set());
const params = reactive<Record<string, ParamValue>>({});
const pauseOnBroken = ref(true);
const startError = ref<string | null>(null);
const starting = ref(false);
const copiedFrom = ref<string | null>(null);

const pack = computed(() => packs.value.find((p) => p.id === packId.value) ?? null);
const packOptions = computed(() => packs.value.map((p) => ({ value: p.id, label: p.status === "error" ? `${p.name} (doesn't load)` : p.name })));
const sections = computed(() => {
  const out = new Map<string, Pack["tests"]>();
  for (const t of pack.value?.tests ?? []) {
    if (t.inside) continue; // children run inside their parent
    const key = t.section ?? "Tests";
    out.set(key, [...(out.get(key) ?? []), t]);
  }
  return [...out.entries()];
});

function defaults(p: Pack) {
  for (const k of Object.keys(params)) delete params[k];
  for (const [k, d] of Object.entries(p.params)) params[k] = d.default ?? d.choices?.[0] ?? (d.type === "number" ? 0 : d.type === "boolean" ? false : "");
}

watch(pack, (p, old) => {
  if (!p || p.id === old?.id) return;
  chosen.value = new Set();
  copiedFrom.value = null;
  defaults(p);
  replaceRoute({ name: "new", query: { pack: p.id } });
});

onMounted(async () => {
  const res = await getJson<Pack[]>("/api/v1/packs");
  loaded.value = true;
  if (!res.ok) return void (loadError.value = res.error.message);
  packs.value = res.data;
  const wanted = res.data.find((p) => p.id === props.query.pack) ?? res.data.find((p) => p.status === "ok") ?? res.data[0];
  if (!wanted) return;
  packId.value = wanted.id;
  const from = props.query.from;
  if (from && /^[0-9a-f]{8}$/.test(from)) {
    const run = await getJson<RunSummary>(`/api/v1/runs/${from}`);
    if (run.ok && run.data.packId === wanted.id) {
      // Wait for the pack watcher to set defaults, then copy the run's choices over them.
      await nextTick();
      const known = new Set(wanted.tests.map((t) => t.id));
      chosen.value = new Set(run.data.tests.filter((t) => known.has(t)));
      for (const [k, v] of Object.entries(run.data.params)) if (k in params) params[k] = v;
      copiedFrom.value = from;
      replaceRoute({ name: "new", query: { pack: wanted.id, from } });
    }
  }
});

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
  if (!res.ok) return void (startError.value = res.error.message);
  window.location.hash = `#/runs/${res.data.id}`;
}
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h1 class="display">New run</h1>
        <p class="muted">Pick the tests to run and the values for this run. Nothing chosen runs every test.</p>
      </div>
    </div>
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>

    <section v-if="loaded && packs.length === 0" class="card">
      <p class="muted">There are no packs yet. Add the folder of a test pack first.</p>
      <a class="btn primary" href="#/packs">Add a pack</a>
    </section>

    <template v-else-if="pack">
      <section class="card pick">
        <label class="lbl" for="nr-pack">Pack</label>
        <SelectMenu id="nr-pack" v-model="packId" :options="packOptions" />
        <span class="muted small">{{ pack.tests.length }} tests · {{ pack.browser }}<template v-if="pack.baseURL"> · {{ pack.baseURL }}</template></span>
        <span v-if="copiedFrom" class="muted small">Tests and values copied from run <a :href="`#/runs/${copiedFrom}`" class="num">{{ copiedFrom }}</a>.</span>
      </section>

      <section v-if="pack.status === 'error'" class="card">
        <p class="error">This pack doesn't load: {{ pack.error }}</p>
        <a class="btn" :href="`#/packs/${pack.id}`">Open the pack</a>
      </section>

      <div v-else class="cols">
        <section class="card" aria-labelledby="nr-tests">
          <h2 id="nr-tests" class="display">Tests <span class="muted small">{{ chosen.size ? `${chosen.size} chosen` : "all" }}</span></h2>
          <div v-for="[section, tests] in sections" :key="section" class="section">
            <p class="label">{{ section }}</p>
            <CheckBox v-for="t in tests" :key="t.id" class="test" :model-value="chosen.has(t.id)" @update:model-value="toggle(t.id)">
              <code>{{ t.id }}</code> {{ t.title !== t.id ? t.title : "" }}
              <span v-if="t.needs.length" class="muted small">needs {{ t.needs.join(", ") }}</span>
            </CheckBox>
          </div>
        </section>
        <section class="card settings" aria-labelledby="nr-settings">
          <h2 id="nr-settings" class="display">Values</h2>
          <p v-if="Object.keys(pack.params).length === 0" class="muted small">This pack has no parameters.</p>
          <div v-for="(d, key) in pack.params" :key="key" class="param">
            <label class="name" :for="`p-${key}`">{{ key }}</label>
            <SelectMenu v-if="d.choices" :id="`p-${key}`" v-model="params[key]!" :options="d.choices.map((c) => ({ value: c, label: String(c) }))" />
            <NumberInput v-else-if="d.type === 'number'" :id="`p-${key}`" v-model="params[key] as number" :label="String(key)" />
            <CheckBox v-else-if="d.type === 'boolean'" :id="`p-${key}`" v-model="params[key] as boolean">{{ d.description ?? "On" }}</CheckBox>
            <TextField v-else :id="`p-${key}`" v-model="params[key] as string" />
            <span v-if="d.description && d.type !== 'boolean'" class="muted small">{{ d.description }}</span>
          </div>
          <p class="label opts">Options</p>
          <CheckBox v-model="pauseOnBroken">Pause when a test breaks, and wait for Retry or Skip</CheckBox>
        </section>
      </div>

      <div v-if="pack.status === 'ok'" class="go">
        <button class="btn primary" :disabled="starting" @click="start">{{ starting ? "Starting…" : "Start run" }}</button>
        <span v-if="startError" class="error" role="alert">{{ startError }}</span>
      </div>
    </template>
  </main>
</template>

<style scoped>
.pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
.pick .lbl {
  font-weight: 600;
}
.pick > :deep(.sel) {
  min-width: 240px;
}
.cols {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: var(--space-4);
  align-items: start;
}
.section + .section {
  margin-top: var(--space-3);
}
.section .label {
  margin-bottom: 2px;
}
.test {
  display: flex;
  padding: 3px 0;
}
.param {
  display: grid;
  gap: 4px;
  margin-bottom: var(--space-3);
}
.param .name {
  font-weight: 600;
  font-size: 13px;
}
.opts {
  margin: var(--space-2) 0 var(--space-2);
}
.go {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
@media (max-width: 720px) {
  .cols {
    grid-template-columns: 1fr;
  }
  .pick > :deep(.sel) {
    min-width: 0;
    flex: 1;
  }
}
</style>
