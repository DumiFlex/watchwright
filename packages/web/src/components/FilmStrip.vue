<script setup lang="ts">
// Stills from a recorded video along its time, as a row of frames. The frame the playhead is
// in is marked; hovering or focusing a frame shows it larger above the strip, and a click (or
// Enter) moves the playhead there. As many frames as fit the width, taken in the page once the
// strip is on screen. The video must come from this server so its pixels can be read.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { frameCount, frameTimes, openFrames, type FrameSource } from "../frames";
import { usePopup, usePopupHost } from "../popup";
import { clock } from "../timeline";
import SkeletonBlock from "./SkeletonBlock.vue";

const props = defineProps<{
  src: string;
  /** How long the strip covers, in ms. */
  duration: number;
  /** Where the playhead is, in ms. */
  playhead?: number;
  label: string;
}>();
const emit = defineEmits<{ seek: [ms: number] }>();

const root = ref<HTMLElement | null>(null);
const width = ref(0);
const times = computed(() => frameTimes(props.duration, frameCount(width.value)));
const stills = ref<(string | null)[]>([]);
const failed = ref(false);
const aspect = ref("16 / 10");

let source: FrameSource | null = null;
let sourceUrl = "";
let token = 0;
async function load() {
  const mine = ++token;
  const want = times.value;
  stills.value = want.map(() => null);
  failed.value = false;
  if (!want.length) return;
  try {
    if (!source || sourceUrl !== props.src) {
      source?.close();
      source = null;
      const opened = await openFrames(props.src);
      if (mine !== token) return opened.close();
      source = opened;
      sourceUrl = props.src;
      if (opened.width && opened.height) aspect.value = `${opened.width} / ${opened.height}`;
    }
    for (let i = 0; i < want.length; i++) {
      const url = await source.grab(want[i]!, 320);
      if (mine !== token) return;
      stills.value[i] = url;
    }
  } catch {
    if (mine === token) failed.value = true;
  }
}

let observer: ResizeObserver | undefined;
let wait = 0;
onMounted(() => {
  observer = new ResizeObserver(([e]) => (width.value = Math.round(e?.contentRect.width ?? 0)));
  if (root.value) observer.observe(root.value);
});
// A new count waits for the width to settle, so dragging a window doesn't grab frames on every step.
watch([times, () => props.src], () => {
  clearTimeout(wait);
  wait = window.setTimeout(() => void load(), 200);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(wait);
  token++;
  source?.close();
});

// Tenths in the labels when frames are under a second apart, or two would read the same.
const fine = computed(() => times.value.length > 0 && props.duration / times.value.length < 1000);
// The frame whose slice holds the playhead.
const current = computed(() => {
  const n = times.value.length;
  if (!n || props.playhead === undefined) return -1;
  return Math.min(n - 1, Math.max(0, Math.floor((props.playhead / props.duration) * n)));
});

// The larger copy of the frame under the pointer or focus.
const peek = ref<number | null>(null);
const peekAnchor = ref<HTMLElement | null>(null);
const peekEl = ref<HTMLElement | null>(null);
const peekOpen = computed(() => peek.value !== null && !!stills.value[peek.value]);
const { style: peekStyle } = usePopup(peekAnchor, peekEl, peekOpen, { side: "top", align: "center", gap: 8 });
const host = usePopupHost(root);
function show(i: number, e: Event) {
  peek.value = i;
  peekAnchor.value = e.currentTarget as HTMLElement;
}
function pick(ms: number) {
  peek.value = null;
  emit("seek", ms);
}
function hide(i: number) {
  if (peek.value === i) peek.value = null;
}
</script>

<template>
  <div ref="root" class="film-strip" role="group" :aria-label="label">
    <p v-if="failed" class="muted small">The video's frames couldn't be read.</p>
    <ol v-else class="frames" :style="{ '--frame-aspect': aspect }" :aria-busy="stills.some((s) => s === null) || undefined">
      <li v-for="(t, i) in times" :key="`${t}-${i}`">
        <button
          type="button"
          class="frame"
          :class="{ on: i === current }"
          :aria-label="`Move the playhead to ${clock(t, true)}`"
          :aria-current="i === current ? 'time' : undefined"
          @click="pick(t)"
          @pointerenter="$event.pointerType !== 'touch' && show(i, $event)"
          @pointerleave="hide(i)"
          @focus="show(i, $event)"
          @blur="hide(i)"
        >
          <img v-if="stills[i]" :src="stills[i]!" alt="" draggable="false" />
          <SkeletonBlock v-else shape="block" height="100%" />
        </button>
        <span class="num muted">{{ clock(t, fine) }}</span>
      </li>
    </ol>
    <Teleport :to="host">
      <div v-if="peekOpen && peek !== null" ref="peekEl" class="film-peek" :style="peekStyle" aria-hidden="true">
        <img :src="stills[peek]!" alt="" />
        <span class="num">{{ clock(times[peek] ?? 0, true) }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.film-strip {
  min-width: 0;
}
.frames {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--space-1);
}
.frames li {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: center;
  font-size: 11px;
}
.frame {
  display: block;
  width: 100%;
  aspect-ratio: var(--frame-aspect);
  padding: 0;
  overflow: hidden;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--raised);
  cursor: pointer;
}
.frame:hover {
  border-color: var(--muted);
}
.frame.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.frame:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.frame img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.frame :deep(.skeleton) {
  border-radius: 0;
}
.film-peek {
  z-index: 40;
  display: grid;
  gap: var(--space-1);
  width: min(360px, 90vw);
  padding: var(--space-1);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  pointer-events: none;
  color: var(--text);
  font-size: 12px;
  text-align: center;
}
.film-peek img {
  display: block;
  width: 100%;
  border-radius: var(--radius-sm);
}
</style>
