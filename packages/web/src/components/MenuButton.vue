<script setup lang="ts">
// A button that opens a menu of links or commands (the ARIA menu button pattern): arrows,
// Home/End and Enter inside, Escape or a click outside closes. Items with `href` are links;
// the others emit `select` with their value.
import { nextTick, ref, useId } from "vue";
import { useOutside, usePopup, usePopupHost } from "../popup";

export interface MenuItem {
  value: string;
  label: string;
  href?: string;
  current?: boolean;
  danger?: boolean;
}

const props = withDefaults(defineProps<{ items: readonly MenuItem[]; label: string; align?: "start" | "end" }>(), { align: "end" });
const emit = defineEmits<{ select: [value: string] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuId = useId();
const { style } = usePopup(button, menu, open, { align: props.align });
useOutside([root, menu], open, () => hide(false));
const host = usePopupHost(root);

const entries = () => [...(menu.value?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];

async function show(focus: "first" | "last" = "first") {
  open.value = true;
  await nextTick();
  const list = entries();
  (focus === "first" ? list[0] : list[list.length - 1])?.focus();
}
function hide(focusButton = true) {
  open.value = false;
  if (focusButton) button.value?.focus();
}
function pick(item: MenuItem) {
  hide(!item.href);
  if (!item.href) emit("select", item.value);
}
function onMenuKey(e: KeyboardEvent) {
  const list = entries();
  const i = list.indexOf(document.activeElement as HTMLElement);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
  if (to !== undefined) {
    e.preventDefault();
    list[(to + list.length) % list.length]?.focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    hide();
  } else if (e.key === "Tab") hide(false);
}
function onButtonKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    void show(e.key === "ArrowDown" ? "first" : "last");
  }
}
</script>

<template>
  <div ref="root" class="mb">
    <button
      ref="button"
      type="button"
      class="trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-label="label"
      @click="open ? hide() : show()"
      @keydown="onButtonKey"
    >
      <slot name="button">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </slot>
    </button>
    <Teleport :to="host">
      <div v-if="open" :id="menuId" ref="menu" class="menu" :style="style" role="menu" :aria-label="label" @keydown="onMenuKey">
        <template v-for="item in items" :key="item.value">
          <a v-if="item.href" :href="item.href" role="menuitem" tabindex="-1" class="item" :class="{ current: item.current }" :aria-current="item.current ? 'page' : undefined" @click="pick(item)">{{ item.label }}</a>
          <button v-else type="button" role="menuitem" tabindex="-1" class="item" :class="{ danger: item.danger }" @click="pick(item)">{{ item.label }}</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mb {
  position: relative;
  display: inline-block;
}
.trigger {
  display: grid;
  place-items: center;
  min-width: 34px;
  height: 34px;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.trigger:hover,
.trigger[aria-expanded="true"] {
  background: var(--hover);
}
.menu {
  z-index: 40;
  min-width: 180px;
  max-height: var(--popup-room, none);
  overflow-y: auto;
  display: grid;
  padding: var(--space-1);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
}
.item {
  display: block;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.item:hover,
.item:focus-visible {
  background: var(--hover);
  outline: none;
}
.item.current {
  color: var(--accent-text);
  font-weight: 600;
}
.item.danger {
  color: var(--bad);
}
</style>
