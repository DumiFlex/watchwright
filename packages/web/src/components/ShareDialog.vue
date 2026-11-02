<script setup lang="ts">
// Share a run: make a link that opens its results, screenshots, video and files read-only for
// anyone who has it, without an account; and see or take back the run's links that still work
// (docs/plans/self-hosting.md, section 4). The token shows only once, right after it is made.
import { computed, ref, watch } from "vue";
import { Trash2 } from "../icons";
import { getJson, sendJson, type ShareLink } from "../api";
import { ago } from "../format";
import { session } from "../session";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import CodeView from "./CodeView.vue";
import ModalDialog from "./ModalDialog.vue";
import SelectMenu from "./SelectMenu.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{ runId: string }>();
const open = defineModel<boolean>({ default: false });

const DAYS = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 0, label: "Until I take it back" },
];
const days = ref(7);
const traces = ref(false);
const made = ref<string | null>(null);
const links = ref<ShareLink[]>([]);
const busy = ref(false);
const error = ref<string | null>(null);

async function loadLinks() {
  const res = await getJson<ShareLink[]>(`/api/v1/shares?run=${props.runId}`);
  if (res.ok) links.value = res.data;
}
watch(open, (o) => {
  if (!o) return;
  made.value = null;
  error.value = null;
  void loadLinks();
});

async function make() {
  busy.value = true;
  error.value = null;
  const res = await sendJson<ShareLink & { page: string }>("/api/v1/shares", { run: props.runId, traces: traces.value, ...(days.value ? { days: days.value } : {}) });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  made.value = `${location.origin}/${res.data.page}`;
  await loadLinks();
}
async function remove(l: ShareLink) {
  const res = await sendJson(`/api/v1/shares/${l.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast("The link no longer works.", { tone: "ok" });
  await loadLinks();
}

/** An address only this computer can open (no --public-url): a link made here won't work elsewhere. */
const local = computed(() => ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname));
const linkText = (l: ShareLink) => [`Made ${ago(l.createdAt)}${l.createdBy ? ` by ${l.createdBy}` : ""}`, l.expiresAt ? `until ${new Date(l.expiresAt).toLocaleDateString()}` : "until taken back", `${l.views} ${l.views === 1 ? "view" : "views"}`].join(" · ");
</script>

<template>
  <ModalDialog v-model="open" heading="Share this run" width="520px">
    <div class="share">
      <p class="muted small">Anyone with the link sees this run's results, screenshots, video and files, read-only, without signing in. {{ session.on ? "" : "Without login, anyone who can reach this server sees everything anyway." }}</p>
      <p v-if="local" class="note small">This server's address only works on this computer. To share with others, open Watchwright at the address they use, or start it with <code>--public-url</code>.</p>
      <template v-if="made">
        <CodeView :code="made" label="Share link" />
        <p class="muted small">Copy it now: it isn't shown again. You can take it back below.</p>
      </template>
      <form v-else class="form" @submit.prevent="make">
        <div class="fld">
          <label for="share-days" class="lbl small">The link works for</label>
          <SelectMenu id="share-days" v-model="days" :options="DAYS" />
        </div>
        <div class="fld">
          <ToggleSwitch id="share-traces" v-model="traces">Include traces and network files</ToggleSwitch>
          <p class="muted small">They can hold cookies and tokens the site set. Leave this off unless the person needs them.</p>
        </div>
        <p v-if="error" class="error small" role="alert">{{ error }}</p>
        <div>
          <button type="submit" class="btn primary" :disabled="busy">Make a link</button>
        </div>
      </form>

      <div v-if="links.length" class="links">
        <h3 class="sub">Links that work now</h3>
        <ul>
          <li v-for="l in links" :key="l.id">
            <span class="small">{{ linkText(l) }}<span v-if="l.traces" class="tag">traces</span></span>
            <button v-tip="'Take this link back'" type="button" class="ib" aria-label="Take this link back" @click="remove(l)"><Trash2 :size="14" /></button>
          </li>
        </ul>
      </div>
    </div>
    <template #actions>
      <button type="button" class="btn" @click="open = false">Done</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.share,
.form {
  display: grid;
  gap: var(--space-3);
}
.share p {
  margin: 0;
}
.note {
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--warn);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warn) 10%, var(--surface));
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.fld :deep(.sel) {
  max-width: 240px;
}
.links {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
}
.sub {
  margin: 0;
  font-size: 13px;
}
.links ul {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.links li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.tag {
  margin-left: var(--space-2);
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 11px;
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
</style>
