<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, parseRoute, type HealthData, type Route } from "./api";
import BrandMark from "./components/BrandMark.vue";
import ThemePicker from "./components/ThemePicker.vue";
import { vTip } from "./tooltip";
import { applyTheme, browserStore, loadTheme, saveTheme, type Theme } from "./theme";
import HomeView from "./views/HomeView.vue";
import KitView from "./views/KitView.vue";
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

const route = ref<Route>(parseRoute(window.location.hash));
const health = ref<HealthData | null>(null);
const down = ref(false);

const onHash = () => {
  route.value = parseRoute(window.location.hash);
  window.scrollTo(0, 0);
};

onMounted(async () => {
  window.addEventListener("hashchange", onHash);
  const res = await getJson<HealthData>("/api/v1/health");
  if (res.ok) health.value = res.data;
  else down.value = true;
});
onBeforeUnmount(() => window.removeEventListener("hashchange", onHash));
</script>

<template>
  <header class="top">
    <a class="brand" href="#/">
      <BrandMark :size="28" />
      <span class="wordmark">Watchwright</span>
      <span v-if="health" v-tip="`Data folder: ${health.dataDir}`" class="version num">v{{ health.version }}</span>
      <span v-else-if="down" class="down">Server unreachable</span>
    </a>
    <ThemePicker v-model="theme" />
  </header>
  <RunView v-if="route.name === 'run'" :id="route.id" />
  <KitView v-else-if="route.name === 'kit'" />
  <HomeView v-else />
</template>

<style scoped>
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
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
}
.down {
  color: var(--bad);
  font-size: 13px;
}
@media (max-width: 520px) {
  .top {
    padding: var(--space-3) var(--space-4);
  }
}
</style>
