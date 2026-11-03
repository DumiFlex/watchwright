<script setup lang="ts">
// Remove a pack: it leaves the list, its runs stay. An admin can also delete its folder from the
// server, the way to clear out a pack for good on a server with no desktop. The server refuses
// that while a run of the pack is going on, or when the folder holds another pack.
import { ref, watch } from "vue";
import { sendJson, type Pack } from "../api";
import { can } from "../session";
import CheckBox from "./CheckBox.vue";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ pack: Pack | null }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ removed: [pack: Pack, deleted: boolean] }>();

const deleteFiles = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

watch(open, (o) => {
  if (!o) return;
  deleteFiles.value = false;
  error.value = null;
});
watch(deleteFiles, () => (error.value = null));

async function remove() {
  const p = props.pack;
  if (!p) return;
  busy.value = true;
  error.value = null;
  const del = deleteFiles.value && !p.missing;
  const res = await sendJson(`/api/v1/packs/${p.id}${del ? "?deleteFiles=true" : ""}`, {}, "DELETE");
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  open.value = false;
  emit("removed", p, del);
}
</script>

<template>
  <ModalDialog v-model="open" heading="Remove this pack?">
    <div v-if="pack" class="rm">
      <p v-if="deleteFiles">
        <strong>{{ pack.name }}</strong> leaves the list and its folder is deleted from the server, with every file in it. Its earlier runs stay in the runs list. This can't be undone.
      </p>
      <p v-else>
        <strong>{{ pack.name }}</strong> leaves the list. Its folder and files stay as they are, and its earlier runs stay in the runs list. Add the folder again later and the pack gets its runs back.
      </p>
      <div v-if="can('admin') && !pack.missing" class="opt">
        <CheckBox id="rm-files" v-model="deleteFiles">Also delete its folder from the server</CheckBox>
        <code class="path small">{{ pack.dir }}</code>
      </div>
      <p v-if="error" class="error small" role="alert">{{ error }}</p>
    </div>
    <template #actions>
      <button type="button" class="btn" @click="open = false">Cancel</button>
      <button type="button" class="btn danger" :disabled="busy" @click="remove">{{ busy ? "Removing…" : deleteFiles ? "Remove and delete files" : "Remove pack" }}</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.rm {
  display: grid;
  gap: var(--space-3);
}
.rm p {
  margin: 0;
}
.opt {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
}
.path {
  padding-left: calc(16px + var(--space-2));
  color: var(--muted);
  overflow-wrap: anywhere;
}
</style>
