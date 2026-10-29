<script setup lang="ts">
// Settings: this browser's look and mode, and the server's machine-wide preferences (the editor
// file links open in, recent folders). Machine-wide values are kept by the server (`/settings`),
// so every browser and agent sees the same; the look stays in this browser.
import { computed, inject, onMounted, ref, type Ref } from "vue";
import { History, Power, Trash2 } from "../icons";
import { getJson, runName, sendJson, type FolderPlaces, type RunSummary } from "../api";
import { EDITOR_OPTIONS, editorUrl, type Editor } from "../editor";
import { when } from "../format";
import { tildify } from "../paths";
import { loadSettings, saveSettings, settings } from "../settings";
import { LOOKS, MODES, type Theme } from "../theme";
import { notify, notifySupport, turnOffNotify, turnOnNotify, type NotifySupport } from "../notify";
import { toast } from "../toasts";
import AboutCard from "../components/AboutCard.vue";
import AgentsSettings from "../components/AgentsSettings.vue";
import AlertsSettings from "../components/AlertsSettings.vue";
import SecretsSettings from "../components/SecretsSettings.vue";
import SigninsSettings from "../components/SigninsSettings.vue";
import ModalDialog from "../components/ModalDialog.vue";
import RadioGroup from "../components/RadioGroup.vue";
import SelectMenu from "../components/SelectMenu.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";
import { vTip } from "../tooltip";

const theme = inject<Ref<Theme>>("theme");
const look = computed({ get: () => theme?.value.look ?? "movement", set: (v) => theme && (theme.value = { ...theme.value, look: v }) });
const mode = computed({ get: () => theme?.value.mode ?? "system", set: (v) => theme && (theme.value = { ...theme.value, mode: v }) });
const lookOptions = LOOKS.map((l) => ({ value: l.id, label: l.name, note: l.note }));
const modeOptions = MODES.map((m) => ({ value: m.id, label: m.name }));

const editor = computed<Editor>({
  get: () => settings.values["settings.editor"],
  set: (v) => void save({ "settings.editor": v }),
});
const newRunFrom = computed<"latest" | "defaults">({
  get: () => settings.values["runs.newRunFrom"],
  set: (v) => void save({ "runs.newRunFrom": v }),
});
const newRunOptions = [
  { value: "latest" as const, label: "The pack's latest run", note: "Its tests, values, options and label, ready to change" },
  { value: "defaults" as const, label: "The pack's defaults", note: "All tests, each value's default and the pack's run settings" },
];
const sample = computed(() => editorUrl(editor.value, settings.home ? `${settings.home}/sites/shop/watchwright/tests/home.ts` : "/sites/shop/watchwright/tests/home.ts", 4));

async function save(values: Record<string, unknown>) {
  const err = await saveSettings(values);
  if (err) toast(err, { tone: "bad" });
  else toast("Saved", { tone: "ok", timeout: 1500 });
}

// Desktop notices are kept by this browser, like the look; the browser itself must allow them.
const support = ref<NotifySupport>(notifySupport());
const notices = computed({
  get: () => notify.pref === "on" && support.value === "granted",
  set: (on) => void setNotices(on),
});
async function setNotices(on: boolean) {
  if (!on) return turnOffNotify();
  support.value = await turnOnNotify();
  if (support.value === "denied") toast("The browser blocks notifications for this page. Allow them in the site settings (the icon left of the address), then switch this on.", { tone: "warn", timeout: 10000 });
}

const recent = ref<FolderPlaces["recent"]>([]);
async function loadRecent() {
  const res = await getJson<FolderPlaces>("/api/v1/folders/places");
  if (res.ok) recent.value = res.data.recent;
}
async function forget(path?: string) {
  const res = await sendJson<FolderPlaces["recent"]>(`/api/v1/folders/recent${path ? `?path=${encodeURIComponent(path)}` : ""}`, {}, "DELETE");
  if (res.ok) recent.value = res.data;
}

// Start at sign-in: schedules only start runs while the server runs. On Windows the server writes a
// file to the Startup folder; elsewhere this shows the command to start it with.
interface StartupInfo {
  supported: boolean;
  enabled: boolean;
  file: string | null;
  command: string;
}
const startup = ref<StartupInfo | null>(null);
async function loadStartup() {
  const res = await getJson<StartupInfo>("/api/v1/startup");
  if (res.ok) startup.value = res.data;
}
const startAtSignIn = computed({
  get: () => startup.value?.enabled ?? false,
  set: (on: boolean) => void setStartup(on),
});
async function setStartup(on: boolean) {
  const res = await sendJson<StartupInfo>("/api/v1/startup", { enabled: on });
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  startup.value = res.data;
  toast(on ? "Watchwright starts when you sign in." : "Watchwright no longer starts when you sign in.", { tone: "ok" });
}

// Stopping the server: runs going now become interrupted (they can be resumed after it starts
// again), so the dialog says which ones.
const stopOpen = ref(false);
const going = ref<RunSummary[]>([]);
const stopped = ref(false);
async function askStop() {
  const res = await getJson<RunSummary[]>("/api/v1/runs?status=queued,running,pausing,paused&limit=50");
  going.value = res.ok ? res.data : [];
  stopOpen.value = true;
}
async function stopServer() {
  const res = await sendJson<{ stopping: boolean }>("/api/v1/stop", {});
  stopOpen.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  stopped.value = true;
}

onMounted(() => {
  void loadSettings(true);
  void loadRecent();
  void loadStartup();
});
</script>

<template>
  <main class="page narrow">
    <div class="page-head">
      <div>
        <h1 class="display">Settings</h1>
        <p class="muted">The look and notifications are kept by this browser. Everything else is kept by the server, so every browser and agent on this machine sees the same.</p>
      </div>
    </div>

    <section class="card" aria-labelledby="s-look">
      <h2 id="s-look" class="display">Look and mode</h2>
      <p class="muted small">Also in the Theme menu at the top, and in Ctrl+K.</p>
      <div class="two">
        <div>
          <h3 class="sub">Look</h3>
          <RadioGroup v-model="look" :options="lookOptions" label="Look" />
        </div>
        <div>
          <h3 class="sub">Mode</h3>
          <RadioGroup v-model="mode" :options="modeOptions" label="Mode" />
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="s-editor">
      <h2 id="s-editor" class="display">Editor</h2>
      <p class="muted small">Test files, build errors and the line a test broke on open in this editor, at the line.</p>
      <div class="row">
        <label for="s-editor-pick" class="lbl">Open files in</label>
        <SelectMenu id="s-editor-pick" v-model="editor" class="pick" :options="EDITOR_OPTIONS" />
      </div>
      <p v-if="sample" class="muted small">Links look like <code class="sample">{{ sample }}</code>. The editor must be installed on the computer you browse from.</p>
    </section>

    <section class="card" aria-labelledby="s-newrun">
      <h2 id="s-newrun" class="display">New run</h2>
      <p class="muted small">What the New run page fills in when it opens. A run's "New run like this" and presets always fill in their own choices.</p>
      <RadioGroup v-model="newRunFrom" :options="newRunOptions" label="New run starts from" />
    </section>

    <section class="card" aria-labelledby="s-notify">
      <h2 id="s-notify" class="display">Notifications</h2>
      <p class="muted small">Kept by this browser. A desktop notice when a run finishes, pauses on a broken test or fails to start, while this tab is in the background. Clicking it opens the run.</p>
      <ToggleSwitch id="s-notify-on" v-model="notices" :disabled="support === 'unsupported'">Desktop notifications</ToggleSwitch>
      <p v-if="support === 'unsupported'" class="muted small">This browser can't show notifications for this page.</p>
      <p v-else-if="support === 'denied'" class="muted small">The browser blocks notifications for this page. Allow them in its site settings, then switch this on.</p>
    </section>

    <SecretsSettings />
    <SigninsSettings />
    <AlertsSettings />

    <AgentsSettings />

    <section class="card" aria-labelledby="s-recent">
      <h2 id="s-recent" class="display">Recent folders</h2>
      <p class="muted small">The folder browser lists the last ten folders packs were added or moved from.</p>
      <ul v-if="recent.length" class="recent">
        <li v-for="r in recent" :key="r.path">
          <History :size="15" class="muted" />
          <code class="rpath" :class="{ gone: !r.exists }">{{ tildify(r.path, settings.home) }}</code>
          <span v-tip="when(r.usedAt)" class="muted small">{{ r.exists ? "" : "gone · " }}{{ new Date(r.usedAt).toLocaleDateString() }}</span>
          <button v-tip="'Forget this folder'" type="button" class="ib" :aria-label="`Forget ${r.path}`" @click="forget(r.path)"><Trash2 :size="14" /></button>
        </li>
      </ul>
      <p v-else class="muted">No recent folders.</p>
      <button v-if="recent.length" class="btn" @click="forget()">Clear the list</button>
    </section>

    <section class="card" aria-labelledby="s-server">
      <h2 id="s-server" class="display">Server</h2>
      <p class="muted small">Schedules only start runs while Watchwright is running.</p>
      <template v-if="startup?.supported">
        <ToggleSwitch id="s-startup" v-model="startAtSignIn">Start at sign-in</ToggleSwitch>
        <p class="muted small">
          Puts <code>Watchwright.cmd</code> in your Startup folder. It starts this server minimized when you sign in to Windows, on the same port and data folder, without opening the browser. Turning
          this off deletes the file.
        </p>
      </template>
      <div v-else-if="startup" class="cmd">
        <p class="muted small">To start Watchwright when you sign in to this computer, run this command from a LaunchAgent (macOS) or a systemd user unit (Linux):</p>
        <code class="block">{{ startup.command }}</code>
      </div>
      <p class="muted small">Stops the Watchwright program on this machine, like Ctrl+C in its terminal. Runs going at the time are interrupted and can be resumed after it starts again.</p>
      <p v-if="stopped" class="stopped" role="status">Watchwright has stopped. To start it again, run <code>watchwright serve</code>.</p>
      <div v-else>
        <button type="button" class="btn danger" @click="askStop"><Power :size="15" /> Stop Watchwright</button>
      </div>
    </section>

    <AboutCard />
    <ModalDialog v-model="stopOpen" heading="Stop Watchwright?">
      <p v-if="going.length">
        {{ going.length === 1 ? "A run is" : `${going.length} runs are` }} going: <strong>{{ going.map((r) => `${runName(r)} (${r.packName})`).join(", ") }}</strong>. {{ going.length === 1 ? "It stops" : "They stop" }} where {{ going.length === 1 ? "it is" : "they are" }} and can be resumed after Watchwright starts again.
      </p>
      <p>This page stops working until you start Watchwright again with <code>watchwright serve</code>. An open recording ends without saving.</p>
      <template #actions>
        <button class="btn" @click="stopOpen = false">Cancel</button>
        <button class="btn danger" @click="stopServer">Stop Watchwright</button>
      </template>
    </ModalDialog>
  </main>
</template>

<style scoped>
.narrow {
  max-width: 860px;
}
.card {
  display: grid;
  gap: var(--space-3);
}
.card > h2:first-child,
.card p {
  margin: 0;
}
/* the line under a card's heading belongs to it */
.card > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.cmd {
  display: grid;
  gap: var(--space-2);
}
.cmd .block {
  display: block;
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  font-size: 13px;
  overflow-wrap: anywhere;
  user-select: all;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.sub {
  margin: 0 0 var(--space-2);
  font-size: 13px;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.lbl {
  flex: none;
}
.pick {
  max-width: 280px;
}
.stopped {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.sample {
  word-break: break-all;
}
.recent {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.recent li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.rpath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rpath.gone {
  text-decoration: line-through;
  color: var(--muted);
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
.btn {
  justify-self: start;
}
@media (max-width: 720px) {
  .two {
    grid-template-columns: 1fr;
  }
  .row {
    flex-direction: column;
    align-items: stretch;
  }
  .pick {
    max-width: none;
  }
}
</style>
