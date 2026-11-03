<script setup lang="ts">
// Remove a pack: it leaves the list, its runs stay. An admin can also delete its folder from the
// server, the way to clear out a pack for good on a server with no desktop. The server refuses
// that while a run of the pack is going on. Packs inside its folder (bench/smoke) go with it, and
// for the last pack of an upload the dialog offers the whole uploaded folder, shared files and all.
import { computed, ref, watch } from "vue";
import { getJson, sendJson, type Pack } from "../api";
import { can } from "../session";
import CheckBox from "./CheckBox.vue";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ pack: Pack | null }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ removed: [pack: Pack, deleted: boolean] }>();

interface RemovePlan {
  dir: string;
  nested: { id: string; name: string; dir: string }[];
  leftover: { dir: string } | null;
}

const deleteFiles = ref(false);
const leftover = ref(false);
const plan = ref<RemovePlan | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

watch(open, (o) => {
  if (!o) return;
  deleteFiles.value = false;
  leftover.value = false;
  error.value = null;
  plan.value = null;
  const p = props.pack;
  if (p && can("admin") && !p.missing) void getJson<RemovePlan>(`/api/v1/packs/${p.id}/remove-plan`).then((r) => (plan.value = r.ok && props.pack?.id === p.id ? r.data : null));
});
watch([deleteFiles, leftover], () => (error.value = null));

const target = computed(() => (leftover.value && plan.value?.leftover ? plan.value.leftover.dir : (props.pack?.dir ?? "")));
const nestedNames = computed(() => (plan.value?.nested ?? []).map((p) => `"${p.name}"`).join(", "));

async function remove() {
  const p = props.pack;
  if (!p) return;
  busy.value = true;
  error.value = null;
  const del = deleteFiles.value && !p.missing;
  const query = del ? `?deleteFiles=true${plan.value?.nested.length ? "&nested=true" : ""}${leftover.value && plan.value?.leftover ? "&leftover=true" : ""}` : "";
  const res = await sendJson(`/api/v1/packs/${p.id}${query}`, {}, "DELETE");
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
        <strong>{{ pack.name }}</strong> leaves the list and <code>{{ target }}</code> is deleted from the server, with every file in it. Its earlier runs stay in the runs list. This can't be undone.
      </p>
      <p v-else>
        <strong>{{ pack.name }}</strong> leaves the list. Its folder and files stay as they are, and its earlier runs stay in the runs list. Add the folder again later and the pack gets its runs back.
      </p>
      <p v-if="deleteFiles && plan?.nested.length" class="warn small">The folder also holds {{ plan.nested.length === 1 ? "the pack" : "the packs" }} {{ nestedNames }}; {{ plan.nested.length === 1 ? "it leaves" : "they leave" }} the list with it.</p>
      <div v-if="can('admin') && !pack.missing" class="opt">
        <CheckBox id="rm-files" v-model="deleteFiles">Also delete its folder from the server</CheckBox>
        <code class="path small">{{ pack.dir }}</code>
        <template v-if="deleteFiles && plan?.leftover">
          <CheckBox id="rm-leftover" v-model="leftover">Delete the whole uploaded folder, with the files its packs shared</CheckBox>
          <code class="path small">{{ plan.leftover.dir }}</code>
        </template>
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
.warn {
  color: var(--warn);
}
.path {
  padding-left: calc(16px + var(--space-2));
  color: var(--muted);
  overflow-wrap: anywhere;
}
</style>
