<script setup lang="ts">
// One pack: whether it loads, then tabs for its dashboard, its recent runs, its README (the way a
// code host shows one), its tests with their metadata (searchable and filtered, for packs with
// hundreds of them), parameters, flag kinds and rubric. The tab is in the address, so nothing
// sits under anything else: a big dashboard never pushes the tests down the page.
import { ArrowLeft, ChevronDown, ChevronRight, CircleDot, Ellipsis, FilePlus, FileText, Lock, Pencil, Play, SearchX, Trash2, TriangleAlert } from "../icons";
import { nextTestId, recordingTestTemplate, slug, type PackFile } from "../editfiles";
import { findReadme, packImageUrl, resolveRelative } from "../markdown";
import MarkdownView from "../components/MarkdownView.vue";
import TextField from "../components/TextField.vue";
import SelectMenu from "../components/SelectMenu.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";
import { NO_FILTER, filterTests, groupTests, isFiltered, sectionsOf, tagsOf, type TestFilter } from "../packtests";
import { href, replaceRoute } from "../router";
import { useOutline, type OutlineItem } from "../outline";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type Criterion, type FolderPlaces, type HistoryEntry, type Pack, type PackAccess, type PackStateEntry, type PackTask, type PackTest, type RunSummary } from "../api";
import { HISTORY_LIMIT, flakyReason, medianMs, passRate } from "../history";
import { ago, countsText, duration, when } from "../format";
import { LiveConnection } from "../live";
import EmptyState from "../components/EmptyState.vue";
import FileLink from "../components/FileLink.vue";
import HistoryStrip from "../components/HistoryStrip.vue";
import MenuButton from "../components/MenuButton.vue";
import ModalDialog from "../components/ModalDialog.vue";
import PackRemoveDialog from "../components/PackRemoveDialog.vue";
import PackDashboard from "../components/PackDashboard.vue";
import PackAccessDialog from "../components/PackAccessDialog.vue";
import PackFolderDialog from "../components/PackFolderDialog.vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import PackRefresh from "../components/PackRefresh.vue";
import PathLine from "../components/PathLine.vue";
import StatusChip from "../components/StatusChip.vue";
import { buildErrorSpot } from "../editor";
import { join } from "../paths";
import { toast } from "../toasts";
import { loadSettings, settings } from "../settings";
import TabBar from "../components/TabBar.vue";
import { vTip } from "../tooltip";
import { can, session } from "../session";

const props = defineProps<{ id: string; tab?: string | null }>();
/** Runs shown on the Runs tab; the runs list has the rest. */
const RECENT = 10;

const pack = ref<Pack | null>(null);
const runs = ref<RunSummary[]>([]);
/** Bumped on every load, so the dashboard reads its numbers again too. */
const dashStamp = ref(0);
const history = ref<Record<string, HistoryEntry[]>>({});
const hasHistory = computed(() => Object.keys(history.value).length > 0);
// Each test's history in one place for the template: the ticks, pass rate, typical time, flaky or not.
const testHistory = computed(() => {
  const out: Record<string, { entries: HistoryEntry[]; rate: string; median: string; flaky: string | null }> = {};
  for (const [id, entries] of Object.entries(history.value)) {
    const rate = passRate(entries);
    out[id] = { entries, rate: rate === null ? "–" : `${Math.round(rate * 100)}%`, median: duration(medianMs(entries)) || "–", flaky: flakyReason(entries) };
  }
  return out;
});
const error = ref<string | null>(null);
const home = ref<string | null>(null);
const canOpen = ref(true);
const moveOpen = ref(false);
const removeOpen = ref(false);

// New recording: a new YAML test that opens the site, then the editor with Record started.
const recOpen = ref(false);
const recTitle = ref("");
const recId = ref("");
const recPath = ref("");
function startNewRecording() {
  recTitle.value = "";
  recId.value = nextTestId(pack.value, (pack.value?.tests[0]?.id.match(/^[A-Za-z]+/)?.[0] ?? "T").toUpperCase());
  recPath.value = "tests/new-recording.yaml";
  recOpen.value = true;
}
watch(recTitle, (t) => (recPath.value = `tests/${slug(t || "new recording")}.yaml`));
async function createRecording() {
  if (!recPath.value.trim() || !recId.value.trim()) return;
  const t = recordingTestTemplate(recId.value.trim(), recTitle.value.trim() || recId.value.trim());
  const res = await sendJson<{ file: { path: string } }>(`/api/v1/packs/${props.id}/files`, { path: recPath.value.trim(), text: t.text });
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  recOpen.value = false;
  window.location.hash = href({ name: "edit", id: props.id, file: res.data.file.path, line: t.line, record: true });
}
// Who sees the pack: only admins pick it, and only with login on (without it everyone sees everything).
const manageAccess = computed(() => session.on && can("admin"));
const access = ref<PackAccess | null>(null);
const accessOpen = ref(false);
async function loadAccess() {
  if (!manageAccess.value) return;
  const res = await getJson<PackAccess>(`/api/v1/packs/${props.id}/access`);
  if (res.ok) access.value = res.data;
}
const accessTip = computed(() => {
  const a = access.value;
  if (a?.mode !== "chosen") return "";
  const n = a.people.length;
  const parts = [n ? `${n} ${n === 1 ? "person" : "people"}` : "", a.groups.length ? `${a.groups.length === 1 ? "group" : "groups"} ${a.groups.join(", ")}` : ""].filter(Boolean);
  return `Only ${parts.length ? `${parts.join(" and ")} and ` : ""}the admins see this pack`;
});
const menu = computed(() => [
  { value: "download", label: "Download .zip" },
  ...(manageAccess.value ? [{ value: "access", label: "Who sees this pack…" }] : []),
  ...(can("admin") ? [{ value: "move", label: "Move to another folder…" }] : []),
  { value: "remove", label: "Remove…", danger: true },
]);
function onMenu(v: string) {
  if (v === "download") window.location.href = `/api/v1/packs/${props.id}/download`;
  else if (v === "access") accessOpen.value = true;
  else if (v === "move") moveOpen.value = true;
  else if (v === "remove") removeOpen.value = true;
}
function onRemoved(p: Pack, deleted: boolean) {
  toast(deleted ? `Removed "${p.name}" and deleted its files` : `Removed "${p.name}"`, { tone: "ok" });
  window.location.hash = "#/packs";
}
type Tab = "dashboard" | "runs" | "readme" | "tests" | "tasks" | "params" | "flags" | "rubric";
const tabs = computed(() => [
  ...(runs.value.length ? [{ value: "dashboard" as const, label: "Dashboard" }] : []),
  { value: "runs" as const, label: "Runs" },
  ...(readme.value ? [{ value: "readme" as const, label: "README" }] : []),
  { value: "tests" as const, label: "Tests", count: pack.value?.tests.length ?? 0 },
  ...(pack.value?.tasks.length || packState.value.length ? [{ value: "tasks" as const, label: "Tasks", count: pack.value?.tasks.length ?? 0 }] : []),
  { value: "params" as const, label: "Parameters", count: Object.keys(pack.value?.params ?? {}).length },
  { value: "flags" as const, label: "Flags", count: Object.keys(pack.value?.flags ?? {}).length },
  { value: "rubric" as const, label: "Rubric", count: pack.value?.rubric.length ?? 0 },
]);
// The tab picked here, else the one in the address, else the dashboard once the pack has run,
// else its README, else its tests. Picking one writes it to the address (without a history
// entry, as filters do), so a reload or a copied link opens on it.
const picked = ref<string | null>(null);
watch(
  () => props.tab,
  () => (picked.value = null),
);
const has = (t: string | null | undefined): t is Tab => !!t && tabs.value.some((x) => x.value === t);
const tab = computed<Tab>({
  get: () => (has(picked.value) ? picked.value : has(props.tab) ? props.tab : runs.value.length ? "dashboard" : readme.value ? "readme" : "tests"),
  set: (t) => {
    picked.value = t;
    replaceRoute({ name: "pack", id: props.id, tab: t });
  },
});

// Tasks: steps of the pack that run on their own, and the values the pack keeps between runs.
const packState = ref<PackStateEntry[]>([]);
const starting = ref<string | null>(null);
/** The pack's run that is going or paused, which decides when a task starts. */
const openRun = computed(() => runs.value.find((r) => r.kind !== "task" && ["running", "pausing", "paused"].includes(r.status)) ?? null);
async function runTask(t: PackTask) {
  starting.value = t.id;
  const res = await sendJson<RunSummary>("/api/v1/runs", { packId: props.id, kind: "task", tests: [t.id] });
  starting.value = null;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  window.location.hash = `#/runs/${res.data.id}`;
}
async function loadState() {
  const res = await getJson<PackStateEntry[]>(`/api/v1/packs/${props.id}/state`);
  packState.value = res.ok ? res.data : [];
}
const forgetting = ref<PackStateEntry | null>(null);
const forgetOpen = computed({ get: () => forgetting.value !== null, set: (v) => void (v || (forgetting.value = null)) });
async function forget() {
  const key = forgetting.value?.key;
  forgetting.value = null;
  if (!key) return;
  const res = await sendJson(`/api/v1/packs/${props.id}/state/${encodeURIComponent(key)}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Deleted "${key}"`, { tone: "ok" });
  await loadState();
}
/** A value as one short line of JSON. */
function valueText(v: unknown): string {
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

// Finding tests: a search and filters, and descriptions that can be folded away (kept per browser).
const filter = ref<TestFilter>({ ...NO_FILTER });
const shown = computed(() => filterTests(pack.value?.tests ?? [], filter.value, history.value));
const sectionOptions = computed(() => [{ value: "", label: "All sections" }, ...sectionsOf(pack.value?.tests ?? []).map((s) => ({ value: s, label: s || "No section" }))]);
const tagOptions = computed(() => [{ value: "", label: "All tags" }, ...tagsOf(pack.value?.tests ?? []).map((t) => ({ value: t, label: t }))]);
const stateOptions = [
  { value: "" as const, label: "Any result" },
  { value: "failing" as const, label: "Failing lately" },
  { value: "flaky" as const, label: "Flaky" },
  { value: "passing" as const, label: "Passing lately" },
  { value: "never" as const, label: "Never run" },
];
const DESC_KEY = "watchwright.pack.descriptions";
const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
// Until the person picks, descriptions show in small packs and stay folded in big ones, where
// they'd make every row several lines tall.
const BIG_PACK = 30;
const stored = storage()?.getItem(DESC_KEY);
const descPick = ref<boolean | null>(stored === "on" ? true : stored === "off" ? false : null);
const descriptions = computed({
  get: () => descPick.value ?? (pack.value?.tests.length ?? 0) <= BIG_PACK,
  set: (on: boolean) => {
    descPick.value = on;
    try {
      storage()?.setItem(DESC_KEY, on ? "on" : "off");
    } catch {
      // private window: the choice lasts until the page closes
    }
  },
});
const hasDescriptions = computed(() => (pack.value?.tests ?? []).some((t) => t.description));

// A pack with more than one section lists its tests under a row per section (then the Section
// column would only repeat it). With no filter on, a section folds away; filtering opens them all,
// so a match is never hidden in a folded section.
const grouped = computed(() => sectionsOf(pack.value?.tests ?? []).length > 1 && !filter.value.section);
const groups = computed(() => (grouped.value ? groupTests(shown.value) : [{ section: "", tests: shown.value }]));
const foldable = computed(() => grouped.value && !isFiltered(filter.value));
const folded = ref(new Set<string>());
const allFolded = computed(() => groups.value.every((g) => folded.value.has(g.section)));
function toggleFold(section: string) {
  const next = new Set(folded.value);
  if (!next.delete(section)) next.add(section);
  folded.value = next;
}
function foldAll(fold: boolean) {
  folded.value = new Set(fold ? groups.value.map((g) => g.section) : []);
}
const columns = computed(() => 4 + (grouped.value ? 0 : 1) + (hasHistory.value ? 1 : 0));

// Tests that score on something other than the pack's rubric.
const ownRubric = computed(() => {
  const base = (pack.value?.rubric ?? []).map((c) => c.id).join(",");
  return (pack.value?.tests ?? []).filter((t) => t.rubric.map((c) => c.id).join(",") !== base);
});
const criterionKind = (c: Criterion) => (c.kind === "scale" ? `1 to ${c.scale}` : c.kind === "yesNo" ? "yes or no" : c.choices.join(", "));

const FLAG_KIND: Record<string, string> = {
  robot: "The harness or the test went wrong: the attempt is broken, and Redo broken runs it again.",
  finding: "The site did something wrong: the attempt failed.",
  info: "Worth noting; doesn't change the outcome.",
};

function runsText(t: PackTest): string {
  if (typeof t.runs === "number") return t.runs === 1 ? "" : `${t.runs}×`;
  if (t.runs === "computed") return "computed";
  const by = typeof t.runs.by === "string" ? t.runs.by : "param";
  return `by ${by}`;
}

// The README at the top of the pack's folder, if there is one.
const readme = ref<{ path: string; text: string } | null>(null);
const files = ref<string[]>([]);
async function loadReadme() {
  const f = await getJson<{ files: PackFile[] }>(`/api/v1/packs/${props.id}/files`);
  files.value = f.ok ? f.data.files.map((x) => x.path) : [];
  const path = findReadme(files.value);
  if (!path) return void (readme.value = null);
  const res = await getJson<{ text: string }>(`/api/v1/packs/${props.id}/file?path=${encodeURIComponent(path)}`);
  readme.value = res.ok ? { path, text: res.data.text } : null;
}
const readmeHeadings = ref<{ level: number; text: string; id: string }[]>([]);
const readmeImage = (src: string) => (readme.value ? packImageUrl(props.id, readme.value.path, src) : null);
function readmeLink(target: string): string | null {
  const to = readme.value ? resolveRelative(readme.value.path, target) : null;
  return to && files.value.includes(to) ? href({ name: "edit", id: props.id, file: to, line: null }) : null;
}

// "On this page": the tabs, and under the one on show its parts: the README's headings, or the
// sections of the tests (landing under the search and filters, which stay stuck at the top).
const finderHeight = () => document.querySelector<HTMLElement>("#pack-panel-tests .finder")?.offsetHeight ?? 0;
useOutline("Parts of this pack", () => {
  if (!pack.value) return [];
  const out: OutlineItem[] = [];
  for (const t of tabs.value) {
    out.push({ id: "pack-tabs", label: t.label, open: () => (tab.value = t.value), on: () => tab.value === t.value });
    if (t.value !== tab.value) continue;
    if (t.value === "readme") {
      const top = Math.min(...readmeHeadings.value.map((h) => h.level));
      for (const h of readmeHeadings.value) if (h.level <= top + 1) out.push({ id: h.id, label: h.text, level: 2 });
    } else if (t.value === "tests" && grouped.value) {
      groups.value.forEach((g, gi) => out.push({ id: `pt-sec-${gi}`, label: g.section || "No section", level: 2, open: () => folded.value.has(g.section) && toggleFold(g.section), land: finderHeight }));
    }
  }
  return out;
});

async function load() {
  const [p, r, h] = await Promise.all([
    getJson<Pack>(`/api/v1/packs/${props.id}`),
    getJson<RunSummary[]>(`/api/v1/runs?pack=${props.id}&limit=10`),
    getJson<Record<string, HistoryEntry[]>>(`/api/v1/packs/${props.id}/history?limit=${HISTORY_LIMIT}`),
  ]);
  if (!p.ok) {
    error.value = p.error.code === "not_found" ? "There is no pack with this id. It may have been removed." : p.error.message;
    pack.value = null;
    return;
  }
  error.value = null;
  pack.value = p.data;
  if (r.ok) runs.value = r.data;
  dashStamp.value++;
  if (h.ok) history.value = h.data;
  void loadState();
  if (!p.data.missing) void loadReadme();
  else readme.value = null;
  void loadAccess();
}

async function refreshed(p: Pack) {
  pack.value = p;
  await load();
}

watch(
  () => props.id,
  () => {
    filter.value = { ...NO_FILTER };
    readme.value = null;
    runs.value = [];
    packState.value = [];
    picked.value = null;
    void load();
  },
);
let live: LiveConnection | null = null;
onMounted(async () => {
  void load();
  void loadSettings();
  const places = await getJson<FolderPlaces>("/api/v1/folders/places");
  if (places.ok) {
    home.value = places.data.home;
    canOpen.value = places.data.canOpen ?? true;
  }
  live = new LiveConnection({}, { onEvent: (e) => (/^(pack|run)\./.test(e.type) ? void load() : e.type === "editor.file_changed" && void loadReadme()) });
});
onBeforeUnmount(() => live?.close());
</script>

<template>
  <main class="page">
    <p class="crumb"><a href="#/packs"><ArrowLeft :size="15" />Packs</a></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="pack">
      <div class="page-head">
        <div class="title">
          <h1 class="display">
            {{ pack.name }} <StatusChip v-if="pack.status === 'error'" status="failed" />
            <button v-if="access?.mode === 'chosen'" v-tip="accessTip" type="button" class="kept" @click="accessOpen = true"><Lock :size="12" /> Chosen people</button>
          </h1>
          <p v-if="pack.description">{{ pack.description }}</p>
          <p class="muted small">
            {{ pack.browser }}<template v-if="pack.baseURL"> · {{ pack.baseURL }}</template><template v-if="pack.siteKey"> · site key <code>{{ pack.siteKey }}</code></template>
            <template v-if="pack.loadedAt"> · <span v-tip="when(pack.loadedAt)">built {{ ago(pack.loadedAt) }}</span></template>
          </p>
          <PathLine class="path" :path="pack.dir" :home="home" :openable="canOpen && !pack.missing" />
        </div>
        <div class="acts">
          <button v-if="pack.missing && can('admin')" class="btn primary" @click="moveOpen = true">Locate…</button>
          <template v-else>
            <PackRefresh :pack="pack" @refreshed="refreshed" />
            <a class="btn" :href="href({ name: 'edit', id: pack.id, file: null, line: null })"><Pencil :size="15" /> Edit</a>
            <button v-if="pack.status === 'ok'" v-tip="'Make a new YAML test by clicking through the site'" type="button" class="btn" @click="startNewRecording"><CircleDot :size="15" /> New recording</button>
            <a v-if="pack.status === 'ok'" class="btn primary" :href="`#/new?pack=${pack.id}`">New run</a>
          </template>
          <MenuButton :items="menu" label="More for this pack" @select="onMenu">
            <template #button><Ellipsis :size="16" /></template>
          </MenuButton>
        </div>
      </div>

      <section v-if="pack.missing" class="card problems" role="alert">
        <h2 class="display"><TriangleAlert :size="16" /> The pack's folder is gone</h2>
        <p>Nothing is at <code>{{ pack.dir }}</code> any more. If the folder moved, locate it and the pack keeps its runs. If it's gone for good, remove the pack.</p>
      </section>

      <section v-else-if="pack.status === 'error' || pack.problems.length" class="card problems" role="alert">
        <h2 class="display">The pack doesn't load</h2>
        <p v-if="pack.error" class="error">{{ pack.error }}</p>
        <ul v-if="pack.problems.length">
          <li v-for="(x, i) in pack.problems" :key="i">
            <template v-if="buildErrorSpot(x)"><FileLink :file="join(pack.dir, buildErrorSpot(x)!.spot.file)" :label="buildErrorSpot(x)!.spot.file" :line="buildErrorSpot(x)!.spot.line" :column="buildErrorSpot(x)!.spot.column" /> {{ buildErrorSpot(x)!.rest }}</template>
            <template v-else>{{ x }}</template>
          </li>
        </ul>
        <p v-if="pack.error?.includes('outside its folder')" class="muted small">A pack can share files with the folder above it, but that folder has to be on the server too. Copy it there and press the refresh icon, or upload a zip of it: Download .zip on a Watchwright where this pack loads makes one with those files in it.</p>
        <p v-else-if="settings.values['packs.watch'] !== false" class="muted small">Fix the files and save: the server builds the pack again by itself within a few seconds.</p>
        <p v-else class="muted small">Fix the files, then press the refresh icon. Saves in Watchwright's editor build the pack again by themselves.</p>
      </section>

      <TabBar id="pack-tabs" v-model="tab" class="pack-tabs" :tabs="tabs" id-prefix="pack" label="Pack" />

      <div v-if="runs.length && tab === 'dashboard'" id="pack-panel-dashboard" role="tabpanel" aria-labelledby="pack-tab-dashboard" class="tab-page">
        <PackDashboard :pack-id="pack.id" :latest-runs="runs.map((r) => r.id)" :stamp="dashStamp" />
      </div>

      <section v-if="tab === 'runs'" id="pack-panel-runs" role="tabpanel" aria-labelledby="pack-tab-runs" class="card">
        <div class="runs-head">
          <h2 id="pk-runs" class="display">Recent runs</h2>
          <a v-if="runs.length" class="small" :href="`#/?pack=${pack.id}`">All runs of this pack</a>
        </div>
        <ul v-if="runs.length" class="rlist">
          <li v-for="r in runs.slice(0, RECENT)" :key="r.id">
            <a :href="`#/runs/${r.id}`" class="rid"><span v-if="r.label" class="rlabel">{{ r.label }}</span><span class="num">{{ r.id }}</span></a>
            <StatusChip :status="r.status" />
            <span class="small" :class="{ muted: r.status === 'queued' }">{{ r.status === "queued" ? "waiting to start" : countsText(r.counts) }}</span>
            <span v-if="Object.keys(r.params).length" class="rparams small">
              <code v-for="(v, k) in r.params" :key="k">{{ k }}={{ v }}</code>
            </span>
            <span v-tip="when(r.startedAt ?? r.createdAt)" class="muted small">{{ ago(r.startedAt ?? r.createdAt) }}</span>
          </li>
        </ul>
        <p v-else class="no-runs muted">
          <Play :size="15" /> Nothing has run yet. Runs of this pack show here with their results.
          <a v-if="pack.status === 'ok' && !pack.missing" :href="`#/new?pack=${pack.id}`">Start a run</a>
        </p>
      </section>

      <section v-show="tab !== 'dashboard' && tab !== 'runs'" class="card">
        <div v-if="readme" v-show="tab === 'readme'" id="pack-panel-readme" role="tabpanel" aria-labelledby="pack-tab-readme" class="panel readme">
          <header class="readme-head">
            <h2 class="readme-name"><FileText :size="16" /><span class="mono">{{ readme.path }}</span></h2>
            <a v-tip="'Edit'" class="edit" :href="href({ name: 'edit', id: pack.id, file: readme.path, line: null })" :aria-label="`Edit ${readme.path}`"><Pencil :size="15" /></a>
          </header>
          <MarkdownView :source="readme.text" :resolve-link="readmeLink" :resolve-image="readmeImage" id-prefix="readme-" :label="readme.path" @headings="(h) => (readmeHeadings = h)" />
        </div>

        <div v-show="tab === 'tests'" id="pack-panel-tests" role="tabpanel" aria-labelledby="pack-tab-tests" class="panel tests">
          <div v-if="pack.tests.length" class="finder">
            <label class="sr-only" for="pt-search">Search tests</label>
            <TextField id="pt-search" v-model="filter.search" type="search" class="search" placeholder="Search: id, title, tag, file, description…" />
            <label class="sr-only" for="pt-section">Section</label>
            <SelectMenu v-if="sectionOptions.length > 2" id="pt-section" v-model="filter.section" :options="sectionOptions" />
            <label class="sr-only" for="pt-tag">Tag</label>
            <SelectMenu v-if="tagOptions.length > 1" id="pt-tag" v-model="filter.tag" :options="tagOptions" />
            <label class="sr-only" for="pt-state">Result</label>
            <SelectMenu v-if="hasHistory" id="pt-state" v-model="filter.state" :options="stateOptions" />
            <ToggleSwitch v-if="hasDescriptions" id="pt-desc" v-model="descriptions" class="desc-toggle">Descriptions</ToggleSwitch>
          </div>
          <div v-if="pack.tests.length && (isFiltered(filter) || foldable)" class="listbar">
            <p class="muted small count" aria-live="polite">{{ isFiltered(filter) ? `${shown.length} of ${pack.tests.length} tests` : `${pack.tests.length} tests in ${groups.length} sections` }}</p>
            <button v-if="foldable" type="button" class="btn" @click="foldAll(!allFolded)">{{ allFolded ? "Open all sections" : "Fold all sections" }}</button>
          </div>
          <div v-if="shown.length" class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr><th>Test</th><th v-if="!grouped">Section</th><th>Needs</th><th>Attempts</th><th v-if="hasHistory" class="c-hist">Last {{ HISTORY_LIMIT }} attempts, newest on the right</th><th>File</th></tr>
              </thead>
              <tbody v-for="(g, gi) in groups" :key="g.section">
                <tr v-if="grouped" :id="`pt-sec-${gi}`" class="group">
                  <th :colspan="columns" scope="colgroup">
                    <button v-if="foldable" type="button" class="fold" :aria-expanded="!folded.has(g.section)" @click="toggleFold(g.section)">
                      <component :is="folded.has(g.section) ? ChevronRight : ChevronDown" :size="16" />
                      <span class="gname">{{ g.section || "No section" }}</span>
                      <span class="muted small num">{{ g.tests.length }}</span>
                    </button>
                    <span v-else class="fold">
                      <span class="gname">{{ g.section || "No section" }}</span>
                      <span class="muted small num">{{ g.tests.length }}</span>
                    </span>
                  </th>
                </tr>
                <template v-if="!foldable || !folded.has(g.section)">
                  <tr v-for="t in g.tests" :key="t.id" :class="{ child: t.inside.length > 0 }">
                    <td class="c-test">
                      <div class="tline">
                        <code class="tid">{{ t.id }}</code>
                        <span v-if="t.title !== t.id" v-tip="t.title" class="ttitle">{{ t.title }}</span>
                        <span v-if="t.inside.length" class="muted small inside">runs inside {{ t.inside.join(" or ") }}</span>
                        <span v-for="tag in t.tags" :key="tag" class="tag small">{{ tag }}</span>
                        <span v-if="testHistory[t.id]?.flaky" v-tip="testHistory[t.id]!.flaky!" class="flaky small" tabindex="0">flaky</span>
                      </div>
                      <p v-if="t.description && descriptions" class="desc muted small">{{ t.description }}</p>
                    </td>
                    <td v-if="!grouped" class="muted" data-label="Section" :class="{ none: !t.section }">{{ t.section ?? "–" }}</td>
                    <td data-label="Needs" :class="{ none: !t.needs.length }"><code v-if="t.needs.length">{{ t.needs.join(", ") }}</code><span v-else class="muted">–</span></td>
                    <td class="num" data-label="Attempts">{{ runsText(t) || "1" }}</td>
                    <td v-if="hasHistory" class="c-hist" :class="{ none: !testHistory[t.id] }">
                      <div v-if="testHistory[t.id]" class="hist">
                        <HistoryStrip :entries="testHistory[t.id]!.entries" :label="`Last attempts of ${t.id}`" />
                        <span v-tip="'Passed, of the attempts that passed, failed or broke'" class="hist-num rate num small">{{ testHistory[t.id]!.rate }}</span>
                        <span v-tip="'Typical time (median)'" class="hist-num num small muted">{{ testHistory[t.id]!.median }}</span>
                      </div>
                      <span v-else class="muted small">No runs yet</span>
                    </td>
                    <td class="muted small file">
                      <a v-tip="'Edit this test'" class="edit" :href="href({ name: 'edit', id: pack.id, file: t.file, line: t.line })" :aria-label="`Edit ${t.id}`"><Pencil :size="14" /></a>
                      <FileLink :file="join(pack.dir, t.file)" :label="t.file" />
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <EmptyState v-else-if="pack.tests.length" :icon="SearchX" heading="No tests match" compact :level="3">
            <p>{{ filter.search.trim() ? `Nothing matches "${filter.search.trim()}" with these filters.` : "No test has this section, tag and result." }}</p>
            <template #actions>
              <button type="button" class="btn" @click="filter = { ...NO_FILTER }">Clear the filters</button>
            </template>
          </EmptyState>
          <EmptyState v-else :icon="FilePlus" heading="No tests yet" compact :level="3">
            <p>Tests are files in the pack folder. Record one by clicking through the site, or write one in the editor.</p>
            <template v-if="!pack.missing" #actions>
              <button v-if="pack.status === 'ok'" type="button" class="btn primary" @click="startNewRecording"><CircleDot :size="15" /> New recording</button>
              <a class="btn" :href="href({ name: 'edit', id: pack.id, file: null, line: null })"><Pencil :size="15" /> Open the editor</a>
            </template>
          </EmptyState>
        </div>

        <div v-show="tab === 'tasks'" id="pack-panel-tasks" role="tabpanel" aria-labelledby="pack-tab-tasks" class="panel tasks">
          <p class="muted small intro">
            Steps of the pack that run on their own, as a run you can watch. A task waits for the site like any run, but starts at once while the site's run is paused.
            <template v-if="pack.hooks.teardown"> Runs of this pack end with its teardown.</template>
          </p>
          <p v-if="openRun && pack.tasks.length" class="note small" role="status">
            <template v-if="openRun.status === 'paused'">
              <a :href="`#/runs/${openRun.id}`">Run {{ openRun.label || openRun.id }}</a> is paused, so a task starts now. The run can go on once it's done<template v-if="pack.hooks.afterTask">, after the pack's afterTask</template>.
            </template>
            <template v-else>
              <a :href="`#/runs/${openRun.id}`">Run {{ openRun.label || openRun.id }}</a> is going. A task waits until it pauses or ends.
            </template>
          </p>
          <ul v-if="pack.tasks.length" class="task-list">
            <li v-for="t in pack.tasks" :key="t.id" class="task">
              <div class="task-text">
                <div class="tline">
                  <strong>{{ t.title }}</strong>
                  <code v-if="t.title !== t.id" class="tid muted">{{ t.id }}</code>
                  <span v-if="t.readOnly" v-tip="'Leaves the site as it found it: a paused run goes on where it was'" class="tag small" tabindex="0">read-only</span>
                </div>
                <p v-if="t.description" class="desc muted small">{{ t.description }}</p>
              </div>
              <button v-if="can('user')" type="button" class="btn" :disabled="pack.status !== 'ok' || starting !== null" @click="runTask(t)"><Play :size="15" /> {{ starting === t.id ? "Starting…" : "Run" }}</button>
            </li>
          </ul>
          <p v-else class="muted">This pack has no tasks.</p>
          <h3 class="sub">Saved values</h3>
          <p class="muted small">What the pack keeps between runs and tasks, such as the name of a backup its setup took.</p>
          <ul v-if="packState.length" class="state-list">
            <li v-for="e in packState" :key="e.key">
              <code class="skey">{{ e.key }}</code>
              <code class="sval">{{ valueText(e.value) }}</code>
              <span v-tip="when(e.updatedAt)" class="muted small">{{ ago(e.updatedAt) }}</span>
              <button v-if="can('user')" v-tip="'Delete'" type="button" class="ib" :aria-label="`Delete ${e.key}`" @click="forgetting = e"><Trash2 :size="15" /></button>
            </li>
          </ul>
          <p v-else class="muted small">Nothing saved yet.</p>
        </div>

        <div v-show="tab === 'params'" id="pack-panel-params" role="tabpanel" aria-labelledby="pack-tab-params" class="panel">
          <dl v-if="Object.keys(pack.params).length" class="defs">
            <template v-for="(d, k) in pack.params" :key="k">
              <dt><code>{{ k }}</code> <span class="muted small">{{ d.type }}</span></dt>
              <dd>
                <span v-if="d.description">{{ d.description }}</span>
                <span v-if="d.choices" class="muted small"> Choices: <span v-for="c in d.choices" :key="String(c)" class="choice"><code>{{ c }}</code><span v-if="d.labels?.[String(c)]" class="choice-label">{{ d.labels[String(c)] }}</span></span></span>
                <span v-if="d.default !== undefined" class="muted small"> Default <code>{{ d.default }}</code>.</span>
              </dd>
            </template>
          </dl>
          <p v-else class="muted">This pack has no parameters.</p>
        </div>

        <div v-show="tab === 'flags'" id="pack-panel-flags" role="tabpanel" aria-labelledby="pack-tab-flags" class="panel">
          <dl v-if="Object.keys(pack.flags).length" class="defs">
            <template v-for="(kind, k) in pack.flags" :key="k">
              <dt><code>{{ k }}</code></dt>
              <dd><span class="kind" :class="kind">{{ kind }}</span> <span class="muted small">{{ FLAG_KIND[kind] }}</span></dd>
            </template>
          </dl>
          <p v-else class="muted">This pack declares no flags.</p>
        </div>
        <div v-show="tab === 'rubric'" id="pack-panel-rubric" role="tabpanel" aria-labelledby="pack-tab-rubric" class="panel">
          <p class="muted small">What reviewers score each attempt on.</p>
          <dl class="defs">
            <template v-for="c in pack.rubric" :key="c.id">
              <dt><code>{{ c.id }}</code></dt>
              <dd>
                <strong>{{ c.title }}</strong> <span class="muted small">{{ criterionKind(c) }}</span>
                <span v-if="c.description" class="small"> · {{ c.description }}</span>
              </dd>
            </template>
          </dl>
          <template v-if="ownRubric.length">
            <h3 class="sub">Tests with their own criteria</h3>
            <dl class="defs">
              <template v-for="t in ownRubric" :key="t.id">
                <dt><code>{{ t.id }}</code></dt>
                <dd>{{ t.rubric.map((c) => c.title).join(", ") }}</dd>
              </template>
            </dl>
          </template>
        </div>
      </section>
    </template>
    <PageSkeleton v-else-if="!error" label="Loading the pack" :cards="3" />
    <PackAccessDialog v-if="pack && manageAccess" v-model="accessOpen" :pack-id="pack.id" :pack-name="pack.name" @saved="(a: PackAccess) => (access = a)" />
    <PackFolderDialog v-if="pack" v-model="moveOpen" mode="move" :packs="[]" :moving="pack" :home="home" @moved="load(), toast('The pack now loads from its new folder', { tone: 'ok' })" />
    <ModalDialog v-model="recOpen" heading="New recording" width="480px">
      <form class="form" @submit.prevent="createRecording">
        <p class="muted small">A new YAML test with no steps yet. The editor opens on it and Record starts where the pack's beforeEach leaves the page, so the steps you click through become the test.</p>
        <label class="field-label" for="rec-title">Title</label>
        <TextField id="rec-title" v-model="recTitle" placeholder="Check out as a guest" />
        <label class="field-label" for="rec-id">Test id</label>
        <TextField id="rec-id" v-model="recId" />
        <label class="field-label" for="rec-path">File, in the pack folder</label>
        <TextField id="rec-path" v-model="recPath" />
      </form>
      <template #actions>
        <button type="button" class="btn" @click="recOpen = false">Cancel</button>
        <button type="button" class="btn primary" :disabled="!recPath.trim() || !recId.trim()" @click="createRecording">Start recording</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="forgetOpen" heading="Delete this saved value?">
      <p v-if="forgetting">The pack's setup, teardown or tasks may need <code>{{ forgetting.key }}</code>, such as the name of a backup to restore. Delete it only if you know it's no longer needed.</p>
      <template #actions>
        <button class="btn" @click="forgetting = null">Cancel</button>
        <button class="btn danger" @click="forget">Delete value</button>
      </template>
    </ModalDialog>
    <PackRemoveDialog v-model="removeOpen" :pack="pack" @removed="onRemoved" />
  </main>
</template>

<style scoped>
.form {
  display: grid;
  gap: var(--space-2);
}
.form p {
  margin: 0;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  margin-top: var(--space-1);
}
.title h1 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.kept {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font: inherit;
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.kept:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
.title {
  min-width: 0;
}
.path {
  margin-top: var(--space-1);
}
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.acts a.btn {
  text-decoration: none;
}
.problems h2 {
  color: var(--bad);
}
.problems ul {
  margin: var(--space-2) 0;
  padding-left: 18px;
}
.panel {
  overflow-x: auto;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
}
.tbl th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  font-size: 12px;
  padding: 4px 12px 6px 0;
}
.tbl td {
  padding: 7px 12px 7px 0;
  border-top: var(--border-width) solid var(--line);
  vertical-align: baseline;
}
.tbl tr.child .c-test {
  padding-left: var(--space-5);
}
/* The test cell takes the room the other columns leave, and its line ends in an ellipsis. */
.c-test {
  width: 100%;
  max-width: 0;
}
.tline {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.tline > * {
  flex: none;
}
.tline > .ttitle {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desc {
  max-width: 72ch;
  margin: 2px 0 0;
  white-space: pre-line;
}
.flaky {
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
  color: var(--warn);
  font-weight: 500;
  cursor: help;
}
.c-hist {
  width: 1%;
  white-space: nowrap;
}
.hist {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}
.hist-num {
  min-width: 4.5ch;
  text-align: right;
}
.hist-num + .hist-num {
  min-width: 7ch;
}
.tag {
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent-text);
}
.file {
  white-space: nowrap;
}
.edit {
  display: inline-flex;
  vertical-align: middle;
  margin-right: var(--space-1);
  padding: 3px;
  border-radius: var(--radius-sm);
  color: var(--muted);
}
.edit:hover {
  background: var(--hover);
  color: var(--text);
}
.panel.tests {
  overflow-x: visible;
}
.tbl-wrap {
  overflow-x: auto;
}
/* The search and filters stay under the top bar while a long list scrolls. */
.finder {
  position: sticky;
  top: 56px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin: 0 0 var(--space-2);
  padding: var(--space-2) 0;
  background: var(--surface);
  border-bottom: var(--border-width) solid var(--line);
}
.listbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
}
.listbar .count {
  margin: 0;
}
.listbar .btn {
  padding: 2px 10px;
  font-size: 13px;
}
.tbl tr.group th {
  padding: var(--space-4) 0 var(--space-1);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.tbl tbody:first-of-type tr.group th {
  padding-top: var(--space-1);
}
.fold {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 2px var(--space-2) 2px 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: inherit;
  font: inherit;
}
button.fold {
  cursor: pointer;
}
button.fold:hover {
  background: var(--hover);
}
button.fold > svg {
  color: var(--muted);
}
.finder > .search {
  flex: 1 1 260px;
  min-width: 0;
}
.finder > :deep(.sel) {
  flex: none;
  width: 170px;
}
.readme-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-5);
  padding-bottom: var(--space-3);
  border-bottom: var(--border-width) solid var(--line);
}
.readme-name {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;
}
.readme-name > svg {
  flex: none;
  color: var(--muted);
}
.readme-name .mono {
  overflow-wrap: anywhere;
}
.panel.readme {
  overflow-x: visible;
}
.readme .edit {
  margin-right: 0;
}
.file code {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.defs {
  display: grid;
  grid-template-columns: minmax(120px, max-content) minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  margin: 0;
}
.defs dd {
  margin: 0;
}
.sub {
  margin: var(--space-5) 0 var(--space-2);
  font-size: 13px;
  color: var(--muted);
}
.choice {
  display: inline-block;
  white-space: nowrap;
  margin: 2px 0 2px 4px;
  padding: 0 4px;
  border-radius: var(--radius-sm);
  background: var(--raised);
}
.choice-label {
  margin-left: 6px;
}
.kind {
  display: inline-block;
  padding: 0 8px;
  border-radius: var(--radius-chip);
  font-size: 12px;
  font-weight: 600;
}
.kind.robot {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.kind.finding {
  color: var(--bad);
  background: color-mix(in srgb, var(--bad) 12%, transparent);
}
.kind.info {
  color: var(--muted);
  background: var(--raised);
}
.runs-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.runs-head h2 {
  margin: 0;
}
.no-runs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}
.rlist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rlist li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: 6px 0;
  border-top: var(--border-width) solid var(--line);
}
.rid {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
}
.rid:hover .num {
  text-decoration: underline;
}
.rlabel {
  font-weight: 600;
  color: var(--text);
}
.tasks .intro {
  margin: 0 0 var(--space-3);
}
.note {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--raised);
}
.task-list,
.state-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.task {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-top: var(--border-width) solid var(--line);
}
.task:first-child {
  border-top: 0;
  padding-top: var(--space-1);
}
.task-text {
  flex: 1;
  min-width: 0;
}
.task .btn {
  flex: none;
}
.state-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: 6px 0;
  border-top: var(--border-width) solid var(--line);
}
.state-list li:first-child {
  border-top: 0;
}
.skey {
  font-weight: 600;
}
.sval {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--muted);
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover {
  color: var(--bad);
  background: var(--raised);
}
.rparams {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  color: var(--muted);
}
@media (max-width: 720px) {
  .task {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .task-text {
    flex-basis: 100%;
  }
  .finder > .search {
    flex-basis: 100%;
  }
  .finder > :deep(.sel) {
    flex: 1 1 140px;
    width: auto;
  }
  .finder {
    position: static;
  }
  .tbl,
  .tbl tbody {
    display: block;
  }
  .tbl thead {
    display: none;
  }
  .tbl tr.group th {
    flex-basis: 100%;
  }
  .tbl tr {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    padding: 8px 0;
    border-top: var(--border-width) solid var(--line);
  }
  .tbl tbody tr:first-child {
    border-top: 0;
  }
  .tbl td {
    border: 0;
    padding: 0;
    font-size: 13px;
  }
  .tbl td.c-test {
    flex-basis: 100%;
    max-width: 100%;
    min-width: 0;
    font-size: 14px;
  }
  .tbl tr.group {
    padding: 0;
    border-top: 0;
  }
  .tbl td.c-hist {
    flex-basis: 100%;
    order: 1;
  }
  .hist {
    justify-content: flex-start;
  }
  .tbl td[data-label]::before {
    content: attr(data-label) " ";
    color: var(--muted);
    font-family: var(--font-ui);
  }
  .tbl td.none,
  .tbl td.file {
    display: none;
  }
  .defs {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .defs dd {
    margin-bottom: var(--space-2);
  }
}
</style>
