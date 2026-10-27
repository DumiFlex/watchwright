<script setup lang="ts">
// Settings: this browser's look and mode, and the server's machine-wide preferences (the editor
// file links open in, recent folders). Machine-wide values are kept by the server (`/settings`),
// so every browser and agent sees the same; the look stays in this browser.
import { computed, inject, onMounted, ref, type Ref } from "vue";
import { History, Trash2 } from "../icons";
import { getJson, sendJson, type FolderPlaces } from "../api";
import { EDITOR_OPTIONS, editorUrl, type Editor } from "../editor";
import { when } from "../format";
import { tildify } from "../paths";
import { loadSettings, saveSettings, settings } from "../settings";
import { LOOKS, MODES, type Theme } from "../theme";
import { toast } from "../toasts";
import RadioGroup from "../components/RadioGroup.vue";
import SelectMenu from "../components/SelectMenu.vue";
import { vTip } from "../tooltip";

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
  const err = await saveSettings(values);
  if (err) toast(err, { tone: "bad" });
  else toast("Saved", { tone: "ok", timeout: 1500 });
}

const recent = ref<FolderPlaces["recent"]>([]);
async function loadRecent() {
  const res = await getJson<FolderPlaces>("/api/v1/folders/places");
  if (res.ok) recent.value = res.data.recent;
}
async function forget(path?: string) {
  const res = await sendJson<FolderPlaces["recent"]>(`/api/v1/folders/recent${path ? `?path=${encodeURIComponent(path)}` : ""}`, {}, "DELETE");
  if (res.ok) recent.value = res.data;
}

onMounted(() => {
  void loadSettings(true);
  void loadRecent();
});
</script>

<template>
  <main class="page narrow">
    <div class="page-head">
      <div>
        <h1 class="display">Settings</h1>
        <p class="muted">The look is kept by this browser. Everything else is kept by the server, so every browser and agent on this machine sees the same.</p>
      </div>
    </div>

    <section class="card" aria-labelledby="s-look">
      <h2 id="s-look" class="display">Look and mode</h2>
      <p class="muted small">Also in the Theme menu at the top, and in Ctrl+K.</p>
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

    <section class="card" aria-labelledby="s-editor">
      <h2 id="s-editor" class="display">Editor</h2>
      <p class="muted small">Test files, build errors and the line a test broke on open in this editor, at the line.</p>
      <div class="row">
        <label for="s-editor-pick" class="lbl">Open files in</label>
        <SelectMenu id="s-editor-pick" v-model="editor" class="pick" :options="EDITOR_OPTIONS" />
      </div>
      <p v-if="sample" class="muted small">Links look like <code class="sample">{{ sample }}</code>. The editor must be installed on the computer you browse from.</p>
    </section>

    <section class="card" aria-labelledby="s-newrun">
      <h2 id="s-newrun" class="display">New run</h2>
      <p class="muted small">What the New run page fills in when it opens. A run's "New run like this" and presets always fill in their own choices.</p>
      <RadioGroup v-model="newRunFrom" :options="newRunOptions" label="New run starts from" />
    </section>

    <section class="card" aria-labelledby="s-recent">
      <h2 id="s-recent" class="display">Recent folders</h2>
      <p class="muted small">The folder browser lists the last ten folders packs were added or moved from.</p>
      <ul v-if="recent.length" class="recent">
        <li v-for="r in recent" :key="r.path">
          <History :size="15" class="muted" />
          <code class="rpath" :class="{ gone: !r.exists }">{{ tildify(r.path, settings.home) }}</code>
          <span v-tip="when(r.usedAt)" class="muted small">{{ r.exists ? "" : "gone · " }}{{ new Date(r.usedAt).toLocaleDateString() }}</span>
          <button v-tip="'Forget this folder'" type="button" class="ib" :aria-label="`Forget ${r.path}`" @click="forget(r.path)"><Trash2 :size="14" /></button>
        </li>
      </ul>
      <p v-else class="muted">No recent folders.</p>
      <button v-if="recent.length" class="btn" @click="forget()">Clear the list</button>
    </section>
  </main>
</template>

<style scoped>
.narrow {
  max-width: 860px;
}
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
.recent {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.recent li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.rpath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rpath.gone {
  text-decoration: line-through;
  color: var(--muted);
}
.ib {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover {
  background: var(--hover);
  color: var(--bad);
}
.btn {
  justify-self: start;
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
