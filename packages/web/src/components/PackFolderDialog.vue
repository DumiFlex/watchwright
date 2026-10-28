<script setup lang="ts">
// The folder browser for packs, in a dialog. Three uses:
// - add:  browse to a pack folder and add it (or search the open folder for packs),
// - find: search a folder and the ones below it for pack files and add the ones you tick,
// - move: point a pack whose folder moved at its new folder (it keeps its runs).
import { computed, ref, watch } from "vue";
import { FolderPlus, FolderSearch, Package } from "../icons";
import { sendJson, type FolderListing, type FoundPack, type Pack } from "../api";
import { join, tildify } from "../paths";
import CheckBox from "./CheckBox.vue";
import FolderBrowser from "./FolderBrowser.vue";
import ModalDialog from "./ModalDialog.vue";
import PathInput from "./PathInput.vue";
import RadioGroup from "./RadioGroup.vue";
import TextField from "./TextField.vue";

const props = defineProps<{ mode: "add" | "find" | "move"; packs: readonly Pack[]; moving?: Pack | null; home?: string | null; start?: string | null }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ added: [packs: Pack[]]; moved: [pack: Pack] }>();

const path = ref<string | null>(null);
const listing = ref<FolderListing | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
// find results: shown in place of the browser until "Back"
const found = ref<{ root: string; found: FoundPack[]; truncated: boolean } | null>(null);
const picked = ref<Record<string, boolean>>({});
const FORMATS = [
  { value: "yaml" as const, label: "YAML", note: "steps, no code" },
  { value: "code" as const, label: "TypeScript", note: "full control" },
];
// the starter pack form, shown in place of the browser until "Back"
const creating = ref(false);
const starter = ref<{ path: string; name: string; baseURL: string; format: "yaml" | "code" }>({ path: "", name: "", baseURL: "", format: "yaml" });

watch(open, (o) => {
  if (!o) return;
  path.value = props.start ?? (props.moving ? parentOf(props.moving.dir) : null);
  found.value = null;
  creating.value = false;
  error.value = null;
});

function startNew() {
  const here = listing.value;
  starter.value = { path: here ? (here.marks.pack ? join(here.path, "watchwright") : here.folders.length === 0 ? here.path : join(here.path, "watchwright")) : "", name: "", baseURL: "http://127.0.0.1:3000/", format: starter.value.format };
  error.value = null;
  creating.value = true;
}

async function create() {
  busy.value = true;
  error.value = null;
  const res = await sendJson<Pack>("/api/v1/packs/create", starter.value);
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  emit("added", [res.data]);
  open.value = false;
}

function parentOf(dir: string): string {
  const cut = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
  return cut > 0 ? dir.slice(0, cut) : dir;
}

const heading = computed(() => (props.mode === "move" ? `Locate "${props.moving?.name ?? "pack"}"` : props.mode === "find" ? "Find packs in a folder" : creating.value ? "Start a new pack" : "Add a pack"));
const places = computed(() => props.packs.filter((p) => !p.missing).map((p) => ({ label: p.name, path: p.dir })));
const packHere = computed(() => listing.value?.marks.pack ?? null);
const addedHere = computed(() => props.packs.find((p) => p.dir === listing.value?.path) ?? null);

async function addHere() {
  if (!listing.value) return;
  busy.value = true;
  const res = await sendJson<Pack>("/api/v1/packs", { path: listing.value.path });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  emit("added", [res.data]);
  open.value = false;
}

async function moveHere() {
  if (!listing.value || !props.moving) return;
  busy.value = true;
  const res = await sendJson<Pack>(`/api/v1/packs/${props.moving.id}/move`, { path: listing.value.path });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  emit("moved", res.data);
  open.value = false;
}

async function search() {
  if (!listing.value) return;
  busy.value = true;
  error.value = null;
  const res = await sendJson<{ root: string; found: FoundPack[]; truncated: boolean }>("/api/v1/packs/discover", { path: listing.value.path });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  found.value = res.data;
  picked.value = Object.fromEntries(res.data.found.filter((f) => !f.packId).map((f) => [f.dir, true]));
}

const toAdd = computed(() => (found.value?.found ?? []).filter((f) => !f.packId && picked.value[f.dir]));
async function addPicked() {
  busy.value = true;
  error.value = null;
  const added: Pack[] = [];
  const failed: string[] = [];
  for (const f of toAdd.value) {
    const res = await sendJson<Pack>("/api/v1/packs", { path: f.dir });
    if (res.ok) added.push(res.data);
    else failed.push(`${f.dir}: ${res.error.message}`);
  }
  busy.value = false;
  if (added.length) emit("added", added);
  if (failed.length) error.value = failed.join("\n");
  else open.value = false;
}

function rel(dir: string): string {
  const root = found.value?.root ?? "";
  return dir.startsWith(root) ? dir.slice(root.length).replace(/^[\\/]/, "") || "." : tildify(dir, props.home);
}
</script>

<template>
  <ModalDialog v-model="open" :heading="heading" width="860px">
    <form v-if="creating" class="starter" @submit.prevent="create">
      <p class="muted">Writes a small pack that works: a pack file for the site and browser, a first test that opens the site and takes a screenshot, and a <code>README.md</code>. Then it adds the pack. Nothing that's already there is overwritten.</p>
      <span class="field-label">Written in</span>
      <RadioGroup v-model="starter.format" label="Written in" inline :options="FORMATS" />
      <label for="st-name">Name</label>
      <TextField id="st-name" v-model="starter.name" placeholder="My shop" />
      <label for="st-url">Site address</label>
      <TextField id="st-url" v-model="starter.baseURL" type="url" placeholder="http://127.0.0.1:3000/" />
      <label for="st-path">Folder (made when missing)</label>
      <PathInput id="st-path" v-model="starter.path" mark="pack" mark-label="Pack" @submit="create" />
    </form>
    <template v-else-if="found">
      <p class="muted">
        <template v-if="found.found.length">Found {{ found.found.length }} pack{{ found.found.length === 1 ? "" : "s" }} in <code>{{ tildify(found.root, home) }}</code>.</template>
        <template v-else>No pack files in <code>{{ tildify(found.root, home) }}</code> or the 4 levels of folders below it.</template>
        <template v-if="found.truncated"> The search stopped early; pick a smaller folder to see everything.</template>
      </p>
      <ul v-if="found.found.length" class="found">
        <li v-for="f in found.found" :key="f.dir">
          <CheckBox v-if="!f.packId" :model-value="!!picked[f.dir]" @update:model-value="picked[f.dir] = $event">
            <span class="fdir">{{ rel(f.dir) }}</span>
            <span class="muted small">{{ f.packFile }}</span>
          </CheckBox>
          <span v-else class="already">
            <Package :size="15" />
            <span class="fdir">{{ rel(f.dir) }}</span>
            <span class="muted small">already added</span>
          </span>
        </li>
      </ul>
    </template>
    <FolderBrowser v-else v-model:path="path" :places="places" :mark-labels="{ pack: 'Pack' }" @listing="listing = $event">
      <template #footer="{ listing: l }">
        <p v-if="l && mode !== 'find'" class="here small" :class="packHere ? 'ok' : 'muted'">
          <template v-if="addedHere && mode === 'add'">This pack is already added as "{{ addedHere.name }}".</template>
          <template v-else-if="packHere">This folder has a pack: {{ packHere }}.</template>
          <template v-else>No pack file in this folder. Open the folder that has <code>pack.ts</code> or <code>pack.yaml</code>, or search this one.</template>
        </p>
      </template>
    </FolderBrowser>
    <p v-if="error" class="error small pre" role="alert">{{ error }}</p>

    <template #actions>
      <template v-if="creating">
        <button class="btn" :disabled="busy" @click="creating = false">Back</button>
        <button class="btn primary" :disabled="busy || !starter.name.trim() || !starter.baseURL.trim() || !starter.path.trim()" @click="create">{{ busy ? "Writing…" : "Write the pack and add it" }}</button>
      </template>
      <template v-else-if="found">
        <button class="btn" :disabled="busy" @click="found = null">Back</button>
        <button class="btn primary" :disabled="busy || toAdd.length === 0" @click="addPicked">{{ busy ? "Adding…" : `Add ${toAdd.length} pack${toAdd.length === 1 ? "" : "s"}` }}</button>
      </template>
      <template v-else-if="mode === 'move'">
        <button class="btn" @click="open = false">Cancel</button>
        <button class="btn primary" :disabled="busy || !packHere" @click="moveHere">{{ busy ? "Moving…" : "Use this folder" }}</button>
      </template>
      <template v-else>
        <button class="btn" :class="{ primary: mode === 'find' }" :disabled="busy || !listing" @click="search"><FolderSearch :size="15" /> {{ mode === "find" ? "Search this folder" : "Find packs here" }}</button>
        <button v-if="mode === 'add'" class="btn" :disabled="busy || !listing" @click="startNew"><FolderPlus :size="15" /> New pack here…</button>
        <button v-if="mode === 'add'" class="btn primary" :disabled="busy || !packHere || !!addedHere" @click="addHere">{{ busy ? "Adding…" : "Add this pack" }}</button>
      </template>
    </template>
  </ModalDialog>
</template>

<style scoped>
.here {
  margin: 0;
}
.here.ok {
  color: var(--ok);
}
.found {
  display: grid;
  gap: var(--space-2);
  max-height: 380px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.fdir {
  margin-right: var(--space-2);
  font-family: var(--font-mono);
  font-size: 13px;
  word-break: break-all;
}
.already {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--muted);
}
.starter {
  display: grid;
  gap: var(--space-1);
}
.starter p {
  margin: 0 0 var(--space-2);
}
.starter > label,
.starter > .field-label {
  margin-top: var(--space-2);
  font-weight: 600;
  font-size: 13px;
}
.pre {
  white-space: pre-line;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
</style>
