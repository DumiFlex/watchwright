<script setup lang="ts">
// Upload a pack as a .zip: the server unpacks it into a new folder and adds it. This is how packs
// reach a server with no desktop to copy them onto (docs/plans/self-hosting.md). A pack
// downloaded from another Watchwright (the pack's menu, Download .zip) uploads as it is.
import { computed, ref, watch } from "vue";
import { sendFile, type Pack } from "../api";
import FilePicker from "./FilePicker.vue";
import ModalDialog from "./ModalDialog.vue";
import PathInput from "./PathInput.vue";
import TextField from "./TextField.vue";

const props = defineProps<{ start: string | null; sep: string }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ added: [pack: Pack] }>();

const files = ref<File[]>([]);
const name = ref("");
const folder = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

/** Up to 50 MB; the server says the same. */
const MAX = 50 * 1024 * 1024;

watch(open, (o) => {
  if (!o) return;
  files.value = [];
  name.value = "";
  folder.value = props.start ?? "";
  error.value = null;
});
watch(files, (f) => {
  error.value = null;
  if (f[0]) name.value = f[0].name.replace(/\.zip$/i, "");
});

const target = computed(() => {
  const base = folder.value.trim().replace(/[\\/]+$/, "");
  return base && name.value.trim() ? `${base}${props.sep}${name.value.trim()}` : "";
});

async function upload() {
  const file = files.value[0];
  if (!file) return;
  if (file.size > MAX) return void (error.value = "The zip is over 50 MB. Copy the pack onto the server instead.");
  busy.value = true;
  error.value = null;
  const q = new URLSearchParams({ name: name.value.trim() || file.name });
  if (folder.value.trim()) q.set("folder", folder.value.trim());
  const res = await sendFile<Pack>(`/api/v1/packs/upload?${q.toString()}`, file);
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  open.value = false;
  emit("added", res.data);
}
</script>

<template>
  <ModalDialog v-model="open" heading="Upload a pack" width="560px">
    <form class="up" @submit.prevent="upload">
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
      <p v-if="target" class="muted small">The pack goes into <code class="path">{{ target }}</code>, which must not exist yet.</p>
      <p v-if="error" class="error small" role="alert">{{ error }}</p>
    </form>
    <template #actions>
      <button type="button" class="btn" @click="open = false">Cancel</button>
      <button type="button" class="btn primary" :disabled="!files.length || !name.trim() || busy" @click="upload">{{ busy ? "Uploading…" : "Upload and add" }}</button>
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
@media (max-width: 640px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
