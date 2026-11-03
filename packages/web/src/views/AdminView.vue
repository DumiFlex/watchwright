<script setup lang="ts">
// Admin: the server's settings, one value for everyone who uses it: people and single sign-on
// (login on), the defaults for people's own settings, secrets, sign-ins, runners, sharing, alerts,
// storage, and the server itself. Only admins see this page (with login off, the one person is).
// See docs/research/settings-pages.md.
import { computed, onMounted, ref } from "vue";
import { getJson, runName, sendJson, type RunSummary } from "../api";
import { EDITOR_OPTIONS, type Editor } from "../editor";
import { Power } from "../icons";
import { loadSettings, saveSettings, settings } from "../settings";
import { sectionsOn } from "../settingspages";
import { session } from "../session";
import { toast } from "../toasts";
import AlertsSettings from "../components/AlertsSettings.vue";
import ModalDialog from "../components/ModalDialog.vue";
import RecentFolders from "../components/RecentFolders.vue";
import RunnersSettings from "../components/RunnersSettings.vue";
import SecretsSettings from "../components/SecretsSettings.vue";
import SelectMenu from "../components/SelectMenu.vue";
import SettingsLayout from "../components/SettingsLayout.vue";
import SharingSettings from "../components/SharingSettings.vue";
import SigninsSettings from "../components/SigninsSettings.vue";
import SsoSettings from "../components/SsoSettings.vue";
import StorageSettings from "../components/StorageSettings.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";
import UpdateSettings from "../components/UpdateSettings.vue";
import UsersSettings from "../components/UsersSettings.vue";

defineProps<{ section?: string | undefined }>();

const sections = computed(() => sectionsOn("admin"));
const shows = (id: string) => sections.value.some((s) => s.id === id);

async function save(values: Record<string, unknown>) {
  const err = await saveSettings(values);
  if (err) toast(err, { tone: "bad" });
  else toast("Saved", { tone: "ok", timeout: 1500 });
}

// The server values of per-user settings: what people who haven't chosen their own get.
const defaultEditor = computed<Editor>({
  get: () => settings.server["settings.editor"],
  set: (v) => void save({ "settings.editor": v }),
});
const defaultNewRun = computed<"latest" | "defaults">({
  get: () => settings.server["runs.newRunFrom"],
  set: (v) => void save({ "runs.newRunFrom": v }),
});
const NEW_RUN_OPTIONS = [
  { value: "latest" as const, label: "The pack's latest run" },
  { value: "defaults" as const, label: "The pack's defaults" },
];

const resumeOnStart = computed<boolean>({
  get: () => settings.server["runs.resumeOnStart"] === true,
  set: (v) => void save({ "runs.resumeOnStart": v }),
});

// Start at sign-in: schedules only start runs while the server runs. On Windows the server writes a
// file to the Startup folder; elsewhere this shows the command to start it with.
interface StartupInfo {
  supported: boolean;
  enabled: boolean;
  other: boolean;
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
  if (shows("server")) void loadStartup();
});
</script>

<template>
  <SettingsLayout page="admin" heading="Admin" :sections="sections" :section="section">
    <template #intro>
      Settings for the whole server, the same for {{ session.on ? "everyone who uses it" : "every browser and agent on this machine" }}. Your own preferences are in <a href="#/settings">Settings</a>.
    </template>

    <UsersSettings v-if="shows('users')" />
    <SsoSettings v-if="shows('sso')" />

    <section v-if="shows('defaults')" class="card" aria-labelledby="s-defaults">
      <h2 id="s-defaults" class="display">Defaults</h2>
      <p class="muted small">What people get until they choose their own in Settings.</p>
      <div class="defaults">
        <label for="s-default-editor" class="lbl">Open files in</label>
        <SelectMenu id="s-default-editor" v-model="defaultEditor" class="pick" :options="EDITOR_OPTIONS" />
        <label for="s-default-newrun" class="lbl">New run starts from</label>
        <SelectMenu id="s-default-newrun" v-model="defaultNewRun" class="pick" :options="NEW_RUN_OPTIONS" />
      </div>
    </section>

    <SecretsSettings v-if="shows('secrets')" />
    <SigninsSettings v-if="shows('signins')" />
    <RunnersSettings v-if="shows('runners')" />

    <section v-if="shows('runs')" class="card" aria-labelledby="s-runs">
      <h2 id="s-runs" class="display">Interrupted runs</h2>
      <p class="muted small">Runs going when Watchwright stopped, or when the computer restarted or it crashed.</p>
      <ToggleSwitch id="s-resume-on-start" v-model="resumeOnStart">Resume interrupted runs when Watchwright starts</ToggleSwitch>
      <p class="muted small">On: they go on where they were once it starts again. Off: they wait for Resume on their page. An alert rule can say when a run is interrupted.</p>
    </section>

    <SharingSettings v-if="shows('sharing')" />
    <AlertsSettings v-if="shows('alerts')" />
    <StorageSettings v-if="shows('storage')" />
    <RecentFolders v-if="shows('recent')" />

    <section v-if="shows('server')" class="card" aria-labelledby="s-server">
      <h2 id="s-server" class="display">Server</h2>
      <p class="muted small">Schedules only start runs while Watchwright is running.</p>
      <template v-if="startup?.supported">
        <ToggleSwitch id="s-startup" v-model="startAtSignIn">Start at sign-in</ToggleSwitch>
        <p class="muted small">
          Puts <code>Watchwright.cmd</code> in your Startup folder. It starts this server in the background, with no window, when you sign in to Windows, on the same port and data folder, without opening the browser. Turning this
          off deletes the file.
        </p>
        <p v-if="startup.other" class="muted small">The file there now starts another Watchwright server on this computer (another port or data folder). Turning this on points it at this one instead.</p>
      </template>
      <div v-else-if="startup" class="cmd">
        <p class="muted small">To start Watchwright when you sign in to this computer, run this command from a LaunchAgent (macOS) or a systemd user unit (Linux):</p>
        <code class="block">{{ startup.command }}</code>
      </div>
      <UpdateSettings />
      <h3 class="part">Stop</h3>
      <p class="muted small">Stops the Watchwright program on this machine, like Ctrl+C in its terminal. Runs going at the time are interrupted and can be resumed after it starts again.</p>
      <p v-if="stopped" class="stopped" role="status">Watchwright has stopped. To start it again, run <code>watchwright serve</code>.</p>
      <div v-else>
        <button type="button" class="btn danger" @click="askStop"><Power :size="15" /> Stop Watchwright</button>
      </div>
    </section>

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
  </SettingsLayout>
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
.defaults {
  display: grid;
  grid-template-columns: auto minmax(0, 280px);
  align-items: center;
  gap: var(--space-3) var(--space-4);
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
.part {
  margin: var(--space-2) 0 0;
  font-size: 15px;
}
.stopped {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.btn {
  justify-self: start;
}
@media (max-width: 720px) {
  .defaults {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
  }
}
</style>
