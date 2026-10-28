<script setup lang="ts">
// Two screenshots of the same thing, compared three ways: side by side, a wipe (drag the line,
// or use the slider or arrow keys) and an overlay that shows the changed pixels strongly over a
// faded copy of the newer one. The summary says how much changed and where. 1, 2 and 3 switch
// the view while the comparison has focus. Both images must come from this server, so the
// page may read their pixels.
import { computed, onMounted, ref, useId, watch } from "vue";
import { changedText, diffPixels, type PixelDiff } from "../imagediff";
import RangeSlider from "./RangeSlider.vue";
import TabBar from "./TabBar.vue";

export interface DiffImage {
  url: string;
  /** Says which this is: "Before · run 51f0b2d4". */
  label: string;
  note?: string | undefined;
}
type Mode = "side" | "wipe" | "overlay";

const props = defineProps<{ before: DiffImage; after: DiffImage }>();

const id = useId();
const mode = ref<Mode>("side");
const tabs = [
  { value: "side" as const, label: "Side by side" },
  { value: "wipe" as const, label: "Wipe" },
  { value: "overlay" as const, label: "Overlay" },
];
const wipe = ref(50);
const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const sizes = ref<{ before: [number, number]; after: [number, number] } | null>(null);
const diff = ref<PixelDiff | null>(null);
const failed = ref(false);

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}
function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}
/** "rgb(12, 34, 56)" (what getComputedStyle gives for a token) as numbers. */
function rgbOf(css: string, fallback: [number, number, number]): [number, number, number] {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

let token = 0;
async function compare() {
  const mine = ++token;
  failed.value = false;
  diff.value = null;
  try {
    const [a, b] = await Promise.all([load(props.before.url), load(props.after.url)]);
    if (mine !== token) return;
    sizes.value = { before: [a.naturalWidth, a.naturalHeight], after: [b.naturalWidth, b.naturalHeight] };
    const pa = pixels(a);
    const pb = pixels(b);
    const style = root.value ? getComputedStyle(root.value) : null;
    diff.value = diffPixels(pa, pb, Math.min(pa.width, pb.width), Math.min(pa.height, pb.height), {
      mark: rgbOf(style?.color ?? "", [220, 38, 38]),
      ground: rgbOf(style?.backgroundColor ?? "", [255, 255, 255]),
    });
    paint();
  } catch {
    if (mine === token) failed.value = true;
  }
}
function paint() {
  const d = diff.value;
  const c = canvas.value;
  if (!d || !c) return;
  c.width = d.width;
  c.height = d.height;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(d.overlay), d.width, d.height), 0, 0);
  if (d.box) {
    ctx.strokeStyle = root.value ? getComputedStyle(root.value).color : "red";
    ctx.lineWidth = Math.max(2, Math.round(d.width / 400));
    const pad = ctx.lineWidth * 3;
    ctx.strokeRect(d.box.x - pad, d.box.y - pad, d.box.w + pad * 2, d.box.h + pad * 2);
  }
}
onMounted(() => void compare());
watch(() => [props.before.url, props.after.url], () => void compare());
watch(mode, (m) => m === "overlay" && setTimeout(paint, 0));

const sameSize = computed(() => !sizes.value || (sizes.value.before[0] === sizes.value.after[0] && sizes.value.before[1] === sizes.value.after[1]));
const summary = computed(() => {
  const d = diff.value;
  if (!d) return failed.value ? "Couldn't read the images." : "Comparing…";
  if (d.changed === 0) return "No pixels changed.";
  return `${changedText(d)} of pixels changed`;
});
const area = computed(() => (diff.value?.box ? `Changed area ${diff.value.box.w} × ${diff.value.box.h} px at ${diff.value.box.x}, ${diff.value.box.y}` : ""));
const tone = computed(() => (!diff.value ? "" : diff.value.changed === 0 ? "same" : "changed"));
// In the wipe, both images keep their own scale: the wider one fills the box.
const widths = computed(() => {
  if (!sizes.value) return { before: "100%", after: "100%" };
  const max = Math.max(sizes.value.before[0], sizes.value.after[0]);
  return { before: `${(sizes.value.before[0] / max) * 100}%`, after: `${(sizes.value.after[0] / max) * 100}%` };
});

const wipeBox = ref<HTMLElement | null>(null);
let dragging = false;
function wipeAt(e: PointerEvent) {
  const box = wipeBox.value?.getBoundingClientRect();
  if (!box || box.width === 0) return;
  wipe.value = Math.round(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)));
}
function onDown(e: PointerEvent) {
  dragging = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  wipeAt(e);
}
function onMove(e: PointerEvent) {
  if (dragging) wipeAt(e);
}
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable]")) return;
  const to = ({ "1": "side", "2": "wipe", "3": "overlay" } as const)[e.key as "1"];
  if (to) {
    e.preventDefault();
    mode.value = to;
  }
}
</script>

<template>
  <div ref="root" class="image-diff" @keydown="onKey">
    <div class="bar">
      <p class="summary" :class="tone" role="status">
        <strong>{{ summary }}</strong>
        <span v-if="area" class="muted small">{{ area }}</span>
        <span v-if="!sameSize && sizes" class="warn small">
          The sizes differ ({{ sizes.before[0] }} × {{ sizes.before[1] }} and {{ sizes.after[0] }} × {{ sizes.after[1] }}); the area both cover is compared.
        </span>
      </p>
      <TabBar v-model="mode" :tabs="tabs" :id-prefix="`${id}-diff`" label="Show the two images" />
    </div>

    <div v-show="mode === 'side'" :id="`${id}-diff-panel-side`" role="tabpanel" :aria-labelledby="`${id}-diff-tab-side`" class="side">
      <figure>
        <figcaption><strong>{{ before.label }}</strong><span v-if="before.note" class="muted">{{ before.note }}</span></figcaption>
        <img :src="before.url" :alt="before.label" />
      </figure>
      <figure>
        <figcaption><strong>{{ after.label }}</strong><span v-if="after.note" class="muted">{{ after.note }}</span></figcaption>
        <img :src="after.url" :alt="after.label" />
      </figure>
    </div>

    <div v-show="mode === 'wipe'" :id="`${id}-diff-panel-wipe`" role="tabpanel" :aria-labelledby="`${id}-diff-tab-wipe`" class="wipe-panel">
      <div ref="wipeBox" class="wipe" :style="{ maxWidth: sizes ? `${Math.max(sizes.before[0], sizes.after[0])}px` : undefined }" @pointerdown="onDown" @pointermove="onMove" @pointerup="dragging = false" @pointercancel="dragging = false">
        <img class="under" :src="after.url" :alt="after.label" :style="{ width: widths.after }" draggable="false" />
        <div class="clip" :style="{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }">
          <img :src="before.url" :alt="before.label" :style="{ width: widths.before }" draggable="false" />
        </div>
        <div class="handle" :style="{ left: `${wipe}%` }" aria-hidden="true"><span /></div>
        <span class="tag start">Before</span>
        <span class="tag end">After</span>
      </div>
      <RangeSlider v-model="wipe" :label="`Wipe between ${before.label} and ${after.label}`" :format="(v: number) => `${v}%`" />
    </div>

    <div v-show="mode === 'overlay'" :id="`${id}-diff-panel-overlay`" role="tabpanel" :aria-labelledby="`${id}-diff-tab-overlay`" class="overlay">
      <canvas ref="canvas" :aria-label="`Changed pixels of ${after.label} against ${before.label}`" role="img" />
      <p class="muted small">Changed pixels are marked, with a box around them; the rest is the newer image, faded.</p>
    </div>
  </div>
</template>

<style scoped>
.image-diff {
  /* the overlay reads its colors from here: the mark is the text color, the fade goes toward the background */
  color: var(--bad);
  background: var(--surface);
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  color: var(--text);
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  margin: 0;
}
.summary.changed strong {
  color: var(--warn);
}
.summary.same strong {
  color: var(--ok);
}
.warn {
  color: var(--warn);
}
.side {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  color: var(--text);
}
figure {
  margin: 0;
  display: grid;
  align-content: start;
  gap: var(--space-2);
}
figcaption {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: 13px;
}
img,
canvas {
  display: block;
  max-width: 100%;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
}
.side img {
  width: 100%;
}
.wipe-panel {
  display: grid;
  gap: var(--space-2);
  color: var(--text);
}
.wipe {
  position: relative;
  overflow: hidden;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--raised);
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
}
.wipe img {
  border: 0;
  border-radius: 0;
}
.clip {
  position: absolute;
  inset: 0;
  background: var(--raised);
}
.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
}
.handle span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  background: var(--surface);
}
.tag {
  position: absolute;
  bottom: var(--space-2);
  padding: 1px var(--space-2);
  border-radius: var(--radius-sm);
  border: var(--border-width) solid var(--line);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
}
.tag.start {
  left: var(--space-2);
}
.tag.end {
  right: var(--space-2);
}
.overlay {
  display: grid;
  gap: var(--space-2);
  color: var(--text);
}
.overlay p {
  margin: 0;
}
@media (max-width: 720px) {
  .side {
    grid-template-columns: 1fr;
  }
}
</style>
