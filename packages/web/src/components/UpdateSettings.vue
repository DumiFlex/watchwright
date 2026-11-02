<script setup lang="ts">
// Settings › Server › Updates: this server's version, whether a newer one is on npm, and Update.
// Update starts the update on the server: it stops, installs the new version with npm and starts
// again with the same options, so this page waits for it to come back and then reloads. In Docker
// (and installs npm doesn't own) there is no button: the page says how to update instead.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { CircleArrowUp, ExternalLink, RotateCw } from "../icons";
import { getJson, runName, sendJson, type RunSummary } from "../api";
import { when } from "../format";
import { saveSettings, settings } from "../settings";
import { toast } from "../toasts";
import { loadUpdates, notesUrl, updates } from "../updates";
import ModalDialog from "./ModalDialog.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const status = computed(() => updates.status);
const checking = ref(false);
onMounted(() => void loadUpdates());

async function checkNow() {
  checking.value = true;
  const err = await loadUpdates(true);
  checking.value = false;
  if (err) toast(err, { tone: "bad" });
}

const autoCheck = computed<boolean>({
  get: () => settings.values["updates.check"] !== false,
  set: (v) => void setAutoCheck(v),
});
async function setAutoCheck(on: boolean) {
  const err = await saveSettings({ "updates.check": on });
  if (err) toast(err, { tone: "bad" });
  else await loadUpdates();
}

/** The line under Updates when there is nothing new to install. */
const line = computed(() => {
  const s = status.value;
  if (!s) return "";
  const where = `This server runs Watchwright ${s.version}`;
  if (s.error) return `${where}. Couldn't check for a newer one: ${s.error}`;
  if (s.latest) return `${where}, the newest version.${s.checkedAt ? ` Checked ${when(s.checkedAt)}.` : ""}`;
  if (!s.check) return `${where}. Checking for updates is off.`;
  return `${where}.`;
});

// Updating: the runs going now are interrupted and go on once the server is back.
const askOpen = ref(false);
const going = ref<RunSummary[]>([]);
async function askUpdate() {
  const res = await getJson<RunSummary[]>("/api/v1/runs?status=queued,running,pausing,paused&limit=50");
  going.value = res.ok ? res.data : [];
  askOpen.value = true;
}

const updatingTo = ref<string | null>(null);
const notBack = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
onBeforeUnmount(() => timer && clearInterval(timer));

async function update() {
  const to = status.value?.latest;
  if (!to) return;
  const res = await sendJson<{ updating: boolean; to: string }>("/api/v1/updates", { version: to, now: going.value.length > 0 });
  askOpen.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad", timeout: 10000 });
  updatingTo.value = res.data.to;
  const started = Date.now();
  let wentDown = false;
  timer = setInterval(async () => {
    const health = await getJson<{ version: string }>("/api/v1/health");
    if (!health.ok) wentDown = true;
    else if (wentDown || health.data.version === res.data.to) {
      if (timer) clearInterval(timer);
      // The new version's page, from the new server.
      location.reload();
      return;
    }
    if (Date.now() - started > 5 * 60_000) {
      notBack.value = true;
      if (timer) clearInterval(timer);
    }
  }, 2000);
}
</script>

<template>
  <div class="updates">
    <h3 class="sub">Updates</h3>
    <template v-if="status">
      <p v-if="updatingTo && !notBack" class="note" role="status"><RotateCw :size="15" class="spin" /> Updating to {{ updatingTo }}. Watchwright stops for a minute and starts again; this page reloads when it's back.</p>
      <p v-else-if="notBack" class="note bad" role="alert">Watchwright isn't back yet. The update's log is <code>logs/update.log</code> in the data folder.</p>
      <template v-else>
        <p v-if="status.newer && status.latest" class="note new">
          <CircleArrowUp :size="16" class="ico" />
          <span>
            Watchwright <strong>{{ status.latest }}</strong> is out. This server runs {{ status.version }}.
            <a :href="notesUrl(status.latest)" target="_blank" rel="noopener">What's new <ExternalLink :size="12" /></a>
          </span>
        </p>
        <p v-else class="muted small">{{ line }}</p>
        <p v-if="status.last && !status.last.ok" class="note bad">The last update, to {{ status.last.to }}, failed: {{ status.last.message }} The log is <code>logs/update.log</code> in the data folder.</p>
        <p v-if="status.newer && !status.canUpdate" class="muted small how">
          <template v-for="(part, i) in status.how.split('`')" :key="i"><code v-if="i % 2">{{ part }}</code><template v-else>{{ part }}</template></template>
        </p>
        <div class="actions">
          <button v-if="status.newer && status.canUpdate" type="button" class="btn primary" @click="askUpdate"><CircleArrowUp :size="15" /> Update to {{ status.latest }}</button>
          <button type="button" class="btn" :disabled="checking" @click="checkNow"><RotateCw :size="15" :class="{ spin: checking }" /> Check now</button>
        </div>
      </template>
    </template>
    <ToggleSwitch id="s-update-check" v-model="autoCheck">Check npm for a newer version</ToggleSwitch>
    <p class="muted small">Twice a day the server asks npm's registry for the newest version, and the top bar shows when there is one. Nothing else is sent.</p>

    <ModalDialog v-model="askOpen" :heading="`Update to ${status?.latest ?? ''}?`">
      <p>Watchwright stops, installs {{ status?.latest }} with npm and starts again with the same options. It takes about a minute. Agents connected through <code>watchwright mcp</code> keep working; they wait for it.</p>
      <p v-if="going.length">
        {{ going.length === 1 ? "A run is" : `${going.length} runs are` }} going: <strong>{{ going.map((r) => `${runName(r)} (${r.packName})`).join(", ") }}</strong>. {{ going.length === 1 ? "It is" : "They are" }} interrupted, and
        {{ going.length === 1 ? "goes" : "go" }} on once Watchwright is back when Resume interrupted runs is on (in the New run settings), or {{ going.length === 1 ? "waits" : "wait" }} for Resume on {{ going.length === 1 ? "its" : "their" }} page.
      </p>
      <template #actions>
        <button class="btn" @click="askOpen = false">Cancel</button>
        <button class="btn primary" @click="update">{{ going.length ? "Interrupt runs and update" : "Update" }}</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.updates {
  display: grid;
  gap: var(--space-3);
}
.updates p {
  margin: 0;
}
.sub {
  margin: var(--space-2) 0 0;
  font-size: 15px;
}
.note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.note.bad {
  background: color-mix(in srgb, var(--bad) 12%, transparent);
}
.note .ico {
  flex: none;
  margin-top: 2px;
  color: var(--accent);
}
.note a {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.how {
  overflow-wrap: anywhere;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
