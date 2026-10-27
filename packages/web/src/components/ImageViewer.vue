<script setup lang="ts">
// A full-size image viewer over the page: one image at a time with its name and place in the
// list, previous and next (buttons, arrow keys), zoom to the image's own size (a click on the
// image or Z), and a download link. Built on <dialog>, so focus stays inside and Escape closes.
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "../icons";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { openModals } from "../popup";
import { vTip } from "../tooltip";

const props = defineProps<{ images: readonly { url: string; name: string; note?: string | undefined }[]; label?: string }>();
/** The open image, or null when closed. */
const index = defineModel<number | null>({ default: null });

const el = ref<HTMLDialogElement | null>(null);
const zoom = ref(false);
const current = computed(() => (index.value === null ? null : (props.images[index.value] ?? null)));

watch(
  [index, el],
  ([i, d]) => {
    if (!d) return;
    if (i !== null && !d.open) {
      d.showModal();
      openModals.push(d);
    } else if (i === null && d.open) d.close();
  },
  { immediate: true, flush: "post" },
);
watch(index, () => (zoom.value = false));

function forget() {
  const i = el.value ? openModals.indexOf(el.value) : -1;
  if (i >= 0) openModals.splice(i, 1);
}
onBeforeUnmount(() => {
  if (el.value?.open) el.value.close();
  forget();
});

function go(step: number) {
  if (index.value === null || props.images.length === 0) return;
  index.value = (index.value + step + props.images.length) % props.images.length;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowRight") go(1);
  else if (e.key === "ArrowLeft") go(-1);
  else if (e.key === "z" || e.key === "Z") zoom.value = !zoom.value;
  else if (e.key === "Home") index.value = 0;
  else if (e.key === "End") index.value = props.images.length - 1;
  else return;
  e.preventDefault();
}
function onCancel(e: Event) {
  e.preventDefault();
  index.value = null;
}
function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t === el.value || t.classList.contains("stage")) index.value = null;
}
</script>

<template>
  <dialog ref="el" class="viewer" :aria-label="label ?? 'Image viewer'" @cancel="onCancel" @close="(index = null), forget()" @click="onClick" @keydown="onKey">
    <template v-if="current">
      <div class="bar">
        <span class="name">{{ current.name }}<span v-if="current.note" class="note"> · {{ current.note }}</span></span>
        <span class="count num">{{ (index ?? 0) + 1 }} / {{ images.length }}</span>
        <slot name="actions" :image="current" />
        <button v-tip="zoom ? 'Fit to the screen (Z)' : 'Actual size (Z)'" type="button" class="ib" :aria-pressed="zoom" aria-label="Actual size" @click="zoom = !zoom">
          <ZoomOut v-if="zoom" :size="17" />
          <ZoomIn v-else :size="17" />
        </button>
        <a v-tip="'Download'" class="ib" :href="current.url" :download="current.name" aria-label="Download">
          <Download :size="17" />
        </a>
        <button v-tip="'Close (Esc)'" type="button" class="ib" aria-label="Close" @click="index = null">
          <X :size="17" />
        </button>
      </div>
      <div class="stage" :class="{ zoom }">
        <img :src="current.url" :alt="current.name" @click="zoom = !zoom" />
      </div>
      <button v-if="images.length > 1" type="button" class="nav prev" aria-label="Previous image" @click="go(-1)">
        <ChevronLeft :size="22" />
      </button>
      <button v-if="images.length > 1" type="button" class="nav next" aria-label="Next image" @click="go(1)">
        <ChevronRight :size="22" />
      </button>
    </template>
  </dialog>
</template>

<style scoped>
.viewer {
  width: 100vw;
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  padding: 0;
  border: 0;
  background: color-mix(in srgb, var(--canvas) 92%, transparent);
  color: var(--text);
}
.viewer[open] {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}
.viewer::backdrop {
  background: transparent;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--surface);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.note {
  font-weight: 400;
  color: var(--muted);
}
.count {
  color: var(--muted);
  font-size: 13px;
}
.ib,
.bar :slotted(.ib) {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover,
.ib[aria-pressed="true"],
.bar :slotted(.ib:hover) {
  background: var(--hover);
  color: var(--text);
}
.stage {
  display: grid;
  place-items: center;
  padding: var(--space-4) var(--space-12);
  overflow: hidden;
}
.stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: 0 2px 24px rgb(0 0 0 / 0.25);
  cursor: zoom-in;
}
.stage.zoom {
  place-items: start center;
  overflow: auto;
}
.stage.zoom img {
  max-width: none;
  max-height: none;
  cursor: zoom-out;
}
.nav {
  position: fixed;
  top: 50%;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: var(--border-width) solid var(--line);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transform: translateY(-50%);
}
.nav:hover {
  background: var(--raised);
}
.prev {
  left: var(--space-2);
}
.next {
  right: var(--space-2);
}
@media (max-width: 640px) {
  .stage {
    padding: var(--space-2);
  }
  .nav {
    top: auto;
    bottom: var(--space-3);
    transform: none;
  }
}
</style>
