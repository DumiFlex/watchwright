<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Plus } from "./icons";
import { getJson, type HealthData } from "./api";
import BrandMark from "./components/BrandMark.vue";
import MenuButton from "./components/MenuButton.vue";
import ThemePicker from "./components/ThemePicker.vue";
import ToastHost from "./components/ToastHost.vue";
import { sectionOf, useRoute } from "./router";
import { vTip } from "./tooltip";
import { applyTheme, browserStore, loadTheme, saveTheme, type Theme } from "./theme";
import AttemptView from "./views/AttemptView.vue";
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
  { value: "new", label: "New run", href: "#/new", current: route.value.name === "new" },
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
      <a v-for="n in nav.slice(0, 2)" :key="n.value" :href="n.href" class="link" :aria-current="n.current ? 'page' : undefined">{{ n.label }}</a>
    </nav>
    <div class="end">
      <a class="btn primary new" href="#/new" :aria-current="route.name === 'new' ? 'page' : undefined">
        <Plus :size="15" />
        New run
      </a>
      <ThemePicker v-model="theme" />
      <MenuButton class="navmenu" :items="nav" label="Menu" />
    </div>
  </header>
  <RunView v-if="route.name === 'run'" :id="route.id" />
  <AttemptView v-else-if="route.name === 'attempt'" :run-id="route.runId" :attempt-id="route.attemptId" />
  <NewRunView v-else-if="route.name === 'new'" :query="route.query" />
  <PacksView v-else-if="route.name === 'packs'" />
  <PackView v-else-if="route.name === 'pack'" :id="route.id" />
  <KitView v-else-if="route.name === 'kit'" />
  <RunsView v-else :query="route.query" />
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
}
</style>
