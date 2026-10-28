<script setup lang="ts">
// Settings > Sign-ins: the cookies and local storage saved per site key, which runs started signed
// in begin with. They are saved from a recording or a login test, so this lists and deletes them.
import { computed, onMounted, ref } from "vue";
import { getJson, sendJson } from "../api";
import { when } from "../format";
import { KeyRound, Trash2 } from "../icons";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import ModalDialog from "./ModalDialog.vue";

interface SignInInfo {
  siteKey: string;
  savedAt: string;
  source: string;
  cookies: number;
  origins: string[];
}

const list = ref<SignInInfo[] | null>(null);

async function load() {
  const res = await getJson<SignInInfo[]>("/api/v1/signins");
  list.value = res.ok ? res.data : [];
}
onMounted(load);

function from(s: SignInInfo): string {
  return s.source === "record" ? "a recording" : s.source;
}

function holds(s: SignInInfo): string {
  const cookies = `${s.cookies} cookie${s.cookies === 1 ? "" : "s"}`;
  return s.origins.length === 0 ? cookies : `${cookies}, storage for ${s.origins.map((o) => o.replace(/^https?:\/\//, "")).join(", ")}`;
}

const doomed = ref<SignInInfo | null>(null);
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
  const res = await sendJson(`/api/v1/signins/${encodeURIComponent(s.siteKey)}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Deleted the sign-in for ${s.siteKey}.`);
  await load();
}
</script>

<template>
  <section class="card" aria-labelledby="s-signins">
    <h2 id="s-signins" class="display">Sign-ins</h2>
    <p class="muted small">
      Cookies and local storage saved per site, so runs can start signed in instead of logging in each time. Save one with Save sign-in on a recording, or with <code>saveSignIn</code> at the end of a login
      test; runs use it with Start signed in or <code>site.signIn: saved</code> in the pack. They are kept unencrypted in Watchwright's data folder.
    </p>
    <ul v-if="list && list.length" class="signins">
      <li v-for="s in list" :key="s.siteKey">
        <KeyRound :size="15" class="muted" />
        <div class="who">
          <code class="site">{{ s.siteKey }}</code>
          <span class="muted small">{{ holds(s) }}</span>
          <span v-tip="when(s.savedAt)" class="muted small">Saved {{ new Date(s.savedAt).toLocaleDateString() }} from {{ from(s) }}</span>
        </div>
        <button v-tip="'Delete this sign-in'" type="button" class="ib" :aria-label="`Delete the sign-in for ${s.siteKey}`" @click="doomed = s"><Trash2 :size="14" /></button>
      </li>
    </ul>
    <p v-else-if="list" class="muted">No sign-ins saved yet.</p>
    <ModalDialog v-model="deleteOpen" heading="Delete this sign-in?">
      <p>
        Runs of <code>{{ doomed?.siteKey }}</code> that start signed in won't start until one is saved again.
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
.signins {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.signins li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}
.signins li > :first-child {
  flex: none;
  margin-top: 3px;
}
.who {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.site {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
