<script setup lang="ts">
// Start a run: a pack, its tests (none chosen means all), parameter values and run options.
// The planned order beside the form comes from the server (`POST /runs/preview`), so it shows
// exactly what will run, including the tests that join because a chosen one needs them.
// `?pack=<id>` picks the pack, and `&from=<run id>` copies an earlier run's choices.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { getJson, sendJson, type Pack, type ParamValue, type RunPreview, type RunSummary, type TraceMode } from "../api";
import { replaceRoute } from "../router";
import CheckBox from "../components/CheckBox.vue";
import MultiSelect from "../components/MultiSelect.vue";
import NumberInput from "../components/NumberInput.vue";
import RadioGroup from "../components/RadioGroup.vue";
import SelectMenu from "../components/SelectMenu.vue";
import TextField from "../components/TextField.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";

const props = defineProps<{ query: Record<string, string> }>();

const packs = ref<Pack[]>([]);
const loaded = ref(false);
const loadError = ref<string | null>(null);
const packId = ref<string>("");
const chosen = ref<string[]>([]);
const params = reactive<Record<string, ParamValue>>({});
const copiedFrom = ref<string | null>(null);

// Run options, filled from the pack's settings when the pack changes.
const attemptsMode = ref<"pack" | "same">("pack");
const attempts = ref(1);
const trace = ref<TraceMode>("problems");
const video = ref(true);
const pauseOnBroken = ref(true);
const pauseLimit = ref(20);

const preview = ref<RunPreview | null>(null);
const previewError = ref<string | null>(null);
const startError = ref<string | null>(null);
const starting = ref(false);

const pack = computed(() => packs.value.find((p) => p.id === packId.value) ?? null);
const packOptions = computed(() => packs.value.map((p) => ({ value: p.id, label: p.status === "error" ? `${p.name} (doesn't load)` : p.name })));
const testOptions = computed(() =>
  (pack.value?.tests ?? []).map((t) => {
    const bits = [t.inside ? `inside ${t.inside}` : "", t.needs.length ? `needs ${t.needs.join(", ")}` : "", ...t.tags.map((x) => `#${x}`)].filter(Boolean);
    return { value: t.id, label: t.title !== t.id ? `${t.id} · ${t.title}` : t.id, group: t.section ?? "Tests", note: bits.join(" · ") || undefined };
  }),
);
const tags = computed(() => {
  const out = new Map<string, string[]>();
  for (const t of pack.value?.tests ?? []) for (const tag of t.tags) out.set(tag, [...(out.get(tag) ?? []), t.id]);
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
});
const titles = computed(() => new Map((pack.value?.tests ?? []).map((t) => [t.id, t.title])));
const traceOptions = computed(() => {
  const d = pack.value?.run.trace;
  const mark = (v: TraceMode) => (v === d ? " (pack default)" : "");
  return [
    { value: "problems" as const, label: `Only on problems${mark("problems")}`, note: "Keep a trace when an attempt fails or breaks" },
    { value: "always" as const, label: `Always${mark("always")}`, note: "Large for long tests" },
    { value: "never" as const, label: `Never${mark("never")}` },
  ];
});
const attemptOptions = [
  { value: "pack" as const, label: "As each test says" },
  { value: "same" as const, label: "Same for every test" },
];

function body() {
  return {
    packId: packId.value,
    tests: chosen.value,
    params: { ...params },
    pauseOnBroken: pauseOnBroken.value,
    pauseLimitMinutes: pauseLimit.value,
    trace: trace.value,
    video: video.value,
    ...(attemptsMode.value === "same" ? { attempts: attempts.value } : {}),
  };
}

function applyPack(p: Pack) {
  for (const k of Object.keys(params)) delete params[k];
  for (const [k, d] of Object.entries(p.params)) params[k] = d.default ?? d.choices?.[0] ?? (d.type === "number" ? 0 : d.type === "boolean" ? false : "");
  chosen.value = [];
  attemptsMode.value = "pack";
  attempts.value = 1;
  trace.value = p.run.trace;
  video.value = p.run.video;
  pauseOnBroken.value = p.run.pauseOnBroken;
  pauseLimit.value = p.run.pauseLimitMinutes;
  copiedFrom.value = null;
}

watch(pack, (p, old) => {
  if (!p || p.id === old?.id) return;
  applyPack(p);
  replaceRoute({ name: "new", query: { pack: p.id } });
});

/** Copies an earlier run's tests, values and options over the pack's defaults. */
function copyRun(run: RunSummary, p: Pack) {
  const known = new Set(p.tests.map((t) => t.id));
  chosen.value = run.tests.filter((t) => known.has(t));
  for (const [k, v] of Object.entries(run.params)) if (k in params) params[k] = v;
  const o = run.options;
  if (o.attempts !== undefined) {
    attemptsMode.value = "same";
    attempts.value = o.attempts;
  }
  if (o.trace !== undefined) trace.value = o.trace;
  if (o.video !== undefined) video.value = o.video;
  if (o.pauseOnBroken !== undefined) pauseOnBroken.value = o.pauseOnBroken;
  if (o.pauseLimitMinutes !== undefined) pauseLimit.value = o.pauseLimitMinutes;
  copiedFrom.value = run.id;
}

onMounted(async () => {
  const res = await getJson<Pack[]>("/api/v1/packs");
  loaded.value = true;
  if (!res.ok) return void (loadError.value = res.error.message);
  packs.value = res.data;
  const wanted = res.data.find((p) => p.id === props.query.pack) ?? res.data.find((p) => p.status === "ok") ?? res.data[0];
  if (!wanted) return;
  packId.value = wanted.id;
  await nextTick(); // let the pack watcher fill the defaults first
  const from = props.query.from;
  if (from && /^[0-9a-f]{8}$/.test(from)) {
    const run = await getJson<RunSummary>(`/api/v1/runs/${from}`);
    if (run.ok && run.data.packId === wanted.id) {
      copyRun(run.data, wanted);
      replaceRoute({ name: "new", query: { pack: wanted.id, from } });
    }
  }
});

// The planned order follows every change, a moment after the last one.
let timer: ReturnType<typeof setTimeout> | null = null;
let asked = 0;
watch(
  () => (pack.value?.status === "ok" ? JSON.stringify(body()) : null),
  (b) => {
    if (timer) clearTimeout(timer);
    if (b === null) return void (preview.value = null);
    timer = setTimeout(async () => {
      const mine = ++asked;
      const res = await sendJson<RunPreview>("/api/v1/runs/preview", JSON.parse(b) as unknown);
      if (mine !== asked) return; // a newer request is on its way
      if (res.ok) {
        preview.value = res.data;
        previewError.value = null;
      } else previewError.value = res.error.message;
    }, 200);
  },
  { immediate: true },
);
onBeforeUnmount(() => timer && clearTimeout(timer));

function pickTag(ids: string[]) {
  const all = ids.every((id) => chosen.value.includes(id));
  const next = new Set(chosen.value);
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  const order = pack.value?.tests.map((t) => t.id) ?? [];
  chosen.value = order.filter((id) => next.has(id));
}

const joinedBy = computed(() => new Map((preview.value?.joined ?? []).map((j) => [j.testId, j])));
const planRows = computed(() => {
  // One row per test with its attempt count, in run order.
  const rows: { testId: string; title: string; of: number; children: string[] }[] = [];
  for (const p of preview.value?.plan ?? []) {
    const last = rows[rows.length - 1];
    if (last && last.testId === p.testId) continue;
    rows.push({ testId: p.testId, title: p.title, of: p.of, children: p.children ?? [] });
  }
  return rows;
});
/** Tests in the plan, children included. */
const testCount = computed(() => planRows.value.reduce((n, r) => n + 1 + r.children.length, 0));
function why(testId: string): string | null {
  const j = joinedBy.value.get(testId);
  if (!j) return null;
  const list = j.of.join(", ");
  return j.reason === "needed" ? `needed by ${list}` : j.reason === "parent" ? `parent of ${list}` : `runs inside ${list}`;
}

async function start() {
  if (!pack.value) return;
  startError.value = null;
  starting.value = true;
  const res = await sendJson<RunSummary>("/api/v1/runs", body());
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
        <p class="muted">Pick the tests and the values for this run. Nothing chosen runs every test.</p>
      </div>
    </div>
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>

    <section v-if="loaded && packs.length === 0" class="card empty">
      <p class="muted">There are no packs yet. Add the folder of a test pack first.</p>
      <a class="btn primary" href="#/packs">Add a pack</a>
    </section>

    <template v-else-if="pack">
      <div class="layout">
        <div class="form">
          <section class="card pick">
            <label class="lbl" for="nr-pack">Pack</label>
            <SelectMenu id="nr-pack" v-model="packId" :options="packOptions" />
            <p class="muted small">
              {{ pack.tests.length }} tests · {{ pack.browser }}<template v-if="pack.baseURL"> · {{ pack.baseURL }}</template> · <a :href="`#/packs/${pack.id}`">about this pack</a>
            </p>
            <p v-if="copiedFrom" class="muted small">Choices copied from run <a :href="`#/runs/${copiedFrom}`" class="num">{{ copiedFrom }}</a>.</p>
          </section>

          <section v-if="pack.status === 'error'" class="card">
            <p class="error">This pack doesn't load: {{ pack.error }}</p>
            <a class="btn" :href="`#/packs/${pack.id}`">Open the pack</a>
          </section>

          <template v-else>
            <section class="card" aria-labelledby="nr-tests">
              <h2 id="nr-tests" class="display">Tests</h2>
              <MultiSelect id="nr-tests-pick" v-model="chosen" :options="testOptions" placeholder="Search by id, title, section or tag" :empty-label="`All ${pack.tests.length} tests`" :max-chips="8" />
              <div v-if="tags.length" class="tags">
                <span class="muted small">By tag</span>
                <button
                  v-for="[tag, ids] in tags"
                  :key="tag"
                  type="button"
                  class="tag"
                  :aria-pressed="ids.every((id) => chosen.includes(id))"
                  @click="pickTag(ids)"
                >
                  #{{ tag }} <span class="num">{{ ids.length }}</span>
                </button>
              </div>
            </section>

            <section class="card" aria-labelledby="nr-values">
              <h2 id="nr-values" class="display">Values</h2>
              <p v-if="Object.keys(pack.params).length === 0" class="muted small">This pack has no parameters.</p>
              <div class="params">
                <div v-for="(d, key) in pack.params" :key="key" class="param">
                  <label class="name" :for="`p-${key}`">{{ key }}</label>
                  <SelectMenu v-if="d.choices" :id="`p-${key}`" v-model="params[key]!" :options="d.choices.map((c) => ({ value: c, label: String(c) }))" />
                  <NumberInput v-else-if="d.type === 'number'" :id="`p-${key}`" v-model="params[key] as number" :label="String(key)" />
                  <CheckBox v-else-if="d.type === 'boolean'" :id="`p-${key}`" v-model="params[key] as boolean">{{ d.description ?? "On" }}</CheckBox>
                  <TextField v-else :id="`p-${key}`" v-model="params[key] as string" />
                  <span v-if="d.description && d.type !== 'boolean'" class="muted small">{{ d.description }}</span>
                </div>
              </div>
            </section>

            <section class="card" aria-labelledby="nr-options">
              <h2 id="nr-options" class="display">Options</h2>
              <div class="opts">
                <div class="opt">
                  <span class="name">Attempts per test</span>
                  <RadioGroup v-model="attemptsMode" :options="attemptOptions" label="Attempts per test" inline />
                  <div v-if="attemptsMode === 'same'" class="inline">
                    <NumberInput id="nr-attempts" v-model="attempts" label="Attempts per test" :min="1" :max="100" />
                    <span class="muted small">attempts of every test</span>
                  </div>
                </div>
                <div class="opt">
                  <span class="name">Trace</span>
                  <RadioGroup v-model="trace" :options="traceOptions" label="Trace" />
                </div>
                <div class="opt">
                  <span class="name">Video</span>
                  <ToggleSwitch id="nr-video" v-model="video">Record a video of each attempt</ToggleSwitch>
                </div>
                <div class="opt">
                  <span class="name">When a test breaks</span>
                  <ToggleSwitch id="nr-pause" v-model="pauseOnBroken">Pause and wait for Retry or Skip</ToggleSwitch>
                  <div v-if="pauseOnBroken" class="inline">
                    <span class="muted small">Skip by itself after</span>
                    <NumberInput id="nr-limit" v-model="pauseLimit" label="Minutes before it skips" :min="1" :max="1440" />
                    <span class="muted small">min</span>
                  </div>
                </div>
              </div>
            </section>
          </template>
        </div>

        <aside v-if="pack.status === 'ok'" class="card plan" aria-labelledby="nr-plan">
          <h2 id="nr-plan" class="display">Planned</h2>
          <p v-if="previewError" class="error small" role="alert">{{ previewError }}</p>
          <template v-else-if="preview">
            <p class="sum">
              <strong class="num">{{ preview.attempts }}</strong> attempt{{ preview.attempts === 1 ? "" : "s" }} of <strong class="num">{{ testCount }}</strong> test{{ testCount === 1 ? "" : "s" }}
              <span v-if="preview.joined.length" class="muted small">· {{ preview.joined.length }} added because they're needed</span>
            </p>
            <ol class="order">
              <li v-for="r in planRows" :key="r.testId" :class="{ joined: joinedBy.has(r.testId) }">
                <code>{{ r.testId }}</code>
                <span class="t">{{ r.title !== r.testId ? r.title : "" }}</span>
                <span v-if="r.of > 1" class="times num">×{{ r.of }}</span>
                <span v-if="why(r.testId)" class="why small">{{ why(r.testId) }}</span>
                <ul v-if="r.children.length" class="kids">
                  <li v-for="c in r.children" :key="c">
                    <code>{{ c }}</code> <span class="t">{{ titles.get(c) ?? "" }}</span>
                    <span v-if="why(c)" class="why small">{{ why(c) }}</span>
                  </li>
                </ul>
              </li>
            </ol>
          </template>
          <p v-else class="muted small">Planning…</p>
          <div class="go">
            <button class="btn primary" :disabled="starting || !!previewError" @click="start">{{ starting ? "Starting…" : "Start run" }}</button>
            <span v-if="startError" class="error small" role="alert">{{ startError }}</span>
          </div>
        </aside>
      </div>
    </template>
  </main>
</template>

<style scoped>
.empty {
  display: grid;
  justify-items: start;
  gap: var(--space-2);
}
.empty p {
  margin: 0;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: var(--space-4);
  align-items: start;
}
.form {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}
.pick {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
.pick p {
  grid-column: 1 / -1;
  margin: 0;
}
.pick .lbl,
.name {
  font-weight: 600;
  font-size: 13px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.tag {
  padding: 2px 10px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-chip);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.tag:hover {
  background: var(--hover);
}
.tag[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-text);
}
.tag .num {
  color: var(--muted);
  font-size: 11px;
}
.params {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3) var(--space-4);
}
.param {
  display: grid;
  align-content: start;
  gap: 4px;
}
.opts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
}
.opt {
  display: grid;
  align-content: start;
  gap: var(--space-2);
}
.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.plan {
  position: sticky;
  top: calc(56px + var(--space-4));
  display: grid;
  gap: var(--space-2);
  max-height: calc(100vh - 56px - 2 * var(--space-4));
  overflow: auto;
}
.plan h2 {
  margin: 0;
}
.sum {
  margin: 0;
}
.order {
  margin: 0;
  padding-left: 22px;
  display: grid;
  gap: 4px;
}
.order > li::marker {
  color: var(--muted);
  font-size: 12px;
}
.order li {
  line-height: 1.4;
}
.order .t {
  margin-left: 4px;
}
.times {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: var(--radius-sm);
  background: var(--raised);
  font-size: 12px;
}
.why {
  display: block;
  color: var(--accent-text);
}
.joined > code,
.joined > .t {
  color: var(--muted);
}
.kids {
  list-style: none;
  margin: 2px 0 0;
  padding-left: var(--space-3);
  border-left: 2px solid var(--line);
}
.go {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
}
.go .btn {
  justify-content: center;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .plan {
    position: static;
    max-height: none;
  }
}
</style>
