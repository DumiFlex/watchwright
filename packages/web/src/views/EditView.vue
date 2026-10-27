<script setup lang="ts">
// Edit a pack: its text files in a tree, the open file in a code editor (or, for a YAML test,
// as a list of steps), problems as you type and after each save, and Run this test with the
// run's live view docked beside the editor. Saves carry the stamp the file was read with, so a
// change made elsewhere is never overwritten without asking. Unsaved edits stay in drafts.ts
// while moving between files and pages.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type ApiResult, type Pack, type RunSummary } from "../api";
import CodeEditor from "../components/CodeEditor.vue";
import DiffView from "../components/DiffView.vue";
import FileLink from "../components/FileLink.vue";
import MenuButton from "../components/MenuButton.vue";
import ModalDialog from "../components/ModalDialog.vue";
import RecordPanel from "../components/RecordPanel.vue";
import RunDock from "../components/RunDock.vue";
import SideDrawer from "../components/SideDrawer.vue";
import StatusChip from "../components/StatusChip.vue";
import StepsPanel from "../components/StepsPanel.vue";
import TabBar from "../components/TabBar.vue";
import TextField from "../components/TextField.vue";
import type { EditorProblem } from "../codemirror";
import { dirtyPaths, dropDraft, getDraft, putDraft } from "../drafts";
import { codeTestTemplate, defaultFile, fileTree, nextTestId, otherProblems, problemsIn, slug, testsInFile, yamlRole, yamlTestTemplate, type PackFile } from "../editfiles";
import { buildErrorSpot, type SourceSpot } from "../editor";
import { ArrowLeft, ChevronDown, CircleAlert, CircleDot, Ellipsis, FileCode, FilePlus, FileText, Folder, PanelLeft, Play, Save } from "../icons";
import { LiveConnection } from "../live";
import { join, relativeTo } from "../paths";
import { href } from "../router";
import { codeTestAt, insertCodeSteps, insertYamlSteps, yamlSpot, type YamlSpot } from "../recording";
import { readTests } from "../stepsdoc";
import { browserStore } from "../theme";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import { rangeAt } from "../yamlhints";
import { parseTestFile, type Problem } from "../yamlsteps";

const props = defineProps<{ id: string; file: string | null; line: number | null; record?: boolean }>();

const pack = ref<Pack | null>(null);
const files = ref<PackFile[]>([]);
const error = ref<string | null>(null);
const path = computed(() => props.file ?? defaultFile(pack.value, files.value));

// The open file.
interface Open {
  path: string;
  kind: PackFile["kind"];
  text: string;
  saved: string;
  stamp: string;
}
const open = ref<Open | null>(null);
const fileError = ref<string | null>(null);
const text = computed({
  get: () => open.value?.text ?? "",
  set: (t: string) => {
    if (!open.value) return;
    open.value.text = t;
    putDraft({ packId: props.id, path: open.value.path, text: t, saved: open.value.saved, stamp: open.value.stamp });
    dirty.value = dirtyPaths(props.id);
  },
});
const dirty = ref<string[]>(dirtyPaths(props.id));
const isDirty = computed(() => !!open.value && open.value.text !== open.value.saved);
const saving = ref(false);
const conflict = ref<{ text: string | null; stamp: string | null } | null>(null);
const editor = ref<InstanceType<typeof CodeEditor> | null>(null);
const cursorLine = ref(1);

const role = computed(() => (open.value ? yamlRole(open.value.path, pack.value) : null));
type View = "source" | "steps";
const store = browserStore();
const view = ref<View>(((): View => {
  try {
    return store?.getItem("ww.editor.view") === "steps" ? "steps" : "source";
  } catch {
    return "source";
  }
})());
watch(view, (v) => {
  try {
    store?.setItem("ww.editor.view", v);
  } catch {
    // remembered only when the browser allows it
  }
  if (v === "source") setTimeout(() => editor.value?.goto(cursorLine.value), 0);
});
const showSteps = computed(() => role.value === "test" && view.value === "steps");
const viewTabs = [
  { value: "source" as const, label: "Source" },
  { value: "steps" as const, label: "Steps" },
];

async function loadPack() {
  const [p, f] = await Promise.all([getJson<Pack>(`/api/v1/packs/${props.id}`), getJson<{ files: PackFile[]; truncated: boolean }>(`/api/v1/packs/${props.id}/files`)]);
  if (!p.ok) {
    error.value = p.error.code === "not_found" ? "There is no pack with this id. It may have been removed." : p.error.message;
    return;
  }
  error.value = p.data.missing ? "The pack's folder is gone. Locate it from the pack's page first." : null;
  pack.value = p.data;
  if (f.ok) files.value = f.data.files;
}

async function openFile(p: string | null) {
  conflict.value = null;
  fileError.value = null;
  if (!p) {
    open.value = null;
    return;
  }
  const draft = getDraft(props.id, p);
  if (draft) {
    open.value = { path: p, kind: files.value.find((f) => f.path === p)?.kind ?? "text", text: draft.text, saved: draft.saved, stamp: draft.stamp };
  } else {
    const res = await getJson<{ path: string; kind: PackFile["kind"]; text: string; stamp: string }>(`/api/v1/packs/${props.id}/file?path=${encodeURIComponent(p)}`);
    if (!res.ok) {
      open.value = null;
      fileError.value = res.error.message;
      return;
    }
    open.value = { path: res.data.path, kind: res.data.kind, text: res.data.text, saved: res.data.text, stamp: res.data.stamp };
  }
  cursorLine.value = props.line ?? 1;
  if (props.line) setTimeout(() => editor.value?.goto(props.line!), 0);
}

function go(file: string | null, line: number | null = null) {
  window.location.hash = href({ name: "edit", id: props.id, file, line });
  treeOpen.value = false;
}

async function save(force = false) {
  const o = open.value;
  if (!o || saving.value) return;
  if (!force && o.text === o.saved && !conflict.value) return;
  saving.value = true;
  const res = await sendJson<{ file: { path: string; stamp: string }; pack: Pick<Pack, "status" | "error" | "problems"> }>(`/api/v1/packs/${props.id}/file`, {
    path: o.path,
    text: o.text,
    ...(force ? {} : { stamp: o.stamp }),
  });
  saving.value = false;
  if (!res.ok) {
    if (res.error.code === "stale") {
      conflict.value = (res.error.detail as { text: string | null; stamp: string | null } | undefined) ?? { text: null, stamp: null };
      return;
    }
    return void toast(res.error.message, { tone: "bad" });
  }
  ownSaves.add(res.data.file.stamp);
  o.saved = o.text;
  o.stamp = res.data.file.stamp;
  conflict.value = null;
  dropDraft(props.id, o.path);
  dirty.value = dirtyPaths(props.id);
  if (pack.value) Object.assign(pack.value, res.data.pack);
  void loadPack();
  const own = problemsIn(res.data.pack.problems, o.path).length;
  if (res.data.pack.status === "ok") toast("Saved. The pack loads.", { tone: "ok" });
  else toast(own ? `Saved, with ${own === 1 ? "a problem" : `${own} problems`} in this file.` : "Saved. The pack doesn't load; see the problems.", { tone: "bad" });
}

function useDisk() {
  const o = open.value;
  const c = conflict.value;
  if (!o || !c) return;
  if (c.text === null) {
    dropDraft(props.id, o.path);
    dirty.value = dirtyPaths(props.id);
    go(null);
    return;
  }
  o.text = c.text;
  o.saved = c.text;
  o.stamp = c.stamp ?? o.stamp;
  conflict.value = null;
  dropDraft(props.id, o.path);
  dirty.value = dirtyPaths(props.id);
}
const diffOpen = ref(false);

// Problems: YAML test files are checked here as you type; pack.yaml by the server; code after a save.
const typed = ref<Problem[]>([]);
let checkTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [open.value?.text, role.value] as const,
  ([t, r]) => {
    if (checkTimer) clearTimeout(checkTimer);
    if (t === undefined || !r) {
      typed.value = [];
      return;
    }
    checkTimer = setTimeout(async () => {
      if (r === "test") typed.value = parseTestFile(t).problems;
      else {
        const res: ApiResult<{ problems: Problem[] }> = await sendJson("/api/v1/packs/check-yaml", { text: t, kind: "pack" });
        typed.value = res.ok ? res.data.problems : [];
      }
    }, 250);
  },
  { immediate: true },
);
const problems = computed<Problem[]>(() => {
  const o = open.value;
  if (!o) return [];
  if (role.value) return typed.value;
  return problemsIn(pack.value?.problems ?? [], o.path);
});
const editorProblems = computed<EditorProblem[]>(() =>
  problems.value.map((p) => {
    const r = p.from !== undefined ? { from: p.from, to: p.to ?? p.from } : rangeAt(text.value, p.line, p.col);
    return { ...r, severity: "error", message: p.message };
  }),
);
function showProblem(line: number, col: number) {
  view.value = "source";
  setTimeout(() => editor.value?.goto(line, col), 0);
}
const elsewhere = computed(() => (pack.value ? otherProblems(pack.value.problems, open.value?.path ?? null) : []));

// Tests in the open file, and the one the cursor is in.
const fileTests = computed(() => testsInFile(pack.value, open.value?.path ?? null));
const cursorTest = computed(() => {
  const list = fileTests.value;
  if (list.length <= 1) return list[0] ?? null;
  if (role.value !== "test") {
    const id = codeTestAt(text.value, cursorLine.value, list.map((t) => t.id));
    return list.find((t) => t.id === id) ?? list[0] ?? null;
  }
  const parsed = readTests(text.value);
  const at = parsed?.filter((t) => t.line <= cursorLine.value).at(-1);
  return list.find((t) => t.id === at?.id) ?? list[0] ?? null;
});
const runMenu = computed(() => fileTests.value.map((t) => ({ value: t.id, label: `${t.id} ${t.title !== t.id ? t.title : ""}`.trim() })));

// Run this test, with the values of the pack's last run.
const dockRun = ref<string | null>(null);
const starting = ref(false);
async function runTest(testId: string) {
  if (isDirty.value) await save();
  starting.value = true;
  const last = await getJson<RunSummary[]>(`/api/v1/runs?pack=${props.id}&limit=1`);
  const params = last.ok && last.data[0] ? last.data[0].params : {};
  const res = await sendJson<{ id: string }>("/api/v1/runs", { packId: props.id, tests: [testId], params, label: `Edit: ${testId}` });
  starting.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  dockRun.value = res.data.id;
}

// Record: steps from clicking on a recording browser go in at the cursor. The test runs up to the
// cursor first: a YAML test's steps above it, a code test's code down to its line.
const canWindow = ref(false);
const canRecord = computed(() => !!open.value && (role.value === "test" || (open.value.kind === "code" && fileTests.value.length > 0)) && pack.value?.status !== "error");
const recordMenu = computed(() => [
  { value: "here", label: "Record from here" },
  ...(canWindow.value ? [{ value: "window", label: "Record in a window" }] : []),
]);
interface Recording {
  testId: string | null;
  replay: number;
  /** A code test runs up to this line first. */
  codeLine: number | null;
  window: boolean;
  params: Record<string, unknown>;
  yaml: YamlSpot | null;
  line: number;
  path: string;
}
const recording = ref<Recording | null>(null);
const recordOpen = computed({ get: () => recording.value !== null, set: (v: boolean) => !v && (recording.value = null) });
async function startRecording(how: string) {
  const o = open.value;
  if (!o) return;
  const yaml = role.value === "test" ? yamlSpot(text.value, cursorLine.value) : null;
  if (role.value === "test" && !yaml) return void toast("Fix the YAML first: Record needs to know which test the cursor is in.", { tone: "bad" });
  const codeTest = role.value === "test" ? null : (cursorTest.value?.id ?? null);
  if (((yaml && yaml.index > 0) || codeTest) && isDirty.value) await save();
  const last = await getJson<RunSummary[]>(`/api/v1/runs?pack=${props.id}&limit=1`);
  recording.value = {
    testId: yaml?.testId ?? cursorTest.value?.id ?? null,
    replay: yaml?.index ?? 0,
    codeLine: codeTest ? cursorLine.value : null,
    window: how === "window",
    params: last.ok && last.data[0] ? last.data[0].params : {},
    yaml,
    line: cursorLine.value,
    path: o.path,
  };
}
function recorded(steps: { name: string; args: Record<string, unknown> }[]) {
  const r = recording.value;
  recording.value = null;
  if (!r || steps.length === 0 || open.value?.path !== r.path) return;
  text.value = r.yaml ? insertYamlSteps(text.value, r.yaml, steps) : insertCodeSteps(text.value, r.line, steps);
  toast(`Added ${steps.length === 1 ? "a step" : `${steps.length} steps`}. Save to keep ${steps.length === 1 ? "it" : "them"}.`, { tone: "ok" });
}

function gotoSpot(spot: SourceSpot) {
  const rel = pack.value ? relativeTo(pack.value.dir, spot.file) : null;
  if (!rel) return;
  if (rel === open.value?.path) showProblem(spot.line, spot.column ?? 1);
  else go(rel, spot.line);
}

// Files: new, rename, delete, convert.
const treeOpen = ref(false);
const tree = computed(() => fileTree(files.value));
const newKind = ref<"yaml" | "code" | "file" | null>(null);
const newOpen = computed({ get: () => newKind.value !== null, set: (v: boolean) => !v && (newKind.value = null) });
const newTitle = ref("");
const newPath = ref("");
const newId = ref("");
const newMenu = [
  { value: "yaml", label: "New YAML test…" },
  { value: "code", label: "New TypeScript test…" },
  { value: "file", label: "New file…" },
];
function startNew(kind: string) {
  newKind.value = kind as "yaml" | "code" | "file";
  newTitle.value = "";
  newId.value = nextTestId(pack.value, (pack.value?.tests[0]?.id.match(/^[A-Za-z]+/)?.[0] ?? "T").toUpperCase());
  newPath.value = kind === "file" ? "" : `tests/new-test.${kind === "yaml" ? "yaml" : "ts"}`;
}
watch(newTitle, (t) => {
  if (newKind.value && newKind.value !== "file") newPath.value = `tests/${slug(t || "new test")}.${newKind.value === "yaml" ? "yaml" : "ts"}`;
});
async function createFile() {
  const kind = newKind.value;
  if (!kind || !newPath.value.trim()) return;
  const title = newTitle.value.trim() || newId.value;
  const body = kind === "yaml" ? yamlTestTemplate(newId.value, title) : kind === "code" ? codeTestTemplate(newId.value, title) : "";
  const res = await sendJson<{ file: { path: string } }>(`/api/v1/packs/${props.id}/files`, { path: newPath.value.trim(), text: body });
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  newKind.value = null;
  await loadPack();
  go(res.data.file.path);
}

const renameOpen = ref(false);
const renameTo = ref("");
async function rename() {
  const o = open.value;
  if (!o || !renameTo.value.trim()) return;
  if (isDirty.value) await save();
  const res = await sendJson<{ to: string }>(`/api/v1/packs/${props.id}/file/rename`, { from: o.path, to: renameTo.value.trim() });
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  renameOpen.value = false;
  await loadPack();
  go(res.data.to);
}
const deleteOpen = ref(false);
async function remove() {
  const o = open.value;
  if (!o) return;
  const res = await sendJson(`/api/v1/packs/${props.id}/file?path=${encodeURIComponent(o.path)}`, {}, "DELETE");
  deleteOpen.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  dropDraft(props.id, o.path);
  dirty.value = dirtyPaths(props.id);
  toast(`Deleted ${o.path}`, { tone: "ok" });
  await loadPack();
  go(null);
}
const convertOpen = ref(false);
async function convert() {
  const o = open.value;
  if (!o) return;
  if (isDirty.value) await save();
  const res = await sendJson<{ file: string }>(`/api/v1/packs/${props.id}/convert`, { file: o.path });
  convertOpen.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Wrote ${res.data.file}`, { tone: "ok" });
  await loadPack();
  go(res.data.file);
}
const fileMenu = computed(() => [
  { value: "rename", label: "Rename or move…" },
  ...(role.value === "test" ? [{ value: "convert", label: "Convert to TypeScript…" }] : []),
  { value: "delete", label: "Delete…", danger: true },
]);
function newFromDrawer(v: string) {
  treeOpen.value = false;
  startNew(v);
}
function onFileMenu(v: string) {
  if (v === "rename") {
    renameTo.value = open.value?.path ?? "";
    renameOpen.value = true;
  } else if (v === "delete") deleteOpen.value = true;
  else if (v === "convert") convertOpen.value = true;
}

// Someone saved the open file elsewhere: take it when there are no edits here, else say so on save.
const ownSaves = new Set<string>();
let live: LiveConnection | null = null;
async function onFileEvent(data: Record<string, unknown>) {
  if (data.packId !== props.id) return;
  void loadPack();
  const o = open.value;
  if (!o || data.path !== o.path || data.action !== "save") return;
  if (typeof data.stamp === "string" && (ownSaves.has(data.stamp) || data.stamp === o.stamp)) return;
  if (o.text === o.saved) await openFile(o.path);
}

watch(
  () => [props.id, path.value] as const,
  ([, p], old) => {
    if (!old || p !== old[1] || !open.value) void openFile(p);
  },
);
watch(
  () => props.line,
  (l) => l && setTimeout(() => editor.value?.goto(l), 0),
);
onMounted(async () => {
  void getJson<{ canWindow: boolean }>("/api/v1/record").then((r) => (canWindow.value = r.ok && r.data.canWindow));
  await loadPack();
  await openFile(path.value);
  // "New recording" on the pack page lands here with a new test: start Record once, and drop the
  // flag from the address so a reload doesn't start another.
  if (props.record && open.value) {
    window.history.replaceState(null, "", href({ name: "edit", id: props.id, file: open.value.path, line: props.line }));
    if (canRecord.value) void startRecording("here");
  }
  live = new LiveConnection({}, {
    onEvent: (e) => {
      if (e.type === "editor.file_changed") void onFileEvent(e.data);
      else if (e.type.startsWith("pack.") && e.data.packId === props.id) void loadPack();
    },
  });
});
onBeforeUnmount(() => {
  live?.close();
  if (checkTimer) clearTimeout(checkTimer);
});

const iconOf = (k: PackFile["kind"]) => (k === "code" || k === "json" ? FileCode : FileText);
const problemSpot = (p: string) => buildErrorSpot(p);
</script>

<template>
  <main class="page edit-page">
    <p class="crumb"><a :href="href({ name: 'pack', id })"><ArrowLeft :size="15" />{{ pack?.name ?? "Pack" }}</a></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="pack && !error" class="layout" :class="{ docked: !!dockRun }">
      <nav class="files card" aria-label="Pack files">
        <div class="files-head">
          <span class="label">Files</span>
          <MenuButton :items="newMenu" label="New file" align="start" @select="startNew">
            <template #button><FilePlus :size="15" /></template>
          </MenuButton>
        </div>
        <ul class="tree">
          <li v-for="r in tree" :key="r.type + r.path" :style="{ '--depth': r.depth }">
            <span v-if="r.type === 'dir'" class="dir muted small"><Folder :size="14" />{{ r.name }}</span>
            <a v-else class="file small" :class="{ current: r.path === open?.path }" :aria-current="r.path === open?.path ? 'page' : undefined" :href="href({ name: 'edit', id, file: r.path, line: null })" @click="treeOpen = false">
              <component :is="iconOf(r.file.kind)" :size="14" />
              <span class="fname">{{ r.name }}</span>
              <span v-if="dirty.includes(r.path)" v-tip="'Unsaved changes'" class="dot" aria-label="unsaved"></span>
            </a>
          </li>
        </ul>
      </nav>

      <section class="main card" aria-label="Editor">
        <header class="bar">
          <button type="button" class="btn icon tree-btn" aria-label="Files" @click="treeOpen = true"><PanelLeft :size="16" /></button>
          <span class="fpath mono small">{{ open?.path ?? path ?? "" }}<span v-if="isDirty" v-tip="'Unsaved changes'" class="dot" aria-label="unsaved"></span></span>
          <StatusChip v-if="pack.status === 'error'" status="failed" class="loads" />
          <TabBar v-if="role === 'test'" v-model="view" :tabs="viewTabs" id-prefix="edit-view" label="Show the file as" class="views" />
          <span class="grow"></span>
          <div v-if="fileTests.length" class="runbtn">
            <button v-tip="cursorTest ? `Run ${cursorTest.id} with the pack's last values` : ''" type="button" class="btn" :disabled="starting || !cursorTest || pack.status === 'error'" @click="cursorTest && runTest(cursorTest.id)">
              <Play :size="15" /> Run {{ cursorTest?.id }}
            </button>
            <MenuButton v-if="fileTests.length > 1" :items="runMenu" label="Run another test in this file" @select="runTest">
              <template #button><ChevronDown :size="15" /></template>
            </MenuButton>
          </div>
          <div v-if="canRecord" class="runbtn">
            <button v-tip="'Record steps after the cursor; the test runs up to it first'" type="button" class="btn" @click="startRecording('here')"><CircleDot :size="15" /> Record</button>
            <MenuButton v-if="recordMenu.length > 1" :items="recordMenu" label="More ways to record" @select="startRecording">
              <template #button><ChevronDown :size="15" /></template>
            </MenuButton>
          </div>
          <button type="button" class="btn primary" :disabled="!open || saving || (!isDirty && !conflict)" aria-keyshortcuts="Control+S" @click="save()"><Save :size="15" /> {{ saving ? "Saving…" : "Save" }}</button>
          <MenuButton v-if="open" :items="fileMenu" label="More for this file" @select="onFileMenu">
            <template #button><Ellipsis :size="16" /></template>
          </MenuButton>
        </header>

        <div v-if="conflict" class="conflict" role="alert">
          <CircleAlert :size="16" />
          <span v-if="conflict.text === null">{{ open?.path }} was deleted since you opened it.</span>
          <span v-else>{{ open?.path }} changed on disk since you opened it.</span>
          <span class="grow"></span>
          <button v-if="conflict.text !== null" type="button" class="btn" @click="diffOpen = true">Show the changes</button>
          <button type="button" class="btn" @click="useDisk">{{ conflict.text === null ? "Close it" : "Use the file on disk" }}</button>
          <button type="button" class="btn danger" @click="save(true)">{{ conflict.text === null ? "Save mine again" : "Overwrite with mine" }}</button>
        </div>

        <p v-if="fileError" class="error pad" role="alert">{{ fileError }}</p>
        <p v-else-if="!open && !path" class="muted pad">This pack has no text files yet. Make one with the new file button.</p>
        <div v-if="open" class="body">
          <div v-show="!showSteps" id="edit-view-panel-source" class="pane" role="tabpanel" aria-labelledby="edit-view-tab-source">
            <CodeEditor
              :key="open.path"
              ref="editor"
              v-model="text"
              :lang="open.kind"
              :steps="role === 'test'"
              :problems="editorProblems"
              :label="`Contents of ${open.path}`"
              @save="save()"
              @cursor="(l) => (cursorLine = l)"
            />
          </div>
          <div v-if="showSteps" id="edit-view-panel-steps" class="pane steps" role="tabpanel" aria-labelledby="edit-view-tab-steps">
            <StepsPanel v-model="text" :problems="problems" :line="cursorLine" @cursor="(l) => (cursorLine = l)" />
          </div>
        </div>

        <footer v-if="open" class="problems" :class="{ none: !problems.length && !elsewhere.length }">
          <p v-if="!problems.length && !elsewhere.length" class="muted small ok">
            {{ role ? "No problems." : pack.status === "ok" ? "The pack loads." : "" }}<template v-if="!role && isDirty"> Save to check your changes.</template>
          </p>
          <ul v-if="problems.length">
            <li v-for="(p, i) in problems" :key="i">
              <button type="button" class="prob small" @click="showProblem(p.line, p.col)">
                <CircleAlert :size="14" /><span class="num">{{ p.line }}:{{ p.col }}</span><span>{{ p.message }}</span>
              </button>
            </li>
          </ul>
          <p v-if="elsewhere.length" class="small other">
            <span class="muted">{{ pack.status === "error" ? "The pack doesn't load:" : "Also:" }}</span>
            <template v-for="(p, i) in elsewhere.slice(0, 3)" :key="i">
              <a v-if="problemSpot(p) && files.some((f) => f.path === problemSpot(p)!.spot.file)" :href="href({ name: 'edit', id, file: problemSpot(p)!.spot.file, line: problemSpot(p)!.spot.line })">{{ p }}</a>
              <span v-else>{{ p }}</span>
            </template>
            <span v-if="elsewhere.length > 3" class="muted">and {{ elsewhere.length - 3 }} more</span>
            <span v-if="pack.error && !elsewhere.includes(pack.error)" class="muted">{{ pack.error }}</span>
          </p>
          <p class="where muted small">On disk: <FileLink :file="join(pack.dir, open.path)" :line="cursorLine" /></p>
        </footer>
      </section>

      <aside v-if="dockRun" class="dock card" aria-label="Run">
        <RunDock :run-id="dockRun" @close="dockRun = null" @goto="gotoSpot" />
      </aside>
    </div>

    <SideDrawer v-model="treeOpen" heading="Files" side="start" width="300px">
      <ul class="tree">
        <li v-for="r in tree" :key="r.type + r.path" :style="{ '--depth': r.depth }">
          <span v-if="r.type === 'dir'" class="dir muted small"><Folder :size="14" />{{ r.name }}</span>
          <button v-else type="button" class="file small" :class="{ current: r.path === open?.path }" @click="go(r.path)">
            <component :is="iconOf(r.file.kind)" :size="14" />
            <span class="fname">{{ r.name }}</span>
            <span v-if="dirty.includes(r.path)" class="dot" aria-label="unsaved"></span>
          </button>
        </li>
      </ul>
      <template #actions>
        <MenuButton :items="newMenu" label="New file" align="start" @select="newFromDrawer">
          <template #button><span class="newlabel"><FilePlus :size="15" /> New</span></template>
        </MenuButton>
      </template>
    </SideDrawer>

    <ModalDialog v-model="newOpen" :heading="newKind === 'yaml' ? 'New YAML test' : newKind === 'code' ? 'New TypeScript test' : 'New file'" width="480px">
      <form class="form" @submit.prevent="createFile">
        <template v-if="newKind !== 'file'">
          <label class="field-label" for="new-title">Title</label>
          <TextField id="new-title" v-model="newTitle" placeholder="Check out as a guest" />
          <label class="field-label" for="new-id">Test id</label>
          <TextField id="new-id" v-model="newId" />
        </template>
        <label class="field-label" for="new-path">File, in the pack folder</label>
        <TextField id="new-path" v-model="newPath" :placeholder="newKind === 'file' ? 'data/users.json' : ''" />
      </form>
      <template #actions>
        <button type="button" class="btn" @click="newKind = null">Cancel</button>
        <button type="button" class="btn primary" :disabled="!newPath.trim()" @click="createFile">Make it</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="renameOpen" heading="Rename or move" width="480px">
      <form class="form" @submit.prevent="rename">
        <label class="field-label" for="rename-to">New path, in the pack folder</label>
        <TextField id="rename-to" v-model="renameTo" />
      </form>
      <template #actions>
        <button type="button" class="btn" @click="renameOpen = false">Cancel</button>
        <button type="button" class="btn primary" :disabled="!renameTo.trim() || renameTo === open?.path" @click="rename">Rename</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="deleteOpen" heading="Delete this file?">
      <p><code>{{ open?.path }}</code> is deleted from the pack folder. This can't be undone here.</p>
      <template #actions>
        <button type="button" class="btn" @click="deleteOpen = false">Cancel</button>
        <button type="button" class="btn danger" @click="remove">Delete</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="convertOpen" heading="Convert to TypeScript?">
      <p>Writes the same tests as <code>{{ open?.path.replace(/\.ya?ml$/i, ".ts") }}</code>, one <code>h</code> or <code>expect</code> call per step with your comments kept, and removes the YAML file once the new one loads.</p>
      <template #actions>
        <button type="button" class="btn" @click="convertOpen = false">Cancel</button>
        <button type="button" class="btn primary" @click="convert">Convert</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="recordOpen" :heading="recording?.window ? 'Recording in a window' : 'Recording'" width="min(1280px, 100%)" :dismissable="false">
      <RecordPanel v-if="recording" :pack-id="id" :test-id="recording.testId" :replay="recording.replay" :line="recording.codeLine" :window="recording.window" :params="recording.params" @done="recorded" @cancel="recording = null" />
    </ModalDialog>
    <ModalDialog v-model="diffOpen" heading="Changes on disk" width="860px">
      <DiffView v-if="conflict?.text != null && open" :before="conflict.text" :after="open.text" label="The file on disk and your version" before-label="On disk" after-label="Yours" />
    </ModalDialog>
  </main>
</template>

<style scoped>
.edit-page {
  max-width: none;
  padding: var(--space-4) var(--space-5);
  gap: var(--space-3);
}
.layout {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: var(--space-3);
  height: calc(100dvh - 150px);
  min-height: 420px;
}
.layout.docked {
  grid-template-columns: 230px minmax(0, 1fr) minmax(320px, 30%);
}
.card {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.files {
  overflow: auto;
}
.files-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  border-bottom: var(--border-width) solid var(--line);
}
.tree {
  list-style: none;
  margin: 0;
  padding: var(--space-2) 0;
}
.tree li {
  padding-left: calc(var(--depth) * 14px);
}
.dir,
.file {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px var(--space-3);
  min-height: 28px;
}
.file {
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.file:hover {
  background: var(--hover);
}
.file.current {
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}
.fname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  flex: none;
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--warn);
}
.main {
  overflow: hidden;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: var(--border-width) solid var(--line);
}
.fpath {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  overflow-wrap: anywhere;
}
.views {
  margin-left: var(--space-2);
}
.views :deep(.tabs),
.views:deep(nav) {
  border-bottom: 0;
}
.grow {
  flex: 1;
}
.runbtn {
  display: inline-flex;
  gap: 2px;
}
.btn.icon {
  padding: 6px;
}
.tree-btn {
  display: none;
}
.conflict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  border-bottom: var(--border-width) solid var(--line);
  color: var(--text);
}
.conflict > svg {
  color: var(--warn);
}
.pad {
  padding: var(--space-4);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.pane.steps {
  overflow: auto;
}
.problems {
  max-height: 30%;
  overflow: auto;
  padding: var(--space-2) var(--space-3);
  border-top: var(--border-width) solid var(--line);
  display: grid;
  gap: var(--space-1);
}
.problems ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.problems p {
  margin: 0;
}
.prob {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  padding: 3px 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.prob:hover {
  background: var(--hover);
}
.prob svg {
  flex: none;
  color: var(--bad);
  align-self: center;
}
.prob .num {
  color: var(--muted);
  min-width: 5ch;
}
.other {
  display: flex;
  flex-wrap: wrap;
  gap: 4px var(--space-2);
  overflow-wrap: anywhere;
}
.dock {
  padding: var(--space-3);
  overflow: auto;
}
.form {
  display: grid;
  gap: var(--space-2);
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  margin-top: var(--space-1);
}
.newlabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
@media (max-width: 1100px) {
  .layout.docked {
    grid-template-columns: 200px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    height: auto;
  }
  .layout.docked .main {
    height: calc(100dvh - 150px);
  }
  .layout.docked .dock {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .edit-page {
    padding: var(--space-3);
  }
  .layout,
  .layout.docked {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }
  .files {
    display: none;
  }
  .main,
  .layout.docked .main {
    height: calc(100dvh - 130px);
  }
  .layout.docked .dock {
    grid-column: auto;
  }
  .tree-btn {
    display: inline-flex;
  }
  .views {
    margin-left: 0;
  }
}
</style>
