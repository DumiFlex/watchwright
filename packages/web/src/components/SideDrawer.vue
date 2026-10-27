<script setup lang="ts">
// A panel that slides in from the side of the page, for details or settings next to what you
// were looking at. It is a modal <dialog> like ModalDialog (focus stays inside, Escape and a
// click on the backdrop close it) and takes the whole width at phone width.
import { onBeforeUnmount, ref, useId, watch } from "vue";
import { X } from "../icons";
import { openModals } from "../popup";

const props = withDefaults(defineProps<{ heading: string; side?: "start" | "end"; width?: string; dismissable?: boolean }>(), {
  side: "end",
  width: "420px",
  dismissable: true,
});
const open = defineModel<boolean>({ default: false });

const el = ref<HTMLDialogElement | null>(null);
const titleId = useId();

watch(
  [open, el],
  ([o, d]) => {
    if (!d) return;
    if (o && !d.open) {
      d.showModal();
      openModals.push(d);
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

function onCancel(e: Event) {
  e.preventDefault();
  if (props.dismissable) open.value = false;
}
function onClick(e: MouseEvent) {
  if (props.dismissable && e.target === el.value) open.value = false;
}
</script>

<template>
  <dialog
    ref="el"
    class="drawer"
    :class="`from-${side}`"
    :aria-labelledby="titleId"
    :style="{ '--drawer-width': width }"
    @cancel="onCancel"
    @close="forget(), (open = false)"
    @click="onClick"
  >
    <div v-if="open" class="panel">
      <header class="head">
        <h2 :id="titleId" class="display">{{ heading }}</h2>
        <button v-if="dismissable" type="button" class="x" aria-label="Close" @click="open = false">
          <X :size="16" />
        </button>
      </header>
      <div class="content"><slot /></div>
      <footer v-if="$slots.actions" class="actions"><slot name="actions" /></footer>
    </div>
  </dialog>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(var(--drawer-width), 100vw);
  max-width: 100vw;
  height: 100%;
  max-height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-left: var(--border-width) solid var(--line-strong);
  background: var(--surface);
  color: var(--text);
  box-shadow: -12px 0 40px rgb(0 0 0 / 22%);
}
.drawer.from-start {
  inset: 0 auto 0 0;
  border-left: 0;
  border-right: var(--border-width) solid var(--line-strong);
  box-shadow: 12px 0 40px rgb(0 0 0 / 22%);
}
.drawer[open] {
  animation: slide-end 180ms ease-out;
}
.drawer.from-start[open] {
  animation-name: slide-start;
}
.drawer::backdrop {
  background: color-mix(in srgb, var(--canvas) 55%, transparent);
}
@keyframes slide-end {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
}
@keyframes slide-start {
  from {
    transform: translateX(-24px);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer[open] {
    animation: none;
  }
}
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
}
.head h2 {
  margin: 0;
  font-size: 16px;
}
.x {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.x:hover {
  background: var(--hover);
  color: var(--text);
}
.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-4) var(--space-5);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-top: var(--border-width) solid var(--line);
}
</style>
