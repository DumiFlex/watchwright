<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Columns2, FolderOpen, ListChecks, Moon, Palette, Plus, Search, Sun, SunMoon } from "./icons";
import { getJson, type HealthData } from "./api";
import BrandMark from "./components/BrandMark.vue";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette.vue";
import KeyHint from "./components/KeyHint.vue";
import MenuButton from "./components/MenuButton.vue";
import ThemePicker from "./components/ThemePicker.vue";
import ToastHost from "./components/ToastHost.vue";
import { sectionOf, useRoute } from "./router";
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

const theme = ref<Theme>(loadTheme(browserStore()));
watch(
  theme,
  (t) => {
    applyTheme(document.documentElement, t);
    saveTheme(browserStore(), t);
  },
  { deep: true },
);

const route = useRoute();
const section = computed(() => sectionOf(route.value));
const health = ref<HealthData | null>(null);
const down = ref(false);

const nav = computed(() => [
  { value: "runs", label: "Runs", href: "#/", current: section.value === "runs" && route.value.name !== "new" },
  { value: "packs", label: "Packs", href: "#/packs", current: section.value === "packs" },
  { value: "compare", label: "Compare", href: "#/compare", current: section.value === "compare" },
  { value: "new", label: "New run", href: "#/new", current: route.value.name === "new" },
]);

// Mod+K anywhere opens the command palette: go to a page or switch the look and mode.
const palette = ref(false);
useShortcut("Mod+K", () => (palette.value = !palette.value));
const go = (hash: string) => () => (location.hash = hash);
const commands = computed<PaletteCommand[]>(() => [
  { id: "go-runs", label: "Runs", group: "Go to", words: "history list", icon: ListChecks, run: go("#/") },
  { id: "go-packs", label: "Packs", group: "Go to", words: "tests suites", icon: FolderOpen, run: go("#/packs") },
  { id: "go-new", label: "New run", group: "Go to", words: "start", icon: Plus, run: go("#/new") },
  { id: "go-compare", label: "Compare", group: "Go to", words: "side by side matrix export", icon: Columns2, run: go("#/compare") },
  ...LOOKS.map((l) => ({ id: `look-${l.id}`, label: `Look: ${l.name}`, group: "Theme", words: l.note, icon: Palette, run: () => (theme.value = { ...theme.value, look: l.id }) })),
  { id: "mode-light", label: "Mode: Light", group: "Theme", icon: Sun, run: () => (theme.value = { ...theme.value, mode: "light" }) },
  { id: "mode-dark", label: "Mode: Dark", group: "Theme", icon: Moon, run: () => (theme.value = { ...theme.value, mode: "dark" }) },
  { id: "mode-system", label: "Mode: System", group: "Theme", icon: SunMoon, run: () => (theme.value = { ...theme.value, mode: "system" }) },
]);

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
      <a v-for="n in nav.slice(0, 3)" :key="n.value" :href="n.href" class="link" :aria-current="n.current ? 'page' : undefined">{{ n.label }}</a>
    </nav>
    <div class="end">
      <a class="btn primary new" href="#/new" :aria-current="route.name === 'new' ? 'page' : undefined">
        <Plus :size="15" />
        New run
      </a>
      <button type="button" class="cmd" aria-label="Commands" aria-keyshortcuts="Control+K Meta+K" @click="palette = true">
        <Search :size="15" />
        <KeyHint keys="Mod+K" class="cmd-keys" />
      </button>
      <ThemePicker v-model="theme" />
      <MenuButton class="navmenu" :items="nav" label="Menu" />
    </div>
  </header>
  <RunView v-if="route.name === 'run'" :id="route.id" />
  <AttemptView v-else-if="route.name === 'attempt'" :run-id="route.runId" :attempt-id="route.attemptId" />
  <NewRunView v-else-if="route.name === 'new'" :query="route.query" />
  <PacksView v-else-if="route.name === 'packs'" />
  <PackView v-else-if="route.name === 'pack'" :id="route.id" />
  <CompareView v-else-if="route.name === 'compare'" :query="route.query" />
  <KitView v-else-if="route.name === 'kit'" />
  <RunsView v-else :query="route.query" />
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
@media (max-width: 640px) {
  .top {
    padding: 0 var(--space-4);
    gap: var(--space-2);
  }
  .nav,
  .new,
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
