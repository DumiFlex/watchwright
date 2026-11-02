<script setup lang="ts">
// Settings > Runners: machines that let runs reach sites only they can reach (a site on someone's
// PC, for a server in Docker or elsewhere). Adding one shows the command to run on that machine,
// with a one-time pair code; the list shows which runners are connected now
// (docs/plans/self-hosting.md, section 6).
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getJson, sendJson } from "../api";
import { ago, when } from "../format";
import { Laptop, Link, Plus, Trash2 } from "../icons";
import { LiveConnection } from "../live";
import { can } from "../session";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import CodeView from "./CodeView.vue";
import ModalDialog from "./ModalDialog.vue";
import TextField from "./TextField.vue";

export interface RunnerInfo {
  id: string;
  name: string;
  allow: string[];
  createdBy: string | null;
  createdAt: string;
  pairedAt: string | null;
  lastSeen: string | null;
  version: string | null;
  platform: string | null;
  online: boolean;
  connectedAt: string | null;
  streams: number;
}

interface Paired {
  runner: RunnerInfo;
  code: string;
  expiresAt: string;
  command: string;
}

const list = ref<RunnerInfo[] | null>(null);
const name = ref("");
const allow = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
/** The command to run, after adding a runner or asking for a new code, until that runner connects. */
const pairing = ref<Paired | null>(null);

async function load() {
  const res = await getJson<RunnerInfo[]>("/api/v1/runners");
  list.value = res.ok ? res.data : [];
  const p = pairing.value;
  const now = p && list.value.find((r) => r.id === p.runner.id);
  if (p && now?.online && now.connectedAt && now.connectedAt > p.runner.createdAt && (!p.runner.online || now.connectedAt !== p.runner.connectedAt)) {
    toast(`${now.name} is connected.`, { tone: "ok" });
    pairing.value = null;
  }
}
onMounted(load);
const live = new LiveConnection(
  {},
  {
    onEvent: (e) => {
      if (e.type === "runner.connected" || e.type === "runner.disconnected") void load();
    },
  },
);
onBeforeUnmount(() => live.close());

async function add() {
  const n = name.value.trim();
  if (!n) return;
  busy.value = true;
  error.value = null;
  const res = await sendJson<Paired>("/api/v1/runners", { name: n, server: location.origin, ...(allow.value.trim() ? { allow: allow.value.trim() } : {}) });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  pairing.value = res.data;
  name.value = "";
  allow.value = "";
  await load();
}

async function newCode(r: RunnerInfo) {
  const res = await sendJson<Paired>(`/api/v1/runners/${r.id}/pair-code`, { server: location.origin });
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  pairing.value = res.data;
}

const doomed = ref<RunnerInfo | null>(null);
const removeOpen = computed({
  get: () => doomed.value !== null,
  set: (open: boolean) => {
    if (!open) doomed.value = null;
  },
});
async function remove() {
  const r = doomed.value;
  doomed.value = null;
  if (!r) return;
  const res = await sendJson(`/api/v1/runners/${r.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  if (pairing.value?.runner.id === r.id) pairing.value = null;
  toast(`Removed ${r.name}.`);
  await load();
}

function state(r: RunnerInfo): string {
  if (r.online && r.connectedAt) return `Connected ${ago(r.connectedAt)}${r.streams ? ` · ${r.streams} open ${r.streams === 1 ? "connection" : "connections"}` : ""}`;
  if (r.lastSeen) return `Offline · last connected ${ago(r.lastSeen)}`;
  return "Not paired yet";
}
const until = computed(() => (pairing.value ? new Date(pairing.value.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""));
</script>

<template>
  <section class="card" aria-labelledby="s-runners">
    <h2 id="s-runners" class="display">Runners</h2>
    <p class="muted small">
      A runner lets runs reach sites only another machine can reach, such as an app on your PC's localhost while this server runs in Docker. Runs pick it with Reach the site from on New run, or
      <code>site.network</code> in the pack. It opens only what its own machine allows.
    </p>

    <ul v-if="list && list.length" class="runners">
      <li v-for="r in list" :key="r.id">
        <span class="dot" :class="{ on: r.online }" aria-hidden="true" />
        <div class="who">
          <span class="name"><Laptop :size="14" class="muted" /> {{ r.name }}</span>
          <span v-tip="when(r.online ? r.connectedAt : r.lastSeen)" class="muted small">{{ state(r) }}</span>
          <span class="muted small">May open {{ r.allow.join(", ") }}<template v-if="r.platform && r.version"> · {{ r.platform }}, Watchwright {{ r.version }}</template></span>
        </div>
        <span v-if="can('user')" class="acts">
          <button v-tip="'A new pair code, to set it up again or on another machine'" type="button" class="ib" :aria-label="`New pair code for ${r.name}`" @click="newCode(r)"><Link :size="14" /></button>
          <button v-tip="'Remove this runner'" type="button" class="ib bad-hover" :aria-label="`Remove ${r.name}`" @click="doomed = r"><Trash2 :size="14" /></button>
        </span>
      </li>
    </ul>
    <p v-else-if="list" class="muted small">No runners yet.</p>

    <div v-if="pairing" class="pair" role="status">
      <p class="small">
        Run this on <strong>{{ pairing.runner.name }}</strong> (it needs <a href="https://nodejs.org/" target="_blank" rel="noopener">Node.js</a> 22 or later). The code works once, until {{ until }}. Leave it
        running; the runner shows here as connected.
      </p>
      <CodeView :code="pairing.command" label="Runner command" wrap />
    </div>

    <form v-if="can('user')" class="add" @submit.prevent="add">
      <div class="fld">
        <label for="rn-name" class="lbl small">Name</label>
        <TextField id="rn-name" v-model="name" placeholder="Office PC" />
      </div>
      <div class="fld">
        <label for="rn-allow" class="lbl small">May open</label>
        <TextField id="rn-allow" v-model="allow" placeholder="loopback" />
      </div>
      <div class="go">
        <button type="submit" class="btn" :disabled="!name.trim() || busy"><Plus :size="15" /> Add runner</button>
      </div>
      <p class="muted small hint">
        <code>loopback</code> (any port on that machine, the default), <code>host:port</code> or <code>host:*</code>, separated by commas. The machine keeps its own list; change it there with
        <code>watchwright runner --allow</code>.
      </p>
      <p v-if="error" class="error small hint" role="alert">{{ error }}</p>
    </form>

    <ModalDialog v-model="removeOpen" heading="Remove this runner?">
      <p>
        <strong>{{ doomed?.name }}</strong> disconnects and its token stops working. Runs and schedules that reach their site from it won't start until it is added and paired again.
      </p>
      <template #actions>
        <button class="btn" @click="doomed = null">Cancel</button>
        <button class="btn danger" @click="remove">Remove</button>
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
.runners {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.runners li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--line-strong);
}
.dot.on {
  background: var(--ok);
}
.who {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.who .small {
  overflow-wrap: anywhere;
}
.acts {
  flex: none;
  display: flex;
  gap: 2px;
}
.ib {
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
  color: var(--text);
}
.ib.bad-hover:hover {
  color: var(--bad);
}
.pair {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--space-2) var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.hint {
  grid-column: 1 / -1;
}
.error {
  color: var(--bad);
}
@media (max-width: 640px) {
  .add {
    grid-template-columns: 1fr;
  }
}
</style>
