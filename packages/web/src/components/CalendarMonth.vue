<script setup lang="ts">
// One month of days with its own navigation, shared by DatePicker and DateRangePicker.
// Keys: arrows move a day or a week, Page Up/Down a month (with Shift a year), Home/End the
// start or end of the week, Enter or Space picks, Escape asks the owner to close. Focus
// never lands on a day outside min/max, and the month arrows stop at the limits.
import { computed, nextTick, ref, useId } from "vue";
import { addDays, addMonths, compareDays, monthGrid, parseDay, toIso, today, weekday, type Day } from "../calendar";

const props = withDefaults(
  defineProps<{
    min?: string | undefined;
    max?: string | undefined;
    /** Days drawn as picked (filled). */
    picked?: ((d: Day) => boolean) | undefined;
    /** Days inside a range get a band; the ends are also picked. */
    inBand?: ((d: Day) => boolean) | undefined;
  }>(),
  { min: undefined, max: undefined, picked: undefined, inBand: undefined },
);
const emit = defineEmits<{ pick: [day: Day]; hover: [day: Day | null]; escape: [] }>();
const focus = defineModel<Day>("focus", { required: true });

const grid = ref<HTMLElement | null>(null);
const titleId = useId();
const minDay = computed(() => (props.min ? parseDay(props.min) : null));
const maxDay = computed(() => (props.max ? parseDay(props.max) : null));
const days = computed(() => monthGrid(focus.value));
const weeks = computed(() => Array.from({ length: 6 }, (_, w) => days.value.slice(w * 7, w * 7 + 7)));

const fmtLong = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const fmtFull = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const asDate = (d: Day) => new Date(d.y, d.m - 1, d.d);
const monthTitle = computed(() => fmtMonth.format(asDate(focus.value)));
// Monday-first short names from a known week (2024-01-01 was a Monday).
const dayNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, 1 + i)));
const now = today();

const same = (a: Day | null, b: Day) => !!a && compareDays(a, b) === 0;
const blocked = (d: Day) => (!!minDay.value && compareDays(d, minDay.value) < 0) || (!!maxDay.value && compareDays(d, maxDay.value) > 0);
const cellId = (d: Day) => `${titleId}-${toIso(d)}`;
function clamp(d: Day): Day {
  if (minDay.value && compareDays(d, minDay.value) < 0) return minDay.value;
  if (maxDay.value && compareDays(d, maxDay.value) > 0) return maxDay.value;
  return d;
}
const firstOf = (d: Day): Day => ({ y: d.y, m: d.m, d: 1 });
const lastOf = (d: Day): Day => addDays(addMonths(firstOf(d), 1), -1);
const noPrev = computed(() => !!minDay.value && compareDays(lastOf(addMonths(focus.value, -1)), minDay.value) < 0);
const noNext = computed(() => !!maxDay.value && compareDays(firstOf(addMonths(focus.value, 1)), maxDay.value) > 0);
const limits = computed(() => {
  const lo = minDay.value && fmtLong.format(asDate(minDay.value));
  const hi = maxDay.value && fmtLong.format(asDate(maxDay.value));
  if (lo && hi) return `${lo} to ${hi}`;
  if (lo) return `From ${lo}`;
  return hi ? `Until ${hi}` : "";
});

function focusDay() {
  void nextTick(() => grid.value?.querySelector<HTMLElement>(`#${CSS.escape(cellId(focus.value))}`)?.focus());
}
function moveTo(d: Day) {
  focus.value = clamp(d);
  focusDay();
}
function pick(d: Day) {
  if (!blocked(d)) emit("pick", d);
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
    Escape: () => emit("escape"),
  };
  const run = keys[e.key];
  if (!run) return;
  e.preventDefault();
  run();
  if (e.key.startsWith("Arrow") || e.key.startsWith("Page") || e.key === "Home" || e.key === "End") emit("hover", focus.value);
}

/** Moves to a day (clamped to the limits) and focuses it. */
defineExpose({ focusDay, moveTo, clamp });
</script>

<template>
  <div class="cal" role="group" :aria-labelledby="titleId">
    <div class="head">
      <button type="button" class="nav" aria-label="Previous month" :disabled="noPrev" @click="moveTo(addMonths(focus, -1))">
        <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true"><path d="M5 1L1 5l4 4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
      </button>
      <span :id="titleId" class="title" aria-live="polite">{{ monthTitle }}</span>
      <button type="button" class="nav" aria-label="Next month" :disabled="noNext" @click="moveTo(addMonths(focus, 1))">
        <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true"><path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
      </button>
    </div>
    <table ref="grid" class="grid" role="grid" :aria-labelledby="titleId" @keydown="onKey" @pointerleave="emit('hover', null)">
      <thead>
        <tr>
          <th v-for="n in dayNames" :key="n" scope="col">{{ n }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(w, wi) in weeks" :key="wi">
          <td
            v-for="d in w"
            :key="toIso(d)"
            role="gridcell"
            :aria-selected="picked?.(d) ?? false"
            :class="{ band: inBand?.(d), 'band-start': inBand?.(d) && !inBand?.(addDays(d, -1)), 'band-end': inBand?.(d) && !inBand?.(addDays(d, 1)) }"
          >
            <button
              :id="cellId(d)"
              type="button"
              class="day num"
              :class="{ other: d.m !== focus.m, today: same(now, d), picked: picked?.(d) }"
              :tabindex="same(focus, d) ? 0 : -1"
              :disabled="blocked(d)"
              :aria-label="fmtFull.format(asDate(d))"
              @click="pick(d)"
              @pointerenter="emit('hover', d)"
            >
              {{ d.d }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="limits" class="limits">{{ limits }}</p>
  </div>
</template>

<style scoped>
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
.limits {
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
  padding: 1px 0;
  text-align: center;
}
td.band {
  background: var(--accent-soft);
}
td.band-start {
  border-top-left-radius: var(--radius-sm);
  border-bottom-left-radius: var(--radius-sm);
}
td.band-end {
  border-top-right-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}
.day {
  width: calc(100% - 2px);
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
.day.picked,
.day.picked:hover {
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
