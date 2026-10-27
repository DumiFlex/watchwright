<script setup lang="ts">
// A themed replacement for <input type="date">: a button that opens a month calendar
// (CalendarMonth, which has the keys). The value is "YYYY-MM-DD", or "" for none; `min`
// and `max` limit which days can be picked.
import { computed, nextTick, ref } from "vue";
import { compareDays, parseDay, toIso, today, type Day } from "../calendar";
import { useOutside, usePopup, usePopupHost } from "../popup";
import CalendarMonth from "./CalendarMonth.vue";

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
const pop = ref<HTMLElement | null>(null);
const cal = ref<InstanceType<typeof CalendarMonth> | null>(null);
const { style } = usePopup(button, pop, open);
useOutside([root, pop], open, () => hide(false));
const host = usePopupHost(root);

const picked = computed(() => parseDay(model.value));
const fmtLong = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const label = computed(() => (picked.value ? fmtLong.format(new Date(picked.value.y, picked.value.m - 1, picked.value.d)) : ""));
const isPicked = (d: Day) => !!picked.value && compareDays(picked.value, d) === 0;

async function show() {
  if (props.disabled) return;
  focus.value = picked.value ?? today();
  open.value = true;
  await nextTick();
  if (cal.value) focus.value = cal.value.clamp(focus.value);
  cal.value?.focusDay();
}
function hide(toButton = true) {
  open.value = false;
  if (toButton) button.value?.focus();
}
function pick(d: Day) {
  model.value = toIso(d);
  hide();
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
      <div v-if="open" ref="pop" class="pop" :style="style" role="dialog" aria-label="Choose a date" @focusout="onFocusOut">
        <CalendarMonth ref="cal" v-model:focus="focus" :min="min" :max="max" :picked="isPicked" @pick="pick" @escape="hide()" />
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
</style>
