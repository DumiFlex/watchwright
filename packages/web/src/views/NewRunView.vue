<script setup lang="ts">
// Start a run: a pack, its tests (none chosen means all), parameter values and run options.
// The planned order beside the form comes from the server (`POST /runs/preview`), so it shows
// exactly what will run, including the tests that join because a chosen one needs them.
// `?pack=<id>` picks the pack, and `&from=<run id>` copies an earlier run's choices. Without
// them it opens on the pack of the latest run with that run's choices (Settings can make it
// start from the pack's defaults instead). Presets are named choices kept per pack.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Ellipsis, Package } from "../icons";
import { getJson, sendJson, type Pack, type ParamValue, type Preset, type RunChoices, type RunPreview, type RunSummary, type TraceMode } from "../api";
import { useShortcut } from "../keys";
import { replaceRoute } from "../router";
import { loadSettings, settings } from "../settings";
import { offerNotify } from "../notify";
import { toast } from "../toasts";
import CheckBox from "../components/CheckBox.vue";
import KeyHint from "../components/KeyHint.vue";
import MenuButton from "../components/MenuButton.vue";
import EmptyState from "../components/EmptyState.vue";
import ModalDialog from "../components/ModalDialog.vue";
import MultiSelect from "../components/MultiSelect.vue";
import SkeletonBlock from "../components/SkeletonBlock.vue";
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
const label = ref("");
// Where the choices came from: an earlier run ("latest" when New run picked it by itself) or a preset.
const copiedFrom = ref<{ run: string; latest: boolean } | null>(null);
const presets = ref<Preset[]>([]);
const presetId = ref("");

// Run options, filled from the pack's settings when the pack changes.
const attemptsMode = ref<"pack" | "same">("pack");
const attempts = ref(1);
const trace = ref<TraceMode>("problems");
const video = ref(true);
const signIn = ref(false);
// Site keys that have a saved sign-in (Settings > Sign-ins).
const savedSignIns = ref<Set<string>>(new Set());
const pauseOnBroken = ref(true);
const pauseLimit = ref(20);

const preview = ref<RunPreview | null>(null);
const previewError = ref<string | null>(null);
const startError = ref<string | null>(null);
const starting = ref(false);

const pack = computed(() => packs.value.find((p) => p.id === packId.value) ?? null);
const hasSignIn = computed(() => pack.value?.siteKey != null && savedSignIns.value.has(pack.value.siteKey));
const packOptions = computed(() => packs.value.map((p) => ({ value: p.id, label: p.status === "error" ? `${p.name} (doesn't load)` : p.name })));
const testOptions = computed(() =>
  (pack.value?.tests ?? []).map((t) => {
    const bits = [t.inside.length ? `inside ${t.inside.join(" or ")}` : "", t.needs.length ? `needs ${t.needs.join(", ")}` : "", ...t.tags.map((x) => `#${x}`)].filter(Boolean);
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
  return { packId: packId.value, ...(label.value.trim() ? { label: label.value.trim() } : {}), ...choices() };
}

/** The form's choices: what a preset keeps. */
function choices(): RunChoices {
  return {
    tests: chosen.value,
    params: { ...params },
    pauseOnBroken: pauseOnBroken.value,
    pauseLimitMinutes: pauseLimit.value,
    trace: trace.value,
    video: video.value,
    signIn: signIn.value,
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
  signIn.value = p.run.signIn ?? false;
  pauseOnBroken.value = p.run.pauseOnBroken;
  pauseLimit.value = p.run.pauseLimitMinutes;
  copiedFrom.value = null;
  presetId.value = "";
}

/** Set while the page fills itself in, so the pack watcher leaves the choices alone. */
let opening = true;
watch(pack, (p, old) => {
  if (!p || p.id === old?.id) return;
  void loadPresets(p.id);
  if (opening) return;
  applyPack(p);
  replaceRoute({ name: "new", query: { pack: p.id } });
  if (settings.values["runs.newRunFrom"] === "latest") void copyLatest(p);
});

async function loadPresets(id: string) {
  const res = await getJson<Preset[]>(`/api/v1/presets?pack=${id}`);
  if (res.ok && packId.value === id) presets.value = res.data;
}

/** Copies the pack's latest run's choices, when it has one. */
async function copyLatest(p: Pack) {
  const res = await getJson<RunSummary[]>(`/api/v1/runs?pack=${p.id}&limit=1`);
  const run = res.ok ? res.data[0] : undefined;
  if (run && packId.value === p.id) copyRun(run, p, true);
}

/** Puts choices (a run's or a preset's) over the pack's defaults; tests the pack no longer has are left out. */
function applyChoices(c: RunChoices, p: Pack) {
  applyPack(p);
  const known = new Set(p.tests.map((t) => t.id));
  chosen.value = (c.tests ?? []).filter((t) => known.has(t));
  for (const [k, v] of Object.entries(c.params ?? {})) if (k in params) params[k] = v;
  const o = c;
  if (o.attempts !== undefined) {
    attemptsMode.value = "same";
    attempts.value = o.attempts;
  }
  if (o.trace !== undefined) trace.value = o.trace;
  if (o.video !== undefined) video.value = o.video;
  if (o.signIn !== undefined) signIn.value = o.signIn;
  if (o.pauseOnBroken !== undefined) pauseOnBroken.value = o.pauseOnBroken;
  if (o.pauseLimitMinutes !== undefined) pauseLimit.value = o.pauseLimitMinutes;
}

/** Copies an earlier run's tests, values, options and label. */
function copyRun(run: RunSummary, p: Pack, latest = false) {
  applyChoices({ tests: run.tests, params: run.params, ...run.options }, p);
  label.value = run.label;
  copiedFrom.value = { run: run.id, latest };
}

function useDefaults() {
  if (!pack.value) return;
  applyPack(pack.value);
  label.value = "";
}

onMounted(async () => {
  void getJson<{ siteKey: string }[]>("/api/v1/signins").then((r) => {
    if (r.ok) savedSignIns.value = new Set(r.data.map((s) => s.siteKey));
  });
  const [res, latest] = await Promise.all([getJson<Pack[]>("/api/v1/packs"), getJson<RunSummary[]>("/api/v1/runs?limit=1"), loadSettings()]);
  loaded.value = true;
  if (!res.ok) return void (loadError.value = res.error.message);
  packs.value = res.data;
  const fromLatest = settings.values["runs.newRunFrom"] === "latest";
  const last = latest.ok ? latest.data[0] : undefined;
  const wanted =
    res.data.find((p) => p.id === props.query.pack) ??
    (fromLatest && last ? res.data.find((p) => p.id === last.packId && p.status === "ok") : undefined) ??
    res.data.find((p) => p.status === "ok") ??
    res.data[0];
  if (!wanted) return;
  packId.value = wanted.id;
  await nextTick();
  applyPack(wanted);
  opening = false;
  // #/new?pack=…&test=… (a test found with Ctrl+K): that test alone, on the pack's defaults.
  const test = props.query.test;
  if (test && wanted.tests.some((t) => t.id === test)) {
    chosen.value = [test];
    replaceRoute({ name: "new", query: { pack: wanted.id } });
    return;
  }
  const from = props.query.from;
  if (from && /^[0-9a-f]{8}$/.test(from)) {
    const run = await getJson<RunSummary>(`/api/v1/runs/${from}`);
    if (run.ok && run.data.packId === wanted.id) {
      copyRun(run.data, wanted);
      replaceRoute({ name: "new", query: { pack: wanted.id, from } });
      return;
    }
  }
  replaceRoute({ name: "new", query: { pack: wanted.id } });
  if (fromLatest) await copyLatest(wanted);
});

// Presets: pick one to fill the form; save, rename or delete from the menu beside it.
const presetOptions = computed(() => [{ value: "", label: presets.value.length ? "None" : "No presets yet" }, ...presets.value.map((p) => ({ value: p.id, label: p.name }))]);
const preset = computed(() => presets.value.find((p) => p.id === presetId.value) ?? null);
function pickPreset(id: string) {
  const p = presets.value.find((x) => x.id === id);
  if (!p || !pack.value) return void (presetId.value = "");
  applyChoices(p.choices, pack.value);
  presetId.value = p.id;
}
const presetMenu = computed(() => [
  { value: "save", label: preset.value ? `Save to "${preset.value.name}"` : "Save as a preset…" },
  ...(preset.value
    ? [
        { value: "save-new", label: "Save as a new preset…" },
        { value: "rename", label: "Rename…" },
        { value: "delete", label: "Delete", danger: true },
      ]
    : []),
]);
const naming = ref<"save" | "rename" | null>(null);
const presetName = ref("");
const namingOpen = computed({ get: () => naming.value !== null, set: (v) => (v ? undefined : (naming.value = null)) });
const presetError = ref<string | null>(null);

async function onPresetMenu(v: string) {
  presetError.value = null;
  if (v === "save" && preset.value) return void savePreset(preset.value.name);
  if (v === "save" || v === "save-new") {
    naming.value = "save";
    presetName.value = "";
  } else if (v === "rename" && preset.value) {
    naming.value = "rename";
    presetName.value = preset.value.name;
  } else if (v === "delete" && preset.value) {
    const gone = preset.value;
    const res = await sendJson(`/api/v1/presets/${gone.id}`, {}, "DELETE");
    if (!res.ok) return void toast(res.error.message, { tone: "bad" });
    presetId.value = "";
    await loadPresets(packId.value);
    toast(`Deleted the preset "${gone.name}"`, { tone: "ok" });
  }
}

async function savePreset(name: string) {
  const res = await sendJson<Preset>("/api/v1/presets", { packId: packId.value, name, ...choices() });
  if (!res.ok) return void (presetError.value = res.error.message);
  naming.value = null;
  await loadPresets(packId.value);
  presetId.value = res.data.id;
  toast(`Saved the preset "${res.data.name}"`, { tone: "ok" });
}

async function submitName() {
  const name = presetName.value.trim();
  if (!name) return;
  if (naming.value === "save") return savePreset(name);
  if (!preset.value) return;
  const res = await sendJson<Preset>(`/api/v1/presets/${preset.value.id}`, { name });
  if (!res.ok) return void (presetError.value = res.error.message);
  naming.value = null;
  await loadPresets(packId.value);
}

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
  if (!pack.value || pack.value.status !== "ok" || starting.value || previewError.value) return;
  startError.value = null;
  starting.value = true;
  const res = await sendJson<RunSummary>("/api/v1/runs", body());
  starting.value = false;
  if (!res.ok) return void (startError.value = res.error.message);
  offerNotify();
  window.location.hash = `#/runs/${res.data.id}`;
}
// Ctrl+Enter (Cmd+Enter on a Mac) starts the run from anywhere in the form; not while a dialog is open.
useShortcut("Mod+Enter", () => !namingOpen.value && void start());
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

    <div v-if="!loaded" class="layout" aria-busy="true" aria-label="Loading">
      <div class="form">
        <section class="card skeleton-card">
          <SkeletonBlock width="60px" />
          <SkeletonBlock shape="block" height="36px" />
          <SkeletonBlock width="55%" />
        </section>
        <section class="card skeleton-card">
          <SkeletonBlock width="30%" height="1.1em" />
          <SkeletonBlock :lines="3" />
        </section>
      </div>
      <section class="card skeleton-card">
        <SkeletonBlock width="40%" height="1.1em" />
        <SkeletonBlock :lines="4" />
        <SkeletonBlock shape="block" height="40px" />
      </section>
    </div>

    <section v-else-if="packs.length === 0 && !loadError" class="card">
      <EmptyState :icon="Package" heading="No packs yet">
        <p>A run starts from a test pack: a folder with a pack file and its tests. Add one first.</p>
        <template #actions>
          <a class="btn primary" href="#/packs?browse=add">Add a pack</a>
        </template>
      </EmptyState>
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
            <p v-if="copiedFrom" class="copied muted small">
              <span>{{ copiedFrom.latest ? "Choices from the latest run," : "Choices copied from run" }} <a :href="`#/runs/${copiedFrom.run}`" class="num">{{ copiedFrom.run }}</a>.</span>
              <button type="button" class="linkbtn" @click="useDefaults">Use pack defaults</button>
            </p>
            <template v-if="pack.status === 'ok'">
              <label class="lbl" for="nr-preset">Preset</label>
              <div class="presetrow">
                <SelectMenu id="nr-preset" :model-value="presetId" class="grow" :options="presetOptions" :disabled="presets.length === 0" @update:model-value="pickPreset" />
                <MenuButton :items="presetMenu" label="Preset actions" @select="onPresetMenu">
                  <template #button><Ellipsis :size="16" /></template>
                </MenuButton>
              </div>
              <label class="lbl" for="nr-label">Label</label>
              <TextField id="nr-label" v-model="label" placeholder="Optional, e.g. nightly or after the fix" />
            </template>
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
                  <SelectMenu v-if="d.choices" :id="`p-${key}`" v-model="params[key]!" :options="d.choices.map((c) => ({ value: c, label: d.labels?.[String(c)] ? `${c} · ${d.labels[String(c)]}` : String(c) }))" />
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
                  <span class="name">Sign-in</span>
                  <ToggleSwitch id="nr-signin" v-model="signIn">Start signed in</ToggleSwitch>
                  <span v-if="signIn && !hasSignIn" class="warn small">Nothing is saved for {{ pack?.siteKey }} yet, so the run won't start. Save one from a recording (Save sign-in) or a login test.</span>
                  <span v-else class="muted small">With the cookies and local storage saved for {{ pack?.siteKey }} (Settings &gt; Sign-ins).</span>
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
            <button class="btn primary" :disabled="starting || !!previewError" @click="start">
              {{ starting ? "Starting…" : "Start run" }}
              <KeyHint class="hint" keys="Mod+Enter" />
            </button>
            <span v-if="startError" class="error small" role="alert">{{ startError }}</span>
          </div>
        </aside>
      </div>

      <ModalDialog v-model="namingOpen" :heading="naming === 'rename' ? 'Rename the preset' : 'Save as a preset'">
        <form class="naming" @submit.prevent="submitName">
          <p v-if="naming === 'save'" class="muted small">Keeps the tests, values and options chosen now under a name, for this pack. Agents can start it by name too.</p>
          <label class="lbl" for="nr-preset-name">Name</label>
          <TextField id="nr-preset-name" v-model="presetName" placeholder="e.g. full, German" :invalid="!!presetError" />
          <p v-if="presetError" class="error small" role="alert">{{ presetError }}</p>
        </form>
        <template #actions>
          <button class="btn" @click="naming = null">Cancel</button>
          <button class="btn primary" :disabled="!presetName.trim()" @click="submitName">{{ naming === "rename" ? "Rename" : "Save preset" }}</button>
        </template>
      </ModalDialog>
    </template>
  </main>
</template>

<style scoped>
.warn {
  color: var(--warn);
}
.skeleton-card {
  display: grid;
  gap: var(--space-3);
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
.copied {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}
.linkbtn {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  cursor: pointer;
}
.linkbtn:hover {
  text-decoration: underline;
}
.presetrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.grow {
  flex: 1;
  min-width: 0;
}
.go .hint {
  margin-left: var(--space-2);
  opacity: 0.85;
}
.naming {
  display: grid;
  gap: var(--space-2);
}
.naming p {
  margin: 0;
}
.pick .lbl,
.naming .lbl,
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
