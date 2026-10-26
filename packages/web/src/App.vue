<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getJson, liveUrl, type ApiError, type HealthData } from "./api";
import StatusDot from "./components/StatusDot.vue";

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
      <img src="/favicon.svg" alt="" width="26" height="26" />
      <span>Watchwright</span>
    </div>
    <span v-if="health" class="version">v{{ health.version }}</span>
  </header>

  <main class="page">
    <section class="card" aria-labelledby="server-title">
      <h2 id="server-title">Server</h2>
      <dl class="facts">
        <dt>Status</dt>
        <dd><StatusDot :state="serverDot" :label="serverLabel" /></dd>
        <dt>Live connection</dt>
        <dd><StatusDot :state="liveDot" :label="liveLabel" /></dd>
        <template v-if="health">
          <dt>Data folder</dt>
          <dd><code>{{ health.dataDir }}</code></dd>
          <dt>Plugins</dt>
          <dd>
            <span v-for="p in health.plugins" :key="p.name" class="chip">{{ p.name }} <span class="chip-sub">schema {{ p.schemaVersion }}</span></span>
          </dd>
        </template>
      </dl>
    </section>

    <section class="card empty" aria-labelledby="runs-title">
      <h2 id="runs-title">Runs</h2>
      <p>No runs yet. Starting, watching and pausing runs comes with the run engine.</p>
    </section>
  </main>
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
}
.version {
  color: var(--muted);
  font-size: 13px;
}
.page {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px;
  display: grid;
  gap: 16px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px 20px;
}
.card h2 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 24px;
  margin: 0;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.chip {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 13px;
}
.chip-sub {
  color: var(--muted);
}
.empty p {
  margin: 0;
  color: var(--muted);
}
@media (max-width: 520px) {
  .page {
    padding: 16px;
  }
  .facts {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .facts dd {
    margin-bottom: 8px;
  }
}
</style>
