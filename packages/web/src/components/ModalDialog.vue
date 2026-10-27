<script setup lang="ts">
// A themed modal dialog on the native <dialog> element, which keeps focus inside, makes the
// page behind inert and closes on Escape. Clicking the backdrop closes it too. The look
// (surface, backdrop, radius) comes from the theme; there is no browser chrome to hide.
import { X } from "../icons";
import { onBeforeUnmount, ref, useId, watch } from "vue";
import { openModals } from "../popup";

const props = withDefaults(defineProps<{ heading: string; width?: string; dismissable?: boolean }>(), { width: "440px", dismissable: true });
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
  // A click on the dialog element itself (not its content) is a click on the backdrop.
  if (props.dismissable && e.target === el.value) open.value = false;
}
</script>

<template>
  <dialog ref="el" class="dlg" :aria-labelledby="titleId" :style="{ '--dlg-width': width }" @cancel="onCancel" @close="forget(), (open = false)" @click="onClick">
    <div v-if="open" class="body">
      <header class="head">
        <h2 :id="titleId" class="display">{{ heading }}</h2>
        <button v-if="dismissable" type="button" class="x" aria-label="Close" @click="open = false">
          <X :size="16" />
        </button>
      </header>
      <div class="content"><slot /></div>
      <footer v-if="$slots.actions" class="actions"><slot name="actions" /></footer>
    </div>
    <!-- Popups inside the dialog (menus, suggestions) teleport here, never straight into the
         <dialog>: a node Vue doesn't track next to the body breaks Vue's patching when the body goes. -->
    <div class="dlg-popups" />
  </dialog>
</template>

<style scoped>
.dlg {
  width: min(var(--dlg-width), calc(100vw - 2 * var(--space-4)));
  max-height: calc(100vh - 2 * var(--space-8));
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 12px 40px rgb(0 0 0 / 28%);
}
.dlg::backdrop {
  background: color-mix(in srgb, var(--canvas) 55%, transparent);
}
.body {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-5);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
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
  min-width: 0;
}
.content :deep(p) {
  margin: 0 0 var(--space-2);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
