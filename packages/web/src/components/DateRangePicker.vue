<script setup lang="ts">
// Pick a span of days: a button that opens a month calendar where the first click picks
// the first day and the second the last (in either order), with the span shown as a band
// while you hover. Presets on the side pick common spans at once. The value is
// { from, to } as "YYYY-MM-DD" strings, both "" for any date.
import { Calendar, X } from "../icons";
import { computed, nextTick, ref } from "vue";
import { addDays, compareDays, parseDay, toIso, today, type Day } from "../calendar";
import { useOutside, usePopup, usePopupHost } from "../popup";
import CalendarMonth from "./CalendarMonth.vue";

export type DateRange = { from: string; to: string };

const props = withDefaults(
  defineProps<{ id?: string | undefined; min?: string | undefined; max?: string | undefined; placeholder?: string; disabled?: boolean; presets?: boolean }>(),
  { id: undefined, min: undefined, max: undefined, placeholder: "Any date", presets: true },
);
const model = defineModel<DateRange>({ default: () => ({ from: "", to: "" }) });

const open = ref(false);
const focus = ref<Day>(today());
const anchor = ref<Day | null>(null);
const hover = ref<Day | null>(null);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLElement | null>(null);
const cal = ref<InstanceType<typeof CalendarMonth> | null>(null);
const { style } = usePopup(button, pop, open);
useOutside([root, pop], open, () => hide(false));
const host = usePopupHost(root);

const from = computed(() => parseDay(model.value.from));
const to = computed(() => parseDay(model.value.to));
const asDate = (d: Day) => new Date(d.y, d.m - 1, d.d);
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const label = computed(() => {
  if (from.value && to.value) return compareDays(from.value, to.value) === 0 ? fmt.format(asDate(from.value)) : fmt.formatRange(asDate(from.value), asDate(to.value));
  return "";
});

const order = (a: Day, b: Day): [Day, Day] => (compareDays(a, b) <= 0 ? [a, b] : [b, a]);
const between = (d: Day, a: Day, b: Day) => {
  const [lo, hi] = order(a, b);
  return compareDays(d, lo) >= 0 && compareDays(d, hi) <= 0;
};
const isPicked = (d: Day) => {
  if (anchor.value) return compareDays(d, anchor.value) === 0;
  return (!!from.value && compareDays(d, from.value) === 0) || (!!to.value && compareDays(d, to.value) === 0);
};
const inBand = (d: Day) => {
  if (anchor.value) return between(d, anchor.value, hover.value ?? anchor.value);
  return !!from.value && !!to.value && between(d, from.value, to.value);
};

async function show() {
  if (props.disabled) return;
  anchor.value = null;
  hover.value = null;
  focus.value = from.value ?? today();
  open.value = true;
  await nextTick();
  if (cal.value) focus.value = cal.value.clamp(focus.value);
  cal.value?.focusDay();
}
function hide(toButton = true) {
  open.value = false;
  anchor.value = null;
  if (toButton) button.value?.focus();
}
function set(a: Day, b: Day) {
  const [lo, hi] = order(a, b);
  model.value = { from: toIso(lo), to: toIso(hi) };
}
function pick(d: Day) {
  if (!anchor.value) {
    anchor.value = d;
    hover.value = d;
    return;
  }
  set(anchor.value, d);
  hide();
}
function onEscape() {
  // The first Escape drops a half-picked span, the second closes.
  if (anchor.value) anchor.value = null;
  else hide();
}

const PRESETS: { label: string; span: (t: Day) => [Day, Day] }[] = [
  { label: "Today", span: (t) => [t, t] },
  { label: "Last 7 days", span: (t) => [addDays(t, -6), t] },
  { label: "Last 30 days", span: (t) => [addDays(t, -29), t] },
  { label: "This month", span: (t) => [{ y: t.y, m: t.m, d: 1 }, t] },
];
function preset(span: (t: Day) => [Day, Day]) {
  const [a, b] = span(today());
  const clamp = cal.value?.clamp ?? ((d: Day) => d);
  set(clamp(a), clamp(b));
  hide();
}
function clear() {
  model.value = { from: "", to: "" };
  hide();
}
function onFocusOut(e: FocusEvent) {
  const t = e.relatedTarget as Node | null;
  if (open.value && t && !root.value?.contains(t) && !pop.value?.contains(t)) hide(false);
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
        <Calendar :size="15" />
      </button>
      <button v-if="label && !disabled" type="button" class="clear" aria-label="Clear dates" @click="model = { from: '', to: '' }">
        <X :size="13" />
      </button>
    </div>
    <Teleport :to="host">
      <div v-if="open" ref="pop" class="pop" :class="{ presets }" :style="style" role="dialog" aria-label="Choose a span of days" @focusout="onFocusOut">
        <div v-if="presets" class="side">
          <button v-for="p in PRESETS" :key="p.label" type="button" @click="preset(p.span)">{{ p.label }}</button>
          <button type="button" class="muted" @click="clear">Any date</button>
        </div>
        <div class="main">
          <CalendarMonth
            ref="cal"
            v-model:focus="focus"
            :min="min"
            :max="max"
            :picked="isPicked"
            :in-band="inBand"
            @pick="pick"
            @hover="hover = $event ?? anchor"
            @escape="onEscape"
          />
          <p class="hint" aria-live="polite">{{ anchor ? "Now pick the last day" : "Pick the first day" }}</p>
        </div>
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
  display: flex;
  gap: var(--space-3);
  max-width: calc(100vw - 16px);
  padding: var(--space-3);
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
.main {
  width: 280px;
  max-width: 100%;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 120px;
  padding-right: var(--space-3);
  border-right: var(--border-width) solid var(--line);
}
.side button {
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.side button:hover {
  background: var(--hover);
}
.side .muted {
  margin-top: auto;
  color: var(--muted);
}
.hint {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
@media (max-width: 480px) {
  .pop {
    flex-direction: column;
  }
  .side {
    flex-direction: row;
    flex-wrap: wrap;
    padding: 0 0 var(--space-2);
    border-right: 0;
    border-bottom: var(--border-width) solid var(--line);
  }
  .side .muted {
    margin-top: 0;
  }
}
</style>
