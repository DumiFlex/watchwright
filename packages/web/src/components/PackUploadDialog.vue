<script setup lang="ts">
// Upload a pack as a .zip: the server unpacks it into a new folder and adds it. This is how packs
// reach a server with no desktop to copy them onto (docs/plans/self-hosting.md). A pack
// downloaded from another Watchwright (the pack's menu, Download .zip) uploads as it is. When the
// folder is there already (an update, or the folder a removed pack left), the server says what's
// in it and the dialog offers to replace its files; packs added from it keep their runs.
import { computed, ref, watch } from "vue";
import { TriangleAlert } from "../icons";
import { sendFile, type Pack } from "../api";
import FilePicker from "./FilePicker.vue";
import ModalDialog from "./ModalDialog.vue";
import PathInput from "./PathInput.vue";
import TextField from "./TextField.vue";

const props = defineProps<{ start: string | null; sep: string }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ added: [pack: Pack, replaced: boolean] }>();

/** What the server says is in the folder when it's there already. */
interface Existing {
  dir: string;
  packs: { id: string; name: string; dir: string }[];
  busy: string | null;
}

const files = ref<File[]>([]);
const name = ref("");
const folder = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const existing = ref<Existing | null>(null);

/** Up to 50 MB; the server says the same. */
const MAX = 50 * 1024 * 1024;

watch(open, (o) => {
  if (!o) return;
  files.value = [];
  name.value = "";
  folder.value = props.start ?? "";
  error.value = null;
  existing.value = null;
});
watch(files, (f) => {
  error.value = null;
  existing.value = null;
  if (f[0]) name.value = f[0].name.replace(/\.zip$/i, "");
});
watch([name, folder], () => (existing.value = null));

const target = computed(() => {
  const base = folder.value.trim().replace(/[\\/]+$/, "");
  return base && name.value.trim() ? `${base}${props.sep}${name.value.trim()}` : "";
});

function isExisting(d: unknown): d is Existing {
  return !!d && typeof d === "object" && typeof (d as Existing).dir === "string" && Array.isArray((d as Existing).packs);
}

async function upload(replace = false) {
  const file = files.value[0];
  if (!file) return;
  if (file.size > MAX) return void (error.value = "The zip is over 50 MB. Copy the pack onto the server instead.");
  busy.value = true;
  error.value = null;
  const q = new URLSearchParams({ name: name.value.trim() || file.name });
  if (folder.value.trim()) q.set("folder", folder.value.trim());
  if (replace) q.set("replace", "1");
  const res = await sendFile<Pack>(`/api/v1/packs/upload?${q.toString()}`, file);
  busy.value = false;
  if (!res.ok) {
    if (res.error.code === "exists" && isExisting(res.error.detail)) return void (existing.value = res.error.detail);
    return void (error.value = res.error.message);
  }
  open.value = false;
  emit("added", res.data, replace);
}

const packNames = computed(() => (existing.value?.packs ?? []).map((p) => `"${p.name}"`).join(", "));
</script>

<template>
  <ModalDialog v-model="open" heading="Upload a pack" width="560px">
    <form class="up" @submit.prevent="upload()">
      <p class="muted small">A .zip of a pack's folder, or of a folder holding packs and the files they share (as Download .zip makes it). It goes into a new folder on the server, and each pack in it is added. Pack code runs on the server, so upload only packs you trust.</p>
      <FilePicker id="up-file" v-model="files" accept=".zip,application/zip" />
      <div class="fields">
        <div class="fld">
          <label for="up-name" class="lbl small">Folder name</label>
          <TextField id="up-name" v-model="name" placeholder="shop" />
        </div>
        <div class="fld">
          <label for="up-folder" class="lbl small">Inside</label>
          <PathInput id="up-folder" v-model="folder" :placeholder="start ?? ''" />
        </div>
      </div>
      <p v-if="target && !existing" class="muted small">The pack goes into <code class="path">{{ target }}</code>. If that folder is there already, you can replace its files.</p>
      <section v-if="existing" class="exists" role="alert" aria-labelledby="up-exists">
        <h3 id="up-exists" class="ehead"><TriangleAlert :size="16" /> This folder is there already</h3>
        <p class="small"><code class="path">{{ existing.dir }}</code></p>
        <p v-if="existing.packs.length" class="small">
          Replacing it updates {{ existing.packs.length === 1 ? "the pack" : "the packs" }} {{ packNames }} added from it. {{ existing.packs.length === 1 ? "It keeps its" : "They keep their" }} runs, schedules and dashboard.
        </p>
        <p v-else class="small">No pack is added from it now: a removed pack leaves its folder behind. Replacing it adds the packs in the zip, and a pack that was added from there before gets its runs back.</p>
        <p class="small">Files in the folder that aren't in the zip are deleted. Installed dependencies (<code>node_modules</code>) stay.</p>
        <p v-if="existing.busy" class="error small">{{ existing.busy }}</p>
      </section>
      <p v-if="error" class="error small" role="alert">{{ error }}</p>
    </form>
    <template #actions>
      <button type="button" class="btn" @click="open = false">Cancel</button>
      <button v-if="existing" type="button" class="btn danger" :disabled="busy || !!existing.busy" @click="upload(true)">{{ busy ? "Replacing…" : "Replace its files" }}</button>
      <button v-else type="button" class="btn primary" :disabled="!files.length || !name.trim() || busy" @click="upload()">{{ busy ? "Uploading…" : "Upload and add" }}</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.up {
  display: grid;
  gap: var(--space-3);
}
.up p {
  margin: 0;
}
.fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: var(--space-2) var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.path {
  overflow-wrap: anywhere;
}
.exists {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--border-width) solid var(--warn);
  border-radius: var(--radius);
  background: var(--raised);
}
.ehead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--warn);
  font-size: 14px;
}
@media (max-width: 640px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
