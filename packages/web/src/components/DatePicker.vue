<script setup lang="ts">
// A themed replacement for <input type="date">: a button that opens a month calendar.
// The value is "YYYY-MM-DD" (or "" for none). Keys in the calendar: arrows move a day or a
// week, Page Up/Down a month, Home/End the start/end of the week, Enter picks, Escape closes.
import { computed, nextTick, ref, useId } from "vue";
import { addDays, addMonths, compareDays, monthGrid, parseDay, toIso, today, weekday, type Day } from "../calendar";
import { useOutside, usePopup, usePopupHost } from "../popup";

const props = withDefaults(defineProps<{ id?: string | undefined; min?: string | undefined; max?: string | undefined; placeholder?: string; disabled?: boolean; clearable?: boolean }>(), {
  id: undefined,
  min: undefined,
  max: undefined,
  placeholder: "Pick a date",
});
const model = defineModel<string>({ default: "" });

const open = ref(false);
const focus = ref<Day>(today());
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const grid = ref<HTMLElement | null>(null);
const pop = ref<HTMLElement | null>(null);
const titleId = useId();
const { style } = usePopup(button, pop, open);
useOutside([root, pop], open, () => hide(false));
const host = usePopupHost(root);

const picked = computed(() => parseDay(model.value));
const minDay = computed(() => (props.min ? parseDay(props.min) : null));
const maxDay = computed(() => (props.max ? parseDay(props.max) : null));
const days = computed(() => monthGrid(focus.value));
const weeks = computed(() => Array.from({ length: 6 }, (_, w) => days.value.slice(w * 7, w * 7 + 7)));

const fmtLong = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const fmtFull = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const asDate = (d: Day) => new Date(d.y, d.m - 1, d.d);
const label = computed(() => (picked.value ? fmtLong.format(asDate(picked.value)) : ""));
const monthTitle = computed(() => fmtMonth.format(asDate(focus.value)));
// Monday-first short names from a known week (2024-01-01 was a Monday).
const dayNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, 1 + i)));

const same = (a: Day | null, b: Day) => !!a && compareDays(a, b) === 0;
const blocked = (d: Day) => (!!minDay.value && compareDays(d, minDay.value) < 0) || (!!maxDay.value && compareDays(d, maxDay.value) > 0);
const cellId = (d: Day) => `${titleId}-${toIso(d)}`;
/** Keeps keyboard focus on a day that can be picked. */
function clamp(d: Day): Day {
  if (minDay.value && compareDays(d, minDay.value) < 0) return minDay.value;
  if (maxDay.value && compareDays(d, maxDay.value) > 0) return maxDay.value;
  return d;
}
const firstOf = (d: Day): Day => ({ y: d.y, m: d.m, d: 1 });
const lastOf = (d: Day): Day => addDays(addMonths(firstOf(d), 1), -1);
const noPrev = computed(() => !!minDay.value && compareDays(lastOf(addMonths(focus.value, -1)), minDay.value) < 0);
const noNext = computed(() => !!maxDay.value && compareDays(firstOf(addMonths(focus.value, 1)), maxDay.value) > 0);
const range = computed(() => {
  const lo = minDay.value && fmtLong.format(asDate(minDay.value));
  const hi = maxDay.value && fmtLong.format(asDate(maxDay.value));
  if (lo && hi) return `${lo} to ${hi}`;
  if (lo) return `From ${lo}`;
  return hi ? `Until ${hi}` : "";
});

async function show() {
  if (props.disabled) return;
  focus.value = clamp(picked.value ?? today());
  open.value = true;
  await nextTick();
  focusCell();
}
function hide(toButton = true) {
  open.value = false;
  if (toButton) button.value?.focus();
}
function focusCell() {
  void nextTick(() => grid.value?.querySelector<HTMLElement>(`#${CSS.escape(cellId(focus.value))}`)?.focus());
}
function moveTo(d: Day) {
  focus.value = clamp(d);
  focusCell();
}
function pick(d: Day) {
  if (blocked(d)) return;
  model.value = toIso(d);
  hide();
}
function onKey(e: KeyboardEvent) {
  const f = focus.value;
  const keys: Record<string, () => void> = {
    ArrowLeft: () => moveTo(addDays(f, -1)),
    ArrowRight: () => moveTo(addDays(f, 1)),
    ArrowUp: () => moveTo(addDays(f, -7)),
    ArrowDown: () => moveTo(addDays(f, 7)),
    PageUp: () => moveTo(addMonths(f, e.shiftKey ? -12 : -1)),
    PageDown: () => moveTo(addMonths(f, e.shiftKey ? 12 : 1)),
    Home: () => moveTo(addDays(f, -weekday(f))),
    End: () => moveTo(addDays(f, 6 - weekday(f))),
    Enter: () => pick(f),
    " ": () => pick(f),
    Escape: () => hide(),
  };
  const run = keys[e.key];
  if (!run) return;
  e.preventDefault();
  run();
}
// Tabbing away closes the calendar. Focus going nowhere (a day cell re-rendered when the
// month changes) does not; outside clicks are handled by useOutside.
function onFocusOut(e: FocusEvent) {
  const to = e.relatedTarget as Node | null;
  if (open.value && to && !root.value?.contains(to) && !pop.value?.contains(to)) hide(false);
}
</script>

<template>
  <div ref="root" class="dp" @focusout="onFocusOut">
    <div class="row">
      <button
        :id="id"
        ref="button"
        type="button"
        class="trigger"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :disabled="disabled"
        @pointerdown="open && $event.preventDefault()"
        @click="open ? hide() : show()"
        @keydown.down.prevent="show()"
      >
        <span :class="{ placeholder: !label }">{{ label || placeholder }}</span>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button v-if="clearable && model && !disabled" type="button" class="clear" aria-label="Clear date" @click="model = ''">
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
    </div>
    <Teleport :to="host">
      <div v-if="open" ref="pop" class="pop" :style="style" role="dialog" aria-modal="false" :aria-labelledby="titleId" @focusout="onFocusOut">
        <div class="head">
          <button type="button" class="nav" aria-label="Previous month" :disabled="noPrev" @click="moveTo(addMonths(focus, -1))">
            <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true"><path d="M5 1L1 5l4 4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
          </button>
          <span :id="titleId" class="title" aria-live="polite">{{ monthTitle }}</span>
          <button type="button" class="nav" aria-label="Next month" :disabled="noNext" @click="moveTo(addMonths(focus, 1))">
            <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true"><path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
          </button>
        </div>
        <table ref="grid" class="grid" role="grid" :aria-labelledby="titleId" @keydown="onKey">
          <thead>
            <tr>
              <th v-for="n in dayNames" :key="n" scope="col">{{ n }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(w, wi) in weeks" :key="wi">
              <td v-for="d in w" :key="toIso(d)" role="gridcell" :aria-selected="same(picked, d)">
                <button
                  :id="cellId(d)"
                  type="button"
                  class="day num"
                  :class="{ other: d.m !== focus.m, today: same(today(), d), picked: same(picked, d) }"
                  :tabindex="same(focus, d) ? 0 : -1"
                  :disabled="blocked(d)"
                  :aria-label="fmtFull.format(asDate(d))"
                  @click="pick(d)"
                >
                  {{ d.d }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="range" class="range">{{ range }}</p>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dp {
  position: relative;
  width: 100%;
  min-width: 0;
}
.row {
  display: flex;
  gap: var(--space-1);
}
.trigger {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  padding: 6px 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.trigger svg {
  flex: none;
  color: var(--muted);
}
.trigger:hover:not(:disabled) {
  border-color: var(--line-strong);
}
.trigger[aria-expanded="true"] {
  border-color: var(--accent);
}
.trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.placeholder {
  color: var(--muted);
}
.clear {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  padding: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
}
.clear:hover {
  color: var(--text);
  border-color: var(--line-strong);
}
.pop {
  z-index: 30;
  width: 280px;
  max-width: calc(100vw - 32px);
  padding: var(--space-3);
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}
.title {
  font-weight: 600;
}
.nav {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.nav:disabled {
  opacity: 0.3;
  cursor: default;
}
.nav:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.range {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th {
  padding: 2px 0 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
  text-align: center;
}
td {
  padding: 1px;
  text-align: center;
}
.day {
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.day:hover:not(:disabled) {
  background: var(--hover);
}
.day.other {
  color: var(--muted);
}
.day.today {
  border-color: var(--line-strong);
}
.day.picked {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.day:disabled {
  opacity: 0.3;
  cursor: default;
}
.day:focus-visible {
  outline-offset: 0;
}
</style>
