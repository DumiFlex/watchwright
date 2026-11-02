<script setup lang="ts">
// Recent folders: the last folders packs were added or moved from, which the folder browser lists.
// Kept by the server, so on Admin for admins and on Settings for users.
import { onMounted, ref } from "vue";
import { getJson, sendJson, type FolderPlaces } from "../api";
import { when } from "../format";
import { History, Trash2 } from "../icons";
import { tildify } from "../paths";
import { settings } from "../settings";
import { vTip } from "../tooltip";

const recent = ref<FolderPlaces["recent"]>([]);
async function load() {
  const res = await getJson<FolderPlaces>("/api/v1/folders/places");
  if (res.ok) recent.value = res.data.recent;
}
async function forget(path?: string) {
  const res = await sendJson<FolderPlaces["recent"]>(`/api/v1/folders/recent${path ? `?path=${encodeURIComponent(path)}` : ""}`, {}, "DELETE");
  if (res.ok) recent.value = res.data;
}
onMounted(load);
</script>

<template>
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
.card > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
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
</style>
