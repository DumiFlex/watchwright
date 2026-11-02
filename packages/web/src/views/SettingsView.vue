<script setup lang="ts">
// Settings: your own preferences. The look and notifications are kept by this browser; the editor
// and what New run starts from are kept by the server for you (with login off, for this machine).
// People who aren't admins also see the server's sections they may use here, under "On this
// server"; admins find those on the Admin page. See docs/research/settings-pages.md.
import { computed, inject, onMounted, ref, type Ref } from "vue";
import { EDITOR_OPTIONS, editorUrl, type Editor } from "../editor";
import { ShieldCheck } from "../icons";
import { loadSettings, saveMine, settings } from "../settings";
import { sectionsOn } from "../settingspages";
import { LOOKS, MODES, type Theme } from "../theme";
import { notify, notifySupport, turnOffNotify, turnOnNotify, type NotifySupport } from "../notify";
import { toast } from "../toasts";
import { can, session } from "../session";
import AboutCard from "../components/AboutCard.vue";
import AgentsSettings from "../components/AgentsSettings.vue";
import RadioGroup from "../components/RadioGroup.vue";
import RecentFolders from "../components/RecentFolders.vue";
import RunnersSettings from "../components/RunnersSettings.vue";
import SecretsSettings from "../components/SecretsSettings.vue";
import SelectMenu from "../components/SelectMenu.vue";
import SettingsLayout from "../components/SettingsLayout.vue";
import SharingSettings from "../components/SharingSettings.vue";
import SigninsSettings from "../components/SigninsSettings.vue";
import StorageSettings from "../components/StorageSettings.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";

defineProps<{ section?: string | undefined }>();

const sections = computed(() => sectionsOn("settings"));
const shows = (id: string) => sections.value.some((s) => s.id === id);

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
  const err = await saveMine(values);
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

onMounted(() => void loadSettings(true));
</script>

<template>
  <SettingsLayout page="settings" heading="Settings" :sections="sections" :section="section">
    <template #intro>
      Your own preferences. The look and notifications are kept by this browser; the editor and New run are kept by the server {{ session.on ? "for you, in every browser you sign in from" : "for this machine" }}.
      <template v-if="can('admin')">
        Settings for the whole server are on <a href="#/admin" class="admin-link"><ShieldCheck :size="14" /> Admin</a>.
      </template>
    </template>

    <section class="card" aria-labelledby="s-look">
      <h2 id="s-look" class="display">Look and mode</h2>
      <p class="muted small">Kept by this browser. Also in the Theme menu at the top, and in Ctrl+K.</p>
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

    <section class="card" aria-labelledby="s-notify">
      <h2 id="s-notify" class="display">Notifications</h2>
      <p class="muted small">Kept by this browser. A desktop notice when a run finishes, pauses on a broken test or fails to start, while this tab is in the background. Clicking it opens the run.</p>
      <ToggleSwitch id="s-notify-on" v-model="notices" :disabled="support === 'unsupported'">Desktop notifications</ToggleSwitch>
      <p v-if="support === 'unsupported'" class="muted small">This browser can't show notifications for this page.</p>
      <p v-else-if="support === 'denied'" class="muted small">The browser blocks notifications for this page. Allow them in its site settings, then switch this on.</p>
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

    <section v-if="shows('newrun')" class="card" aria-labelledby="s-newrun">
      <h2 id="s-newrun" class="display">New run</h2>
      <p class="muted small">What the New run page fills in when it opens. A run's "New run like this" and presets always fill in their own choices.</p>
      <RadioGroup v-model="newRunFrom" :options="newRunOptions" label="New run starts from" />
    </section>

    <AgentsSettings v-if="shows('agents')" />

    <SecretsSettings v-if="shows('secrets')" />
    <SigninsSettings v-if="shows('signins')" />
    <RunnersSettings v-if="shows('runners')" />
    <SharingSettings v-if="shows('sharing')" />
    <StorageSettings v-if="shows('storage')" />
    <RecentFolders v-if="shows('recent')" />

    <AboutCard />
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
/* the line under a card's heading belongs to it */
.card > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.admin-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  vertical-align: bottom;
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
.sample {
  word-break: break-all;
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
