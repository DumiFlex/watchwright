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
import { PUBLIC_ROUTES, useRoute } from "./router";
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
import SharedRunView from "./views/SharedRunView.vue";
import SignInView from "./views/SignInView.vue";
import StatusView from "./views/StatusView.vue";
import { can, loadSession, session, signOut } from "./session";
import { UserRound } from "./icons";
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
const shown = computed(() => {
  const r = route.value;
  return r.name !== "setup" && r.name !== "invite" && r.name !== "signin" && r.name !== "shared" && r.name !== "status" && r.name !== "status-run" && hasPage(pages.value, r) ? r : ({ name: "runs", query: {} } as const);
});

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

async function loadHealth() {
  const res = await getJson<HealthData>("/api/v1/health");
  if (res.ok) health.value = res.data;
  else down.value = true;
}
onMounted(async () => {
  await Promise.all([loadHealth(), loadSession()]);
});
// Share links and the public dashboard open for anyone, signed in or not, with no menu.
const isPublic = computed(() => PUBLIC_ROUTES.includes(route.value.name));
// With login on, nothing but the sign-in page shows until someone is signed in.
const locked = computed(() => session.loaded && session.on && session.user === null);
// After signing in, the full health (pages, data folder) and everything else loads.
watch(
  () => session.user?.id,
  (id, before) => {
    if (id && before === undefined && session.on) void loadHealth();
  },
);
const roleWords: Record<string, string> = { viewer: "Viewer: sees runs and results", user: "User: runs, records and edits packs", admin: "Admin: also users and settings" };
const userItems = computed(() => [
  { value: "account", label: "Your account and tokens", href: "#/settings?section=account" },
  { value: "signout", label: "Sign out" },
]);
</script>

<template>
  <template v-if="isPublic">
    <header class="top">
      <a class="brand" href="#/" aria-label="Watchwright">
        <BrandMark :size="28" />
        <span class="wordmark">Watchwright</span>
      </a>
      <div class="end">
        <ThemePicker v-model="theme" />
      </div>
    </header>
    <SharedRunView v-if="route.name === 'shared'" :api="`/api/v1/shared/${route.token}`" />
    <SharedRunView v-else-if="route.name === 'status-run'" :api="`/api/v1/public/runs/${route.id}`" back="#/status" />
    <StatusView v-else />
    <ToastHost />
  </template>
  <template v-else-if="locked">
    <SignInView :setup-code="route.name === 'setup' ? route.code : null" :invite-code="route.name === 'invite' ? route.code : null" :error="route.name === 'signin' ? route.error : null" />
    <ToastHost />
  </template>
  <template v-else>
    <header class="top">
      <a class="brand" href="#/" aria-label="Watchwright">
        <BrandMark :size="28" />
        <span class="wordmark">Watchwright</span>
      </a>
      <span v-if="health" v-tip="`Data folder: ${health.dataDir}`" class="version num">v{{ health.version }}</span>
      <span v-else-if="down" class="down" role="alert">Server unreachable</span>
      <nav class="nav" aria-label="Main">
        <a v-for="n in nav.filter((x) => x.main)" :key="n.value" :href="n.href" class="link" :aria-current="n.current ? 'page' : undefined">{{ n.label }}</a>
      </nav>
      <div class="end">
        <a v-if="pages.some((p) => p.name === 'new-run') && can('user')" class="btn primary new" href="#/new" :aria-current="route.name === 'new' ? 'page' : undefined">
          <Plus :size="15" />
          New run
        </a>
        <button type="button" class="cmd" aria-label="Commands" aria-keyshortcuts="Control+K Meta+K" @click="palette = true">
          <Search :size="15" />
          <KeyHint keys="Mod+K" class="cmd-keys" />
        </button>
        <ThemePicker v-model="theme" />
        <a v-if="pages.some((p) => p.name === 'settings')" v-tip="'Settings'" class="cmd gear" href="#/settings" aria-label="Settings" :aria-current="route.name === 'settings' ? 'page' : undefined"><Settings :size="16" /></a>
        <MenuButton v-if="session.on && session.user" v-tip="roleWords[session.user.role]" class="usermenu" :items="userItems" :label="`Signed in as ${session.user.name}`" @select="(v) => v === 'signout' && signOut()">
          <template #button>
            <span class="who"><UserRound :size="16" /> <span class="uname">{{ session.user.displayName ?? session.user.name }}</span></span>
          </template>
        </MenuButton>
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
    <SettingsView v-else-if="shown.name === 'settings'" :section="shown.section" />
    <SchedulesView v-else-if="shown.name === 'schedules'" />
    <RunsView v-else :query="shown.query" />
    <CommandPalette v-model:open="palette" :commands="commands" />
    <ToastHost />
  </template>
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
.who {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 13px;
}
.uname {
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Between phone and laptop width the menu still fits once the extras go. */
@media (max-width: 1080px) {
  .version,
  .cmd-keys,
  .uname {
    display: none;
  }
}
@media (max-width: 860px) {
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
/* Narrow phones: wide, tracked looks (Drafting table) would push the menu off the edge. */
@media (max-width: 400px) {
  .wordmark {
    font-size: 16px;
    letter-spacing: normal;
  }
}
@media (max-width: 340px) {
  .wordmark {
    display: none;
  }
}
</style>
