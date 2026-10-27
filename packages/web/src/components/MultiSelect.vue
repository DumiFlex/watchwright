<script setup lang="ts" generic="T extends string | number">
// Pick several options from a long list: chips for what is chosen, a search box, and a
// list grouped by `group` (a click on a group's heading picks or drops the whole group).
// ARIA combobox with a multi-select listbox: arrows move, Enter picks or drops, Escape
// closes (a second Escape clears the search), Backspace in an empty box drops the last chip.
import { Check, X } from "../icons";
import { computed, nextTick, ref, useId, watch } from "vue";
import { useOutside, usePopup, usePopupHost } from "../popup";

type MultiOption<V> = { value: V; label: string; group?: string | undefined; note?: string | undefined };

const props = withDefaults(
  defineProps<{
    options: readonly MultiOption<T>[];
    id?: string | undefined;
    placeholder?: string;
    disabled?: boolean;
    /** Chips shown before the rest fold into "+N more". */
    maxChips?: number;
    /** Text for an empty selection, e.g. "All tests" when nothing chosen means all. */
    emptyLabel?: string | undefined;
  }>(),
  { id: undefined, placeholder: "Search", maxChips: 6, emptyLabel: undefined },
);
const model = defineModel<T[]>({ default: () => [] });

const open = ref(false);
const query = ref("");
const active = ref(0);
const root = ref<HTMLElement | null>(null);
const field = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const listId = useId();
const { style } = usePopup(field, list, open, { matchWidth: true });
useOutside([root, list], open, () => (open.value = false));
const host = usePopupHost(root);

const chosen = computed(() => new Set<T>(model.value));
const chosenOptions = computed(() => props.options.filter((o) => chosen.value.has(o.value)));
const chips = computed(() => chosenOptions.value.slice(0, props.maxChips));
const hidden = computed(() => chosenOptions.value.length - chips.value.length);

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => [o.label, String(o.value), o.group ?? "", o.note ?? ""].some((s) => s.toLowerCase().includes(q)));
});
/** The shown options with a heading before each new group. */
const rows = computed(() => {
  const out: ({ kind: "group"; name: string; values: T[] } | { kind: "option"; option: MultiOption<T>; index: number })[] = [];
  let group: string | undefined;
  shown.value.forEach((o, index) => {
    if (o.group !== undefined && o.group !== group) out.push({ kind: "group", name: o.group, values: shown.value.filter((x) => x.group === o.group).map((x) => x.value) });
    group = o.group;
    out.push({ kind: "option", option: o, index });
  });
  return out;
});

watch(query, () => {
  active.value = 0;
  open.value = !props.disabled;
});

const optionId = (i: number) => `${listId}-o${i}`;
// Keep the order of `options`, whatever order things were picked in.
function setChosen(next: Set<T>) {
  model.value = props.options.filter((o) => next.has(o.value)).map((o) => o.value);
}
function toggle(v: T) {
  const next = new Set(chosen.value);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  setChosen(next);
}
function toggleMany(values: T[]) {
  const next = new Set(chosen.value);
  const all = values.every((v) => next.has(v));
  for (const v of values) {
    if (all) next.delete(v);
    else next.add(v);
  }
  setChosen(next);
}
const allShownChosen = computed(() => shown.value.length > 0 && shown.value.every((o) => chosen.value.has(o.value)));

function scrollActive() {
  void nextTick(() => list.value?.querySelector(`#${CSS.escape(optionId(active.value))}`)?.scrollIntoView({ block: "nearest" }));
}
function move(to: number) {
  if (!open.value) open.value = true;
  active.value = Math.min(shown.value.length - 1, Math.max(0, to));
  scrollActive();
}
function onKey(e: KeyboardEvent) {
  const n = shown.value.length;
  if (e.key === "ArrowDown") move(open.value ? active.value + 1 : active.value);
  else if (e.key === "ArrowUp") move(active.value - 1);
  else if (e.key === "Home" && open.value && !query.value) move(0);
  else if (e.key === "End" && open.value && !query.value) move(n - 1);
  else if (e.key === "Enter" && open.value && n > 0) toggle(shown.value[active.value]!.value);
  else if (e.key === "Escape" && open.value) open.value = false;
  else if (e.key === "Escape" && query.value) query.value = "";
  else if (e.key === "Backspace" && !query.value && model.value.length > 0) model.value = model.value.slice(0, -1);
  else return;
  e.preventDefault();
}
function onFocusOut(e: FocusEvent) {
  const to = e.relatedTarget as Node | null;
  if (to && !root.value?.contains(to) && !list.value?.contains(to)) open.value = false;
}
function focusInput() {
  if (props.disabled) return;
  input.value?.focus();
  open.value = true;
}
</script>

<template>
  <div ref="root" class="ms" :class="{ disabled }" @focusout="onFocusOut">
    <div ref="field" class="control" :class="{ open }" @click="focusInput">
      <span v-for="o in chips" :key="String(o.value)" class="chip">
        <span class="chip-text">{{ o.label }}</span>
        <button type="button" tabindex="-1" :aria-label="`Remove ${o.label}`" :disabled="disabled" @click.stop="toggle(o.value)">
          <X :size="11" />
        </button>
      </span>
      <span v-if="hidden > 0" class="more">+{{ hidden }} more</span>
      <input
        :id="id"
        ref="input"
        v-model="query"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="open && shown.length ? optionId(active) : undefined"
        :placeholder="model.length ? '' : (emptyLabel ?? placeholder)"
        :disabled="disabled"
        @focus="open = true"
        @keydown="onKey"
      />
      <span class="count num" aria-live="polite">{{ model.length ? `${model.length} chosen` : "" }}</span>
    </div>
    <Teleport :to="host">
      <div v-if="open" ref="list" class="ms-pop" :style="style" @pointerdown.prevent>
        <div class="bar">
          <span class="muted">{{ shown.length }} of {{ options.length }}</span>
          <span class="actions">
            <button type="button" :disabled="shown.length === 0" @click="toggleMany(shown.map((o) => o.value))">{{ allShownChosen ? "Drop shown" : "Pick shown" }}</button>
            <button type="button" :disabled="model.length === 0" @click="model = []">Clear</button>
          </span>
        </div>
        <ul :id="listId" role="listbox" aria-multiselectable="true" :aria-labelledby="id">
          <template v-for="r in rows" :key="r.kind === 'group' ? `g:${r.name}` : String(r.option.value)">
            <li v-if="r.kind === 'group'" role="presentation" class="group" @click="toggleMany(r.values)">
              <span>{{ r.name }}</span>
              <span class="muted num">{{ r.values.filter((v) => chosen.has(v)).length }}/{{ r.values.length }}</span>
            </li>
            <li
              v-else
              :id="optionId(r.index)"
              role="option"
              :aria-selected="chosen.has(r.option.value)"
              :class="{ active: r.index === active }"
              @pointerenter="active = r.index"
              @click="toggle(r.option.value)"
            >
              <span class="box" aria-hidden="true">
                <Check :size="12" />
              </span>
              <span class="opt-text">{{ r.option.label }}</span>
              <span v-if="r.option.note" class="note muted">{{ r.option.note }}</span>
            </li>
          </template>
          <li v-if="shown.length === 0" role="presentation" class="empty muted">Nothing matches “{{ query }}”</li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ms {
  width: 100%;
  min-width: 0;
}
.ms.disabled {
  opacity: 0.5;
}
.control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  padding: 3px 8px 3px 4px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: text;
}
.control:hover {
  border-color: var(--line-strong);
}
.control:focus-within,
.control.open {
  border-color: var(--accent);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  padding: 1px 2px 1px 8px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 13px;
}
.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.chip button:hover {
  background: var(--accent);
  color: var(--on-accent);
}
.more {
  padding: 0 4px;
  color: var(--muted);
  font-size: 13px;
}
input {
  flex: 1;
  min-width: 8ch;
  padding: 3px 4px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  outline: none;
}
input::placeholder {
  color: var(--muted);
  opacity: 1;
}
.count {
  color: var(--muted);
  font-size: 12px;
}
.ms-pop {
  z-index: 30;
  display: flex;
  flex-direction: column;
  max-height: min(320px, var(--popup-room, 320px));
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 6px 8px 6px 12px;
  border-bottom: var(--border-width) solid var(--line);
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 4px;
}
.actions button {
  padding: 2px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent-text);
  font: inherit;
  cursor: pointer;
}
.actions button:hover:not(:disabled) {
  background: var(--hover);
}
.actions button:disabled {
  color: var(--muted);
  opacity: 0.6;
  cursor: default;
}
.muted {
  color: var(--muted);
}
ul {
  flex: 1;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
}
li[role="option"] {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
li.active {
  background: var(--raised);
}
.box {
  flex: none;
  align-self: center;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border: calc(var(--border-width) + 0.5px) solid var(--line-strong);
  border-radius: var(--radius-sm);
  color: transparent;
}
li[aria-selected="true"] .box {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.opt-text {
  min-width: 0;
}
.note {
  margin-left: auto;
  font-size: 12px;
  white-space: nowrap;
}
.group {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  padding: 6px 8px 2px;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}
.group:first-child {
  margin-top: 0;
}
.group:hover {
  color: var(--text);
}
.empty {
  padding: 8px;
}
</style>
