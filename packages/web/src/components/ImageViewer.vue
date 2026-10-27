<script setup lang="ts">
// A full-size image viewer over the page: one image at a time with its name and place in the
// list, previous and next (buttons, arrow keys), zoom (buttons, + and -, Ctrl+wheel or a pinch,
// a click on the image; 0 fits, Z toggles fit and actual size), drag to pan a zoomed image, and
// a download link. Built on <dialog>, so focus stays inside and Escape closes; the page behind
// doesn't scroll while it's open (openModals in popup.ts).
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "../icons";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { openModals } from "../popup";
import { vTip } from "../tooltip";
import { fitScale, keepPoint, MAX_ZOOM, MIN_ZOOM, percent, stepZoom, wheelZoom } from "../zoom";

const props = defineProps<{ images: readonly { url: string; name: string; note?: string | undefined }[]; label?: string }>();
/** The open image, or null when closed. */
const index = defineModel<number | null>({ default: null });

const el = ref<HTMLDialogElement | null>(null);
const stage = ref<HTMLDivElement | null>(null);
const current = computed(() => (index.value === null ? null : (props.images[index.value] ?? null)));

// Zoom: null fits the image in the stage; a number is a scale of the image's own size.
const chosen = ref<number | null>(null);
const natural = ref({ width: 0, height: 0 });
const box = ref({ width: 0, height: 0 });
const fit = computed(() => fitScale(natural.value, box.value));
const scale = computed(() => chosen.value ?? fit.value);
const imgStyle = computed(() => (natural.value.width ? { width: `${natural.value.width * scale.value}px`, height: `${natural.value.height * scale.value}px` } : {}));

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
watch(index, () => {
  chosen.value = null;
  natural.value = { width: 0, height: 0 };
});

const sizer = new ResizeObserver(() => measure());
watch(stage, (s, old) => {
  if (old) sizer.unobserve(old);
  if (s) sizer.observe(s);
});
function measure() {
  const s = stage.value;
  if (!s) return;
  const cs = getComputedStyle(s);
  box.value = {
    width: s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    height: s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}
function onLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  natural.value = { width: img.naturalWidth, height: img.naturalHeight };
  measure();
}

function forget() {
  const i = el.value ? openModals.indexOf(el.value) : -1;
  if (i >= 0) openModals.splice(i, 1);
}
onBeforeUnmount(() => {
  sizer.disconnect();
  if (el.value?.open) el.value.close();
  forget();
});

/** Zooms to `to`, keeping the point at `at` (stage coordinates; the middle by default) in place. */
async function zoomTo(to: number | null, at?: { x: number; y: number }) {
  const s = stage.value;
  const from = scale.value;
  const next = to === null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, to));
  const point = at ?? (s ? { x: s.clientWidth / 2, y: s.clientHeight / 2 } : { x: 0, y: 0 });
  const was = s ? { left: s.scrollLeft, top: s.scrollTop } : { left: 0, top: 0 };
  chosen.value = next !== null && Math.abs(next - fit.value) < 1e-3 ? null : next;
  await nextTick();
  if (!s) return;
  const kept = keepPoint(was, point, from, scale.value);
  s.scrollLeft = kept.left;
  s.scrollTop = kept.top;
}
const zoomIn = () => void zoomTo(stepZoom(scale.value, 1));
const zoomOut = () => void zoomTo(stepZoom(scale.value, -1));
const toggleActual = () => void zoomTo(chosen.value === null ? 1 : null);
const canIn = computed(() => scale.value < MAX_ZOOM - 1e-6);
const canOut = computed(() => scale.value > Math.min(MIN_ZOOM, fit.value) + 1e-6);

function stagePoint(e: { clientX: number; clientY: number }) {
  const r = stage.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls a zoomed image
  e.preventDefault();
  void zoomTo(wheelZoom(scale.value, e.deltaY), stagePoint(e));
}

// Drag to pan; a press that doesn't move is a click, which zooms in at that point or back to fit.
let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
function onDown(e: PointerEvent) {
  if (e.button !== 0 || !stage.value) return;
  drag = { x: e.clientX, y: e.clientY, left: stage.value.scrollLeft, top: stage.value.scrollTop, moved: false };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onMove(e: PointerEvent) {
  if (!drag || !stage.value) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  stage.value.scrollLeft = drag.left - dx;
  stage.value.scrollTop = drag.top - dy;
}
function onUp(e: PointerEvent) {
  const d = drag;
  drag = null;
  if (!d || d.moved) return;
  if (chosen.value === null) void zoomTo(fit.value < 1 ? 1 : 2, stagePoint(e));
  else void zoomTo(null);
}
const panning = computed(() => chosen.value !== null);

function go(step: number) {
  if (index.value === null || props.images.length === 0) return;
  index.value = (index.value + step + props.images.length) % props.images.length;
}
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "ArrowRight") go(1);
  else if (e.key === "ArrowLeft") go(-1);
  else if (e.key === "z" || e.key === "Z") toggleActual();
  else if (e.key === "+" || e.key === "=") zoomIn();
  else if (e.key === "-" || e.key === "_") zoomOut();
  else if (e.key === "0") void zoomTo(null);
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
        <span class="zoombox">
          <button v-tip="'Zoom out (-)'" type="button" class="ib" aria-label="Zoom out" :disabled="!canOut" @click="zoomOut"><ZoomOut :size="17" /></button>
          <button v-tip="chosen === null ? 'Actual size (Z)' : 'Fit to the screen (0)'" type="button" class="pct num" :aria-label="`Zoom ${percent(scale)}`" @click="toggleActual">
            {{ chosen === null ? "Fit" : percent(scale) }}
          </button>
          <button v-tip="'Zoom in (+)'" type="button" class="ib" aria-label="Zoom in" :disabled="!canIn" @click="zoomIn"><ZoomIn :size="17" /></button>
        </span>
        <a v-tip="'Download'" class="ib" :href="current.url" :download="current.name" aria-label="Download">
          <Download :size="17" />
        </a>
        <button v-tip="'Close (Esc)'" type="button" class="ib" aria-label="Close" @click="index = null">
          <X :size="17" />
        </button>
      </div>
      <div ref="stage" class="stage" :class="{ panning }" @wheel="onWheel">
        <img
          :key="current.url"
          :src="current.url"
          :alt="current.name"
          :style="imgStyle"
          draggable="false"
          @load="onLoad"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="drag = null"
        />
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
.ib {
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
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.4;
  cursor: default;
}
.zoombox {
  display: flex;
  align-items: center;
}
.pct {
  min-width: 52px;
  height: 34px;
  padding: 0 var(--space-1);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.pct:hover {
  background: var(--hover);
}
.stage {
  display: grid;
  padding: var(--space-4) var(--space-12);
  overflow: auto;
  overscroll-behavior: contain;
}
.stage img {
  /* margin: auto centers the image while it's smaller than the stage and lets it scroll from its edge once it's larger */
  margin: auto;
  max-width: none;
  border-radius: var(--radius-sm);
  box-shadow: 0 2px 24px rgb(0 0 0 / 0.25);
  cursor: zoom-in;
  user-select: none;
  touch-action: none;
}
.stage.panning img {
  cursor: grab;
}
.stage.panning img:active {
  cursor: grabbing;
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
