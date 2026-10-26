<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getJson, parseRoute, type HealthData, type Route } from "./api";
import HomeView from "./views/HomeView.vue";
import RunView from "./views/RunView.vue";

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
      <img src="/favicon.svg" alt="" width="26" height="26" />
      <span>Watchwright</span>
    </a>
    <span v-if="health" class="version" :title="`Data folder: ${health.dataDir}`">v{{ health.version }}</span>
    <span v-else-if="down" class="down">Server unreachable</span>
  </header>
  <RunView v-if="route.name === 'run'" :id="route.id" />
  <HomeView v-else />
</template>

<style scoped>
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 17px;
  color: var(--text);
  text-decoration: none;
}
.version {
  color: var(--muted);
  font-size: 13px;
}
.down {
  color: var(--bad);
  font-size: 13px;
}
@media (max-width: 520px) {
  .top {
    padding: 10px 16px;
  }
}
</style>
