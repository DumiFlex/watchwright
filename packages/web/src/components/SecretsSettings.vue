<script setup lang="ts">
// Settings > Secrets: passwords and tokens tests read as ${secret.NAME} or h.secret("NAME"). The
// server never sends a value back, so this lists names and lets a person set, replace or delete.
import { computed, onMounted, ref } from "vue";
import { getJson, sendJson } from "../api";
import { when } from "../format";
import { Lock, Trash2 } from "../icons";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import ModalDialog from "./ModalDialog.vue";
import TextField from "./TextField.vue";

interface SecretInfo {
  name: string;
  length: number;
  setAt: string;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const list = ref<SecretInfo[] | null>(null);
const name = ref("");
const value = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const nameField = ref<InstanceType<typeof TextField> | null>(null);
const nameBad = computed(() => name.value !== "" && !NAME.test(name.value));
const replacing = computed(() => list.value?.some((s) => s.name === name.value) ?? false);

async function load() {
  const res = await getJson<SecretInfo[]>("/api/v1/secrets");
  list.value = res.ok ? res.data : [];
}
onMounted(load);

async function save() {
  if (!NAME.test(name.value) || value.value === "") return;
  busy.value = true;
  error.value = null;
  const res = await sendJson<SecretInfo>("/api/v1/secrets", { name: name.value, value: value.value });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  toast(`${replacing.value ? "Replaced" : "Saved"} the secret ${res.data.name}.`, { tone: "ok" });
  name.value = "";
  value.value = "";
  await load();
}

function replace(s: SecretInfo) {
  name.value = s.name;
  value.value = "";
  error.value = null;
  nameField.value?.focus();
}

const doomed = ref<SecretInfo | null>(null);
const deleteOpen = computed({
  get: () => doomed.value !== null,
  set: (open: boolean) => {
    if (!open) doomed.value = null;
  },
});
async function remove() {
  const s = doomed.value;
  doomed.value = null;
  if (!s) return;
  const res = await sendJson(`/api/v1/secrets/${encodeURIComponent(s.name)}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Deleted the secret ${s.name}.`);
  await load();
}
</script>

<template>
  <section class="card" aria-labelledby="s-secrets">
    <h2 id="s-secrets" class="display">Secrets</h2>
    <p class="muted small">
      Passwords and tokens for tests, kept out of packs. Tests read them as <code>${secret.NAME}</code> in YAML or <code>h.secret("NAME")</code> in code, and every value shows as ••• in logs,
      results and the live page's events. They are kept unencrypted in Watchwright's data folder.
    </p>
    <ul v-if="list && list.length" class="secrets">
      <li v-for="s in list" :key="s.name">
        <Lock :size="15" class="muted" />
        <div class="who">
          <code class="sname">{{ s.name }}</code>
          <span v-tip="when(s.setAt)" class="muted small">{{ s.length }} characters · set {{ new Date(s.setAt).toLocaleDateString() }}</span>
        </div>
        <button type="button" class="btn" @click="replace(s)">Replace</button>
        <button v-tip="'Delete this secret'" type="button" class="ib" :aria-label="`Delete ${s.name}`" @click="doomed = s"><Trash2 :size="14" /></button>
      </li>
    </ul>
    <p v-else-if="list" class="muted">No secrets yet.</p>
    <form class="add" @submit.prevent="save">
      <div class="fld">
        <label for="s-secret-name" class="lbl small">Name</label>
        <TextField id="s-secret-name" ref="nameField" v-model="name" placeholder="SHOP_PASSWORD" :invalid="nameBad" />
      </div>
      <div class="fld">
        <label for="s-secret-value" class="lbl small">Value</label>
        <TextField id="s-secret-value" v-model="value" type="password" autocomplete="new-password" />
      </div>
      <button type="submit" class="btn primary" :disabled="busy || !NAME.test(name) || value === ''">{{ replacing ? "Replace" : "Save secret" }}</button>
    </form>
    <p v-if="nameBad" class="error small" role="alert">Letters, digits and _, starting with a letter or _.</p>
    <p v-else-if="error" class="error small" role="alert">{{ error }}</p>
    <ModalDialog v-model="deleteOpen" heading="Delete this secret?">
      <p>
        Tests that read <code>{{ doomed?.name }}</code> break until it is set again.
      </p>
      <template #actions>
        <button class="btn" @click="doomed = null">Cancel</button>
        <button class="btn danger" @click="remove">Delete</button>
      </template>
    </ModalDialog>
  </section>
</template>

<style scoped>
.card {
  display: grid;
  gap: var(--space-3);
}
.card > h2:first-child,
.card p {
  margin: 0;
}
.card > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.secrets {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.secrets li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.who {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.sname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.error {
  color: var(--bad);
}
.ib {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover {
  background: var(--hover);
  color: var(--bad);
}
@media (max-width: 720px) {
  .add {
    grid-template-columns: 1fr;
  }
  .who {
    flex-direction: column;
    gap: 0;
  }
}
</style>
