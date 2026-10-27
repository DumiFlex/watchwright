<script setup lang="ts">
// A command palette: a search box over a list of commands, opened with a shortcut (Mod+K in
// the app). Typing filters with fuzzy matching; arrows move, Enter runs, Escape closes. It
// sits on a modal <dialog> like ModalDialog, so the page behind is inert while it is open.
import { computed, nextTick, onBeforeUnmount, ref, useId, watch, type Component } from "vue";
import { Search } from "../icons";
import { fuzzy, markHits } from "../fuzzy";
import { openModals } from "../popup";
import KeyHint from "./KeyHint.vue";

export interface PaletteCommand {
  id: string;
  label: string;
  /** A heading the command is listed under while the search box is empty. */
  group?: string | undefined;
  /** Extra words that find the command without being shown. */
  words?: string | undefined;
  /** A short line shown after the label, muted (a run's status and time). */
  note?: string | undefined;
  /** Listed only for a search, not on the empty palette (packs, runs, tests). */
  searchOnly?: boolean | undefined;
  /** A shortcut shown on the right, like "Mod+Enter". */
  keys?: string | undefined;
  icon?: Component | undefined;
  run: () => void;
}

const props = withDefaults(defineProps<{ commands: readonly PaletteCommand[]; label?: string; placeholder?: string }>(), {
  label: "Command palette",
  placeholder: "Type a command or search",
});
const open = defineModel<boolean>("open", { default: false });

/** A search lists at most this many, best first. */
const MAX_FOUND = 60;

const el = ref<HTMLDialogElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const query = ref("");
const active = ref(0);
const id = useId();

interface Row {
  cmd: PaletteCommand;
  parts: { text: string; hit: boolean }[];
  heading?: string | undefined;
}

const rows = computed<Row[]>(() => {
  const q = query.value.trim();
  if (!q) {
    // In their groups, in the order given, with each group listed where it first appears.
    const order: string[] = [];
    const shown = props.commands.filter((c) => !c.searchOnly);
    for (const c of shown) if (!order.includes(c.group ?? "")) order.push(c.group ?? "");
    return order.flatMap((g) =>
      shown
        .filter((c) => (c.group ?? "") === g)
        .map((cmd, i) => ({ cmd, parts: [{ text: cmd.label, hit: false }], heading: i === 0 && g ? g : undefined })),
    );
  }
  const found: { row: Row; score: number }[] = [];
  for (const cmd of props.commands) {
    const m = fuzzy(q, cmd.label);
    const extra = m ? null : fuzzy(q, `${cmd.group ?? ""} ${cmd.words ?? ""}`);
    if (m) found.push({ row: { cmd, parts: markHits(cmd.label, m.hits) }, score: m.score });
    else if (extra) found.push({ row: { cmd, parts: [{ text: cmd.label, hit: false }] }, score: extra.score - 50 });
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FOUND)
    .map((f) => f.row);
});

watch(query, () => (active.value = 0));
watch(active, async (i) => {
  await nextTick();
  list.value?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
});

watch(
  [open, el],
  async ([o, d]) => {
    if (!d) return;
    if (o && !d.open) {
      query.value = "";
      active.value = 0;
      d.showModal();
      openModals.push(d);
      await nextTick();
      input.value?.focus();
    } else if (!o && d.open) d.close();
  },
  { immediate: true, flush: "post" },
);
function forget() {
  const i = el.value ? openModals.indexOf(el.value) : -1;
  if (i >= 0) openModals.splice(i, 1);
}
onBeforeUnmount(() => {
  if (el.value?.open) el.value.close();
  forget();
});

function run(row: Row | undefined) {
  if (!row) return;
  open.value = false;
  // Run after the dialog has closed, so a command that opens another dialog or moves focus
  // isn't undone by the palette giving focus back.
  void nextTick(() => row.cmd.run());
}
function onKey(e: KeyboardEvent) {
  const n = rows.value.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (n) active.value = (active.value + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
  } else if (e.key === "PageDown" || e.key === "PageUp") {
    e.preventDefault();
    if (n) active.value = Math.min(n - 1, Math.max(0, active.value + (e.key === "PageDown" ? 8 : -8)));
  } else if (e.key === "Enter") {
    e.preventDefault();
    run(rows.value[active.value]);
  }
}
function onClick(e: MouseEvent) {
  if (e.target === el.value) open.value = false;
}
</script>

<template>
  <dialog ref="el" class="palette" :aria-label="label" @cancel.prevent="open = false" @close="forget(), (open = false)" @click="onClick">
    <div v-if="open" class="body">
      <div class="search">
        <Search :size="16" class="glass" />
        <input
          ref="input"
          v-model="query"
          class="q"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="`${id}-list`"
          :aria-activedescendant="rows.length ? `${id}-${active}` : undefined"
          :aria-label="label"
          :placeholder="placeholder"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKey"
        />
        <KeyHint keys="Escape" />
      </div>
      <div :id="`${id}-list`" ref="list" class="list" role="listbox" :aria-label="label">
        <template v-for="(row, i) in rows" :key="row.cmd.id">
          <div v-if="row.heading" class="heading" role="presentation">{{ row.heading }}</div>
          <div
            :id="`${id}-${i}`"
            :data-i="i"
            class="option"
            :class="{ on: i === active }"
            role="option"
            :aria-selected="i === active"
            @pointermove="active = i"
            @click="run(row)"
          >
            <component :is="row.cmd.icon" v-if="row.cmd.icon" :size="16" class="icon" />
            <span class="text">
              <template v-for="(p, k) in row.parts" :key="k">
                <mark v-if="p.hit">{{ p.text }}</mark>
                <template v-else>{{ p.text }}</template>
              </template>
            </span>
            <span v-if="row.cmd.note" class="note">{{ row.cmd.note }}</span>
            <span v-if="query.trim() && row.cmd.group" class="group">{{ row.cmd.group }}</span>
            <KeyHint v-if="row.cmd.keys" :keys="row.cmd.keys" />
          </div>
        </template>
        <p v-if="!rows.length" class="none" role="status">Nothing matches "{{ query.trim() }}"</p>
      </div>
      <footer class="foot" aria-hidden="true">
        <span><KeyHint keys="ArrowUp" /> <KeyHint keys="ArrowDown" /> to move</span>
        <span><KeyHint keys="Enter" /> to run</span>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.palette {
  width: min(560px, calc(100vw - 2 * var(--space-4)));
  max-height: min(480px, calc(100vh - 2 * var(--space-8)));
  margin: 12vh auto auto;
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 16px 48px rgb(0 0 0 / 30%);
  overflow: hidden;
}
.palette[open] {
  display: flex;
}
.palette::backdrop {
  background: color-mix(in srgb, var(--canvas) 55%, transparent);
}
.body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}
.search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
  border-bottom: var(--border-width) solid var(--line);
}
.glass {
  color: var(--muted);
}
.q {
  flex: 1;
  min-width: 0;
  height: 48px;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 15px;
  outline: none;
}
.q::placeholder {
  color: var(--muted);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-1);
}
.heading {
  padding: var(--space-2) var(--space-3) var(--space-1);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
.option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 8px var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.option.on {
  background: var(--accent-soft);
}
.icon {
  color: var(--muted);
}
.option.on .icon {
  color: var(--accent-text);
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text mark {
  background: none;
  color: var(--accent-text);
  font-weight: 600;
}
.note {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}
.group {
  color: var(--muted);
  font-size: 12px;
}
.none {
  margin: 0;
  padding: var(--space-6) var(--space-3);
  color: var(--muted);
  text-align: center;
}
.foot {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border-top: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 640px) {
  .palette {
    margin-top: var(--space-4);
  }
  .foot {
    display: none;
  }
}
</style>
