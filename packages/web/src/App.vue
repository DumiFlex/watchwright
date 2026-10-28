<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { Moon, Palette, Plus, Search, Settings, Sun, SunMoon } from "./icons";
import { getJson, sendJson, type HealthData, type Pack, type RunSummary } from "./api";
import { finderCommands } from "./finder";
import ApprovalBar from "./components/ApprovalBar.vue";
import BrandMark from "./components/BrandMark.vue";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette.vue";
import KeyHint from "./components/KeyHint.vue";
import MenuButton from "./components/MenuButton.vue";
import ThemePicker from "./components/ThemePicker.vue";
import ToastHost from "./components/ToastHost.vue";
import { useApprovals } from "./approvals";
import { offerNotify, startNotifier } from "./notify";
import { toast } from "./toasts";
import { useRoute } from "./router";
import { DEFAULT_PAGES, hasPage, navFrom, pageIcon } from "./pages";
import { vTip } from "./tooltip";
import { useShortcut } from "./keys";
import { applyTheme, browserStore, loadTheme, LOOKS, saveTheme, type Theme } from "./theme";
import AttemptView from "./views/AttemptView.vue";
import CompareView from "./views/CompareView.vue";
import KitView from "./views/KitView.vue";
import NewRunView from "./views/NewRunView.vue";
import PacksView from "./views/PacksView.vue";
import PackView from "./views/PackView.vue";
import RunsView from "./views/RunsView.vue";
import RunView from "./views/RunView.vue";
import SettingsView from "./views/SettingsView.vue";
import SchedulesView from "./views/SchedulesView.vue";
// The editor (CodeMirror, the YAML checker) loads only when a pack is opened for editing.
const EditView = defineAsyncComponent(() => import("./views/EditView.vue"));

const theme = ref<Theme>(loadTheme(browserStore()));
watch(
  theme,
  (t) => {
    applyTheme(document.documentElement, t);
    saveTheme(browserStore(), t);
  },
  { deep: true },
);
provide("theme", theme);

const route = useRoute();
const health = ref<HealthData | null>(null);
const down = ref(false);

// The menu comes from the pages the server's plugins bring; a page of a plugin that isn't loaded
// doesn't show, and its address shows the runs list.
const pages = computed(() => health.value?.pages ?? DEFAULT_PAGES);
const nav = computed(() => navFrom(pages.value, route.value));
const shown = computed(() => (hasPage(pages.value, route.value) ? route.value : ({ name: "runs", query: {} } as const)));

// Mod+K anywhere opens the command palette: go to a page or switch the look and mode.
const palette = ref(false);
useShortcut("Mod+K", () => (palette.value = !palette.value));
const go = (hash: string) => () => (location.hash = hash);
// Packs, runs and tests to find, fetched each time the palette opens so they're current.
const found = ref<{ packs: Pack[]; runs: RunSummary[] }>({ packs: [], runs: [] });
watch(palette, async (open) => {
  if (!open) return;
  const [packs, runs] = await Promise.all([getJson<Pack[]>("/api/v1/packs"), getJson<RunSummary[]>("/api/v1/runs?limit=200")]);
  found.value = { packs: packs.ok ? packs.data : [], runs: runs.ok ? runs.data : [] };
});
async function runAgain(id: string) {
  const res = await sendJson<RunSummary>(`/api/v1/runs/${id}/again`);
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  offerNotify();
  location.hash = `#/runs/${res.data.id}`;
}
const commands = computed<PaletteCommand[]>(() => [
  ...finderCommands(found.value.packs, found.value.runs, { go: (hash) => (location.hash = hash), again: (id) => void runAgain(id) }),
  ...pages.value.map((p) => ({ id: `go-${p.name}`, label: p.title, group: "Go to", words: p.words ?? "", icon: pageIcon(p.icon), run: go(`#${p.path}`) })),
  ...LOOKS.map((l) => ({ id: `look-${l.id}`, label: `Look: ${l.name}`, group: "Theme", words: l.note, icon: Palette, run: () => (theme.value = { ...theme.value, look: l.id }) })),
  { id: "mode-light", label: "Mode: Light", group: "Theme", icon: Sun, run: () => (theme.value = { ...theme.value, mode: "light" }) },
  { id: "mode-dark", label: "Mode: Dark", group: "Theme", icon: Moon, run: () => (theme.value = { ...theme.value, mode: "dark" }) },
  { id: "mode-system", label: "Mode: System", group: "Theme", icon: SunMoon, run: () => (theme.value = { ...theme.value, mode: "system" }) },
]);

// Desktop notices for runs, when this browser has them on (Settings).
const stopNotifier = startNotifier(() => (route.value.name === "run" ? route.value.id : null));
onBeforeUnmount(stopNotifier);

// Deletes an agent or a script asked for, waiting for the person.
const approvals = useApprovals();

onMounted(async () => {
  const res = await getJson<HealthData>("/api/v1/health");
  if (res.ok) health.value = res.data;
  else down.value = true;
});
</script>

<template>
  <header class="top">
    <a class="brand" href="#/">
      <BrandMark :size="28" />
      <span class="wordmark">Watchwright</span>
    </a>
    <span v-if="health" v-tip="`Data folder: ${health.dataDir}`" class="version num">v{{ health.version }}</span>
    <span v-else-if="down" class="down" role="alert">Server unreachable</span>
    <nav class="nav" aria-label="Main">
      <a v-for="n in nav.filter((x) => x.main)" :key="n.value" :href="n.href" class="link" :aria-current="n.current ? 'page' : undefined">{{ n.label }}</a>
    </nav>
    <div class="end">
      <a v-if="pages.some((p) => p.name === 'new-run')" class="btn primary new" href="#/new" :aria-current="route.name === 'new' ? 'page' : undefined">
        <Plus :size="15" />
        New run
      </a>
      <button type="button" class="cmd" aria-label="Commands" aria-keyshortcuts="Control+K Meta+K" @click="palette = true">
        <Search :size="15" />
        <KeyHint keys="Mod+K" class="cmd-keys" />
      </button>
      <ThemePicker v-model="theme" />
      <a v-if="pages.some((p) => p.name === 'settings')" v-tip="'Settings'" class="cmd gear" href="#/settings" aria-label="Settings" :aria-current="route.name === 'settings' ? 'page' : undefined"><Settings :size="16" /></a>
      <MenuButton class="navmenu" :items="nav" label="Menu" />
    </div>
  </header>
  <ApprovalBar :approvals="approvals.waiting.value" :busy="approvals.busy.value" @answer="(id, ok) => approvals.answer(id, ok)" />
  <RunView v-if="shown.name === 'run'" :id="shown.id" />
  <AttemptView v-else-if="shown.name === 'attempt'" :run-id="shown.runId" :attempt-id="shown.attemptId" :line="shown.line ?? null" />
  <NewRunView v-else-if="shown.name === 'new'" :query="shown.query" />
  <PacksView v-else-if="shown.name === 'packs'" :query="shown.query" />
  <PackView v-else-if="shown.name === 'pack'" :id="shown.id" />
  <EditView v-else-if="shown.name === 'edit'" :id="shown.id" :file="shown.file" :line="shown.line" :record="shown.record ?? false" :explore="shown.watch ?? null" />
  <CompareView v-else-if="shown.name === 'compare'" :query="shown.query" />
  <KitView v-else-if="shown.name === 'kit'" />
  <SettingsView v-else-if="shown.name === 'settings'" />
  <SchedulesView v-else-if="shown.name === 'schedules'" />
  <RunsView v-else :query="shown.query" />
  <CommandPalette v-model:open="palette" :commands="commands" />
  <ToastHost />
</template>

<style scoped>
.top {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-6);
  min-height: 56px;
  background: var(--surface);
  border-bottom: var(--border-width) solid var(--line);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--text);
  text-decoration: none;
}
.wordmark {
  font-family: var(--font-display);
  font-weight: var(--display-weight);
  font-size: 18px;
  font-stretch: var(--display-stretch);
  letter-spacing: var(--wordmark-tracking);
  text-transform: var(--wordmark-case);
}
.version {
  color: var(--muted);
  font-size: 12px;
  margin-left: calc(-1 * var(--space-2));
}
.down {
  color: var(--bad);
  font-size: 13px;
}
.nav {
  display: flex;
  align-self: stretch;
  gap: var(--space-1);
  margin-left: var(--space-4);
}
.link {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 10px;
  color: var(--muted);
  text-decoration: none;
  font-weight: 500;
}
.link:hover {
  color: var(--text);
}
.link[aria-current="page"] {
  color: var(--text);
}
.link[aria-current="page"]::after {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: calc(-1 * var(--border-width));
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}
.end {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}
.new {
  text-decoration: none;
}
.navmenu {
  display: none;
}
.cmd {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 34px;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
}
.cmd:hover {
  background: var(--hover);
  color: var(--text);
}
.gear[aria-current] {
  color: var(--accent-text);
}
@media (max-width: 640px) {
  .top {
    padding: 0 var(--space-4);
    gap: var(--space-2);
  }
  .nav,
  .new,
  .gear,
  .version {
    display: none;
  }
  .navmenu {
    display: inline-block;
  }
  .cmd-keys {
    display: none;
  }
}
</style>
