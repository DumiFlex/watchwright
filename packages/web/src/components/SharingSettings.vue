<script setup lang="ts">
// Settings > Sharing: every share link that still works, to take back; and, for admins, the
// public dashboard at #/status, which shows the latest runs of the packs they pick to anyone
// who can reach the server (docs/plans/self-hosting.md, section 4).
import { computed, onMounted, ref } from "vue";
import { Copy, Trash2 } from "../icons";
import { getJson, sendJson, type DashboardSettings, type Pack, type ShareLink } from "../api";
import { ago } from "../format";
import { href } from "../router";
import { can } from "../session";
import { copyShare } from "../share";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import CodeView from "./CodeView.vue";
import MultiSelect from "./MultiSelect.vue";
import StatusChip from "./StatusChip.vue";
import TextField from "./TextField.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const links = ref<ShareLink[]>([]);
const packs = ref<Pack[]>([]);
const dash = ref<DashboardSettings>({ on: false, packs: [], linkRuns: false, title: "", tiles: true });
const loaded = ref(false);
const busy = ref(false);
const statusUrl = `${location.origin}/${href({ name: "status" })}`;

async function loadLinks() {
  const res = await getJson<ShareLink[]>("/api/v1/shares");
  if (res.ok) links.value = res.data;
}
onMounted(async () => {
  void loadLinks();
  if (!can("admin")) return;
  const [d, p] = await Promise.all([getJson<DashboardSettings>("/api/v1/shares/dashboard"), getJson<Pack[]>("/api/v1/packs")]);
  if (d.ok) dash.value = d.data;
  if (p.ok) packs.value = p.data;
  loaded.value = d.ok;
});

async function remove(l: ShareLink) {
  const res = await sendJson(`/api/v1/shares/${l.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast("The link no longer works.", { tone: "ok" });
  await loadLinks();
}
async function save() {
  busy.value = true;
  const res = await sendJson<DashboardSettings>("/api/v1/shares/dashboard", dash.value);
  busy.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  dash.value = res.data;
  toast("Public status page saved.", { tone: "ok" });
}

const packOptions = computed(() => packs.value.map((p) => ({ value: p.id, label: p.name })));
const linkText = (l: ShareLink) => [`made ${ago(l.createdAt)}${l.createdBy ? ` by ${l.createdBy}` : ""}`, l.expiresAt ? `until ${new Date(l.expiresAt).toLocaleDateString()}` : "until taken back", `${l.views} ${l.views === 1 ? "view" : "views"}`].join(" · ");
</script>

<template>
  <section class="card sharing" aria-labelledby="s-sharing">
    <h2 id="s-sharing" class="display">Sharing</h2>
    <p class="muted small">Share links open one run read-only for anyone who has the link. Make one with Share on a run's page.</p>
    <ul v-if="links.length" class="links">
      <li v-for="l in links" :key="l.id">
        <div class="what">
          <a :href="href({ name: 'run', id: l.runId })">{{ l.run ? l.run.packName : l.runId }}<template v-if="l.run?.label"> · {{ l.run.label }}</template></a>
          <StatusChip v-if="l.run" :status="l.run.status" />
          <span v-if="l.traces" class="tag">traces</span>
        </div>
        <span class="muted small">{{ linkText(l) }}</span>
        <span class="acts">
          <button v-if="l.page" v-tip="'Copy the link'" type="button" class="ib copy" aria-label="Copy the link" @click="copyShare(l.page)"><Copy :size="14" /></button>
          <button v-tip="'Take this link back'" type="button" class="ib" aria-label="Take this link back" @click="remove(l)"><Trash2 :size="14" /></button>
        </span>
      </li>
    </ul>
    <p v-else class="muted small">No links work right now.</p>

    <form v-if="can('admin') && loaded" class="block" @submit.prevent="save">
      <ToggleSwitch id="dash-on" v-model="dash.on">Public status page</ToggleSwitch>
      <p class="muted small">Shows how the latest runs of the packs below went, to anyone who can reach this server, signed in or not.</p>
      <CodeView v-if="dash.on" :code="statusUrl" label="Status page address" />
      <div class="fields">
        <div class="fld wide">
          <label for="dash-packs" class="lbl small">Packs shown</label>
          <MultiSelect id="dash-packs" v-model="dash.packs" :options="packOptions" placeholder="Pick packs" empty-label="None yet" />
        </div>
        <div class="fld">
          <label for="dash-title" class="lbl small">Title</label>
          <TextField id="dash-title" v-model="dash.title" placeholder="Status" />
        </div>
      </div>
      <ToggleSwitch id="dash-runs" v-model="dash.linkRuns">Runs open read-only</ToggleSwitch>
      <p class="muted small">Each run on the page opens like a share link, with its results, screenshots and video. Traces and network files stay private.</p>
      <ToggleSwitch id="dash-tiles" v-model="dash.tiles">Packs show their dashboards</ToggleSwitch>
      <p class="muted small">Each pack shows the tiles of its dashboard that are public (a tile with <code>public: false</code> never shows). Screenshots, outputs and failures show only while runs open read-only.</p>
      <div>
        <button type="submit" class="btn primary" :disabled="busy">Save</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.sharing,
.block {
  display: grid;
  gap: var(--space-3);
}
.sharing p {
  margin: 0;
}
.sharing > h2:first-child {
  margin: 0;
}
.sharing > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.block {
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
}
.links {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.links li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}
.links li + li {
  border-top: var(--border-width) solid var(--line);
}
.what {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.tag {
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 11px;
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2) var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.wide {
  grid-column: 1 / -1;
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
.acts {
  display: flex;
  gap: var(--space-1);
}
.ib:hover {
  background: var(--hover);
  color: var(--bad);
}
.ib.copy:hover {
  color: var(--text);
}
@media (max-width: 640px) {
  .fields {
    grid-template-columns: 1fr;
  }
  .links li {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: var(--space-1);
  }
  .links li > .muted {
    grid-column: 1;
  }
  .links li > .acts {
    grid-row: 1 / span 2;
    grid-column: 2;
  }
}
</style>
