<script setup lang="ts">
// A folder path on one line that always fits: the home folder shows as ~, the start is cut
// short with an ellipsis when there's no room, and the last folder always shows. Buttons copy
// the full path and (when `openable`) show the folder in the system's file manager.
import { computed } from "vue";
import { Copy, FolderOpen } from "../icons";
import { sendJson } from "../api";
import { headTail, tildify } from "../paths";
import { toast } from "../toasts";
import { vTip } from "../tooltip";

const props = defineProps<{ path: string; home?: string | null; openable?: boolean }>();
const parts = computed(() => headTail(tildify(props.path, props.home)));

async function copy() {
  try {
    await navigator.clipboard.writeText(props.path);
    toast("Path copied", { tone: "ok", timeout: 2000 });
  } catch {
    toast("Couldn't copy: the browser blocked the clipboard", { tone: "bad" });
  }
}
async function open() {
  const res = await sendJson("/api/v1/folders/open", { path: props.path });
  if (!res.ok) toast(res.error.message, { tone: "bad" });
}
</script>

<template>
  <div class="pl">
    <code v-tip="path" class="path"><span class="head">{{ parts.head }}</span><span class="tail">{{ parts.tail }}</span></code>
    <button v-tip="'Copy the full path'" type="button" class="ib" aria-label="Copy the full path" @click="copy"><Copy :size="14" /></button>
    <button v-if="openable" v-tip="'Show in the file manager'" type="button" class="ib" aria-label="Show the folder in the file manager" @click="open"><FolderOpen :size="14" /></button>
  </div>
</template>

<style scoped>
.pl {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.path {
  display: flex;
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.head {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tail {
  flex: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.ib {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
