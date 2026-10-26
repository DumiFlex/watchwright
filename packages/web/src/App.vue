<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, liveUrl, type ApiError, type HealthData } from "./api";
import BrandMark from "./components/BrandMark.vue";
import StatusDot from "./components/StatusDot.vue";
import ThemePicker from "./components/ThemePicker.vue";
import { applyTheme, browserStore, loadTheme, saveTheme, type Theme } from "./theme";

const theme = ref<Theme>(loadTheme(browserStore()));
watch(
  theme,
  (t) => {
    applyTheme(document.documentElement, t);
    saveTheme(browserStore(), t);
  },
  { deep: true },
);

const health = ref<HealthData | null>(null);
const healthError = ref<ApiError | null>(null);
type LiveState = "connecting" | "open" | "closed";
const live = ref<LiveState>("connecting");

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let retryMs = 1000;
let unmounted = false;

async function loadHealth() {
  const res = await getJson<HealthData>("/api/v1/health");
  if (res.ok) {
    health.value = res.data;
    healthError.value = null;
  } else {
    healthError.value = res.error;
  }
}

function connect() {
  live.value = "connecting";
  socket = new WebSocket(liveUrl(window.location));
  socket.onopen = () => {
    live.value = "open";
    retryMs = 1000;
    void loadHealth();
  };
  socket.onclose = () => {
    live.value = "closed";
    if (unmounted) return;
    retry = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 15000);
  };
}

onMounted(() => {
  void loadHealth();
  connect();
});

onBeforeUnmount(() => {
  unmounted = true;
  if (retry) clearTimeout(retry);
  socket?.close();
});

const serverDot = computed(() => (health.value && !healthError.value ? "ok" : healthError.value ? "bad" : "wait"));
const serverLabel = computed(() => (healthError.value ? healthError.value.message : health.value ? "Running" : "Checking…"));
const liveDot = computed(() => ({ open: "ok", connecting: "wait", closed: "bad" })[live.value] as "ok" | "wait" | "bad");
const liveLabel = computed(() => ({ open: "Connected", connecting: "Connecting…", closed: "Disconnected, retrying" })[live.value]);
</script>

<template>
  <header class="top">
    <div class="brand">
      <BrandMark :size="28" />
      <span class="wordmark">Watchwright</span>
      <span v-if="health" class="version num">v{{ health.version }}</span>
    </div>
    <ThemePicker v-model="theme" />
  </header>

  <main class="page">
    <section class="card" aria-labelledby="server-title">
      <h2 id="server-title" class="label">Server</h2>
      <dl class="facts">
        <dt>Status</dt>
        <dd><StatusDot :state="serverDot" :label="serverLabel" /></dd>
        <dt>Live connection</dt>
        <dd><StatusDot :state="liveDot" :label="liveLabel" /></dd>
        <template v-if="health">
          <dt>Data folder</dt>
          <dd><code>{{ health.dataDir }}</code></dd>
          <dt>Plugins</dt>
          <dd class="chips">
            <span v-for="p in health.plugins" :key="p.name" class="chip">{{ p.name }} <span class="chip-sub num">schema {{ p.schemaVersion }}</span></span>
          </dd>
        </template>
      </dl>
    </section>

    <section class="card empty" aria-labelledby="runs-title">
      <h2 id="runs-title" class="label">Runs</h2>
      <p class="display empty-title">No runs yet</p>
      <p>Starting, watching and pausing runs comes with the run engine.</p>
    </section>
  </main>
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
.page {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--space-6);
  display: grid;
  gap: var(--space-4);
}
.card {
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  padding: var(--space-4) var(--space-5);
}
.card .label {
  margin-bottom: var(--space-3);
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-6);
  margin: 0;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.chip {
  display: inline-flex;
  gap: var(--space-2);
  padding: 2px var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-chip);
  background: var(--ground);
  font-size: 13px;
}
.chip-sub {
  color: var(--muted);
  font-size: 12px;
}
.empty-title {
  margin: 0 0 var(--space-1);
  font-size: 20px;
  line-height: 1.3;
}
.empty p:last-child {
  margin: 0;
  color: var(--muted);
}
@media (max-width: 520px) {
  .top {
    padding: var(--space-3) var(--space-4);
  }
  .page {
    padding: var(--space-4);
  }
  .facts {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .facts dd {
    margin-bottom: var(--space-2);
  }
}
</style>
