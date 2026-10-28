<script setup lang="ts">
// Packs: every pack the server knows, whether it loads, and the ways to add one: a path field
// that completes folders as you type, a folder browser, and a search for packs in a folder.
// The server lists the folders (a page can't learn a folder's path; docs/plans/step-qol.md).
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Ellipsis, FolderOpen, Package, TriangleAlert } from "../icons";
import { getJson, sendJson, type FolderPlaces, type Pack } from "../api";
import { ago, when } from "../format";
import { LiveConnection } from "../live";
import { toast } from "../toasts";
import MenuButton from "../components/MenuButton.vue";
import EmptyState from "../components/EmptyState.vue";
import ModalDialog from "../components/ModalDialog.vue";
import PackFolderDialog from "../components/PackFolderDialog.vue";
import PathInput from "../components/PathInput.vue";
import PathLine from "../components/PathLine.vue";
import SkeletonBlock from "../components/SkeletonBlock.vue";
import StatusChip from "../components/StatusChip.vue";
import { vTip } from "../tooltip";
import { replaceRoute } from "../router";

const props = defineProps<{ query: Record<string, string> }>();

const packs = ref<Pack[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const newPath = ref("");
const addError = ref<string | null>(null);
const adding = ref(false);
const reloading = ref<string | null>(null);
const home = ref<string | null>(null);

const dialogOpen = ref(false);
const dialogMode = ref<"add" | "find" | "move">("add");
const moving = ref<Pack | null>(null);
const removing = ref<Pack | null>(null);
const removeOpen = computed({ get: () => removing.value !== null, set: (v) => (v ? undefined : (removing.value = null)) });

async function load() {
  const res = await getJson<Pack[]>("/api/v1/packs");
  loading.value = false;
  if (!res.ok) return void (loadError.value = res.error.message);
  loadError.value = null;
  packs.value = res.data;
}

async function addPack() {
  if (!newPath.value.trim()) return;
  addError.value = null;
  adding.value = true;
  const res = await sendJson<Pack>("/api/v1/packs", { path: newPath.value });
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

function browse(mode: "add" | "find") {
  dialogMode.value = mode;
  moving.value = null;
  dialogOpen.value = true;
}
function locate(p: Pack) {
  dialogMode.value = "move";
  moving.value = p;
  dialogOpen.value = true;
}
function onAdded(list: Pack[]) {
  void load();
  if (list.length === 1) window.location.hash = `#/packs/${list[0]!.id}`;
  else toast(`Added ${list.length} packs`, { tone: "ok" });
}
function onMoved(p: Pack) {
  void load();
  toast(`"${p.name}" now loads from its new folder`, { tone: "ok" });
}

async function confirmRemove() {
  const p = removing.value;
  if (!p) return;
  const res = await sendJson(`/api/v1/packs/${p.id}`, {}, "DELETE");
  removing.value = null;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Removed "${p.name}"`, { tone: "ok" });
  await load();
}

const menu = [
  { value: "move", label: "Move to another folder…" },
  { value: "remove", label: "Remove…", danger: true },
];
function onMenu(p: Pack, v: string) {
  if (v === "move") locate(p);
  else if (v === "remove") removing.value = p;
}

function sections(p: Pack): string {
  const s = new Set(p.tests.map((t) => t.section).filter((x): x is string => !!x));
  return s.size ? `${s.size} section${s.size === 1 ? "" : "s"}` : "";
}

// #/packs?browse=add (or find) opens the folder browser, as Ctrl+K's "Add a pack" does.
function browseFromQuery(q: Record<string, string>) {
  if (q.browse !== "add" && q.browse !== "find") return;
  browse(q.browse);
  replaceRoute({ name: "packs", query: {} });
}
watch(() => props.query, browseFromQuery);

let live: LiveConnection | null = null;
onMounted(async () => {
  browseFromQuery(props.query);
  void load();
  live = new LiveConnection({}, { onEvent: (e) => e.type.startsWith("pack.") && void load() });
  const places = await getJson<FolderPlaces>("/api/v1/folders/places");
  if (places.ok) home.value = places.data.home;
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

    <ul v-if="loading" class="packs" aria-busy="true" aria-label="Loading packs">
      <li v-for="i in 3" :key="i" class="card pk">
        <SkeletonBlock width="45%" height="1.2em" />
        <SkeletonBlock :lines="2" />
        <SkeletonBlock width="70%" />
        <div class="acts">
          <SkeletonBlock shape="block" width="88px" height="32px" />
          <SkeletonBlock shape="block" width="72px" height="32px" />
        </div>
      </li>
    </ul>
    <ul v-else-if="packs.length" class="packs">
      <li v-for="p in packs" :key="p.id" class="card pk" :class="{ gone: p.missing }">
        <div class="top">
          <a class="pname display" :href="`#/packs/${p.id}`">{{ p.name }}</a>
          <StatusChip v-if="p.status === 'error' && !p.missing" status="failed" />
        </div>
        <p v-if="p.description" class="desc">{{ p.description }}</p>
        <p class="facts muted small">
          {{ p.tests.length }} tests<template v-if="sections(p)"> · {{ sections(p) }}</template> · {{ p.browser }}<template v-if="p.baseURL"> · {{ p.baseURL }}</template>
        </p>
        <PathLine :path="p.dir" :home="home" :openable="!p.missing" />
        <p v-if="p.missing" class="warn small">
          <TriangleAlert :size="14" />
          The pack's folder is gone. If it moved, locate it; its runs stay.
        </p>
        <p v-else-if="p.status === 'error'" class="error small">{{ p.error }}</p>
        <div class="acts">
          <button v-if="p.missing" class="btn primary" @click="locate(p)">Locate…</button>
          <a v-else class="btn primary" :href="`#/new?pack=${p.id}`" :aria-disabled="p.status === 'error'" :class="{ off: p.status === 'error' }">New run</a>
          <button v-if="!p.missing" v-tip="'Build the pack again now'" class="btn" :disabled="reloading === p.id" @click="reload(p.id)">{{ reloading === p.id ? "Reloading…" : "Reload" }}</button>
          <span v-if="p.loadedAt && !p.missing" v-tip="when(p.loadedAt)" class="muted small">built {{ ago(p.loadedAt) }}</span>
          <MenuButton class="more" :items="menu" :label="`More for ${p.name}`" @select="onMenu(p, $event)">
            <template #button><Ellipsis :size="16" /></template>
          </MenuButton>
        </div>
      </li>
    </ul>
    <section v-else-if="!loadError" class="card">
      <EmptyState :icon="Package" heading="No packs yet">
        <p>A pack is a folder with a pack file (<code>pack.ts</code> or <code>pack.yaml</code>) and its tests, usually in the repository of the site it tests. Add one you have (the folder browser can also search a folder and the ones below it), or pick a folder and choose <strong>New pack here</strong> for a small starter pack.</p>
        <template #actions>
          <button type="button" class="btn primary" @click="browse('add')"><FolderOpen :size="15" /> Add a pack…</button>
        </template>
      </EmptyState>
    </section>

    <section class="card" aria-labelledby="add-title">
      <h2 id="add-title" class="display">Add a pack</h2>
      <form class="add" @submit.prevent="addPack">
        <label class="sr-only" for="pack-path">Pack folder</label>
        <PathInput
          id="pack-path"
          v-model="newPath"
          class="grow"
          placeholder="Folder with the pack file, e.g. D:\sites\shop\watchwright or ~/sites/shop/watchwright"
          :invalid="!!addError"
          mark="pack"
          mark-label="Pack"
          @submit="addPack"
          @update:model-value="addError = null"
        />
        <button type="button" class="btn" @click="browse('add')"><FolderOpen :size="15" /> Browse…</button>
        <button class="btn primary" type="submit" :disabled="!newPath.trim() || adding">{{ adding ? "Adding…" : "Add pack" }}</button>
      </form>
      <p v-if="addError" class="error small" role="alert">{{ addError }}</p>
      <p class="muted small hint">Pack code runs on this machine with your rights, so add only packs you trust.</p>
    </section>

    <PackFolderDialog v-model="dialogOpen" :mode="dialogMode" :packs="packs" :moving="moving" :home="home" @added="onAdded" @moved="onMoved" />

    <ModalDialog v-model="removeOpen" heading="Remove this pack?">
      <p v-if="removing">
        <strong>{{ removing.name }}</strong> leaves the list. Its folder and files stay as they are, and its earlier runs stay in the runs list. You can add it again later.
      </p>
      <template #actions>
        <button class="btn" @click="removing = null">Cancel</button>
        <button class="btn danger" @click="confirmRemove">Remove pack</button>
      </template>
    </ModalDialog>
  </main>
</template>

<style scoped>
.packs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
  gap: var(--space-4);
}
.pk {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  min-width: 0;
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
.gone .pname {
  color: var(--muted);
}
.warn {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  color: var(--warn);
}
.warn svg {
  flex: none;
  margin-top: 2px;
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
.more {
  margin-left: auto;
}
.btn.off {
  opacity: 0.5;
  pointer-events: none;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.add {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.grow {
  flex: 1;
}
.hint {
  margin: var(--space-2) 0 0;
}
@media (max-width: 720px) {
  .add {
    flex-direction: column;
    align-items: stretch;
  }
  .add .btn {
    justify-content: center;
  }
}
</style>
