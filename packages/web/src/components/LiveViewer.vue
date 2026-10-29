<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { getJson, type FrameHeader } from "../api";
import { History, Pause, Play, Radio, StepBack, StepForward } from "../icons";
import { keyOf, pagePoint, screenRect, type ViewInput } from "../liveinput";
import { neighbourFrame, playStep, REWIND_SPEEDS, rewindSteps, type RewindFrame } from "../rewind";
import { vTip } from "../tooltip";
import MenuButton from "./MenuButton.vue";
import TimelineScrubber from "./TimelineScrubber.vue";

// Draws the newest screencast frame of one page on a canvas. It follows the page the run last
// acted on, unless the viewer picks a tab. Rewind shows the server's last 30 s of frames on a
// scrubber (with the steps that ran then) and plays them like a video: play and pause, speed,
// one frame back or forward, 5 s jumps (keys as in the video player: Space or K, arrows, comma
// and period). Live frames keep coming in underneath; playback that reaches the newest kept
// frame fetches the frames kept since and goes on, and goes back to live once it catches up.
// With `interactive` (Record), presses, drags, the wheel and keys on the picture are sent to the
// page in its own pixels (`input`); with `picking`, a click names a point instead (`pick`).
// `hover` outlines an element (a box in page pixels) until the pointer leaves the picture (`leave`).

const props = withDefaults(
  defineProps<{
    pages: { id: string; url: string }[];
    activePageId: string | null;
    running: boolean;
    /** Set to offer Rewind. */
    runId?: string | undefined;
    /** Steps that ran, by start time (ms since the epoch), for the rewind scrubber. */
    steps?: readonly { at: number; label: string }[];
    interactive?: boolean;
    picking?: boolean;
    hover?: { box: { x: number; y: number; width: number; height: number }; label: string } | null;
  }>(),
  { runId: undefined, steps: () => [], interactive: false, picking: false, hover: null },
);
const emit = defineEmits<{
  rewound: [moment: { pageId: string; at: number } | null];
  input: [input: ViewInput];
  pick: [point: { x: number; y: number }];
  leave: [];
  choosePage: [pageId: string];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const chosen = ref<string | null>(null);
const shownPage = computed(() => chosen.value ?? props.activePageId ?? props.pages[0]?.id ?? null);
const latest = new Map<string, { header: FrameHeader; bitmap: ImageBitmap }>();
const fps = ref(0);
const ageMs = ref<number | null>(null);
const size = ref<{ w: number; h: number } | null>(null);
let stamps: number[] = [];
let tick: ReturnType<typeof setInterval> | null = null;
let drawing = false;

async function push(header: FrameHeader, jpeg: Uint8Array) {
  const blob = new Blob([jpeg.slice()], { type: "image/jpeg" });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return; // a cut-off frame: the next one replaces it
  }
  const prev = latest.get(header.pageId);
  if (prev && prev.header.timestamp > header.timestamp) {
    bitmap.close(); // decoded after a newer frame of the same page
    return;
  }
  prev?.bitmap.close();
  latest.set(header.pageId, { header, bitmap });
  if (header.pageId === shownPage.value && !rewinding.value) {
    stamps.push(performance.now());
    draw();
  }
}

function draw() {
  if (drawing) return;
  drawing = true;
  requestAnimationFrame(() => {
    drawing = false;
    // Read the newest frame now: one that arrived since draw() was called has closed the older bitmap.
    const el = canvas.value;
    const id = shownPage.value;
    const frame = rewinding.value ? past.value : id ? latest.get(id) : undefined;
    if (!el || !frame) return;
    const { bitmap, header } = frame;
    if (el.width !== bitmap.width || el.height !== bitmap.height) {
      el.width = bitmap.width;
      el.height = bitmap.height;
    }
    el.getContext("2d")?.drawImage(bitmap, 0, 0);
    size.value = { w: header.width, h: header.height };
  });
}

// Rewind: the server keeps the last 30 s of frames; the scrubber picks one.
const rewinding = ref(false);
const rewindError = ref<string | null>(null);
const index = ref<RewindFrame[]>([]);
const playhead = ref(0);
const past = shallowRef<{ header: FrameHeader; bitmap: ImageBitmap } | null>(null);
const pageFrames = computed(() => index.value.filter((f) => f.pageId === shownPage.value));
const windowStart = computed(() => pageFrames.value[0]?.timestamp ?? 0);
const windowLength = computed(() => Math.max(1, (pageFrames.value.at(-1)?.timestamp ?? 0) - windowStart.value));
const scrubSteps = computed(() => rewindSteps(props.steps, windowStart.value, windowStart.value + windowLength.value));
const behind = computed(() => (past.value ? Math.max(0, (pageFrames.value.at(-1)?.timestamp ?? 0) - past.value.header.timestamp) : 0));
let loading = 0;

/** Fetches the server's kept frames; false (with the error shown) when that fails. */
async function loadIndex(): Promise<boolean> {
  if (!props.runId) return false;
  const res = await getJson<{ windowMs: number; frames: RewindFrame[] }>(`/api/v1/live/${props.runId}/rewind`);
  if (!res.ok) {
    rewindError.value = res.error.message;
    return false;
  }
  index.value = res.data.frames;
  return true;
}
async function startRewind() {
  rewindError.value = null;
  if (!(await loadIndex())) return;
  if (pageFrames.value.length === 0) {
    rewindError.value = "Nothing to rewind to yet.";
    return;
  }
  rewinding.value = true;
  playhead.value = windowLength.value;
  void show();
}

// Playback: the playhead moves with the clock, at the chosen speed.
const playing = ref(false);
const speed = ref(1);
const speedItems = computed(() => REWIND_SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, current: s === speed.value })));
const windowEnd = computed(() => windowStart.value + windowLength.value);
let playFrame = 0;
let lastTick = 0;
let catchingUp = false;
function play() {
  if (!rewinding.value || playing.value) return;
  playing.value = true;
  lastTick = performance.now();
  cancelAnimationFrame(playFrame);
  playFrame = requestAnimationFrame(playTick);
}
function pause() {
  playing.value = false;
  cancelAnimationFrame(playFrame);
}
function togglePlay() {
  if (playing.value) pause();
  else play();
}
function playTick(now: number) {
  if (!playing.value || !rewinding.value) return;
  const step = playStep(windowStart.value + playhead.value, now - lastTick, speed.value, windowEnd.value);
  lastTick = now;
  playhead.value = step.at - windowStart.value;
  if (step.atEnd) {
    void catchUp(step.at);
    return;
  }
  playFrame = requestAnimationFrame(playTick);
}
/** At the newest kept frame: fetch the frames kept since and go on, or go back to live. */
async function catchUp(at: number) {
  if (catchingUp) return;
  catchingUp = true;
  const ok = await loadIndex();
  catchingUp = false;
  if (!playing.value || !rewinding.value) return;
  if (!ok) {
    pause();
    return;
  }
  // Frames newer than the one shown, closer than a frame interval or two to live, count as caught up.
  if (pageFrames.value.length === 0 || windowEnd.value - at < 250) {
    backToLive();
    return;
  }
  playhead.value = Math.max(0, at - windowStart.value);
  lastTick = performance.now();
  playFrame = requestAnimationFrame(playTick);
}
function jump(by: number) {
  playhead.value = Math.min(windowLength.value, Math.max(0, playhead.value + by));
}
function frameStep(dir: 1 | -1) {
  pause();
  const t = neighbourFrame(
    pageFrames.value.map((f) => f.timestamp),
    past.value?.header.timestamp ?? windowStart.value + playhead.value,
    dir,
  );
  if (t !== null) playhead.value = t - windowStart.value;
}
function setSpeed(v: string) {
  speed.value = Number(v);
}
function onRewindKey(e: KeyboardEvent) {
  // The scrubber and the speed menu handle their own keys.
  if ((e.target as HTMLElement).closest(".scrub, .speed")) return;
  const k = e.key;
  if (k === " " || k === "k" || k === "K") togglePlay();
  else if (k === "ArrowRight") jump(5000);
  else if (k === "ArrowLeft") jump(-5000);
  else if (k === ".") frameStep(1);
  else if (k === ",") frameStep(-1);
  else return;
  e.preventDefault();
}

function backToLive() {
  pause();
  rewinding.value = false;
  rewindError.value = null;
  past.value?.bitmap.close();
  past.value = null;
  emit("rewound", null);
  draw();
}
async function show() {
  const at = windowStart.value + playhead.value;
  const f = pageFrames.value.findLast((x) => x.timestamp <= at) ?? pageFrames.value[0];
  if (!f || f.timestamp === past.value?.header.timestamp) return;
  const ticket = ++loading;
  const res = await fetch(f.url).catch(() => null);
  const blob = res?.ok ? await res.blob() : null;
  if (ticket !== loading || !rewinding.value) return;
  if (!blob) {
    rewindError.value = "That moment has left the server's buffer. Go back to live and rewind again.";
    return;
  }
  rewindError.value = null;
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return;
  if (ticket !== loading || !rewinding.value) {
    bitmap.close();
    return;
  }
  past.value?.bitmap.close();
  past.value = { header: { runId: props.runId ?? "", pageId: f.pageId, timestamp: f.timestamp, width: f.width, height: f.height }, bitmap };
  emit("rewound", { pageId: f.pageId, at: f.timestamp });
  draw();
}
watch(playhead, () => {
  if (rewinding.value) void show();
});
watch(
  () => props.running,
  (on) => {
    if (!on && rewinding.value) backToLive();
  },
);

watch(shownPage, () => {
  if (rewinding.value) backToLive();
  draw();
});
watch(
  () => props.pages.map((p) => p.id).join(","),
  () => {
    if (chosen.value && !props.pages.some((p) => p.id === chosen.value)) chosen.value = null;
    for (const [id, f] of latest) {
      if (props.pages.some((p) => p.id === id)) continue;
      f.bitmap.close();
      latest.delete(id);
    }
  },
);

onMounted(() => {
  tick = setInterval(() => {
    const now = performance.now();
    stamps = stamps.filter((t) => now - t < 2000);
    fps.value = Math.round(stamps.length / 2);
    const id = shownPage.value;
    const f = id ? latest.get(id) : undefined;
    ageMs.value = f ? Math.max(0, Date.now() - f.header.timestamp) : null;
  }, 500);
});
onBeforeUnmount(() => {
  if (tick) clearInterval(tick);
  cancelAnimationFrame(playFrame);
  if (wheelTimer) clearTimeout(wheelTimer);
  if (moveTimer) clearTimeout(moveTimer);
  for (const f of latest.values()) f.bitmap.close();
  past.value?.bitmap.close();
});

const hasFrame = computed(() => size.value !== null);
function label(url: string) {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.host : `${u.host}${u.pathname}`;
  } catch {
    return url || "blank";
  }
}
function age(ms: number | null) {
  if (ms === null) return "–";
  return ms < 1500 ? "live" : `last frame ${Math.round(ms / 1000)} s ago`;
}

function seconds(ms: number) {
  return ms < 1000 ? "the newest frame" : `${Math.round(ms / 1000)} s before the newest frame`;
}

// Input for Record: page pixels from the canvas, presses and releases as they happen (so drags
// and double clicks are real), moves at most every 80 ms (the last one always), and the wheel
// added up per 100 ms. Moves go while picking too, so the outline shows what a click picks.
function pointOf(e: MouseEvent): { x: number; y: number } | null {
  const el = canvas.value;
  const id = shownPage.value;
  const frame = id ? latest.get(id) : undefined;
  if (!el || !frame) return null;
  const r = el.getBoundingClientRect();
  return pagePoint({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: frame.bitmap.width, height: frame.bitmap.height }, { width: frame.header.width, height: frame.header.height }, e.clientX, e.clientY);
}
const BUTTONS = ["left", "middle", "right"] as const;
let lastMove = 0;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let nextMove: { x: number; y: number } | null = null;
let touch: { start: { x: number; y: number }; x: number; y: number; scrolled: boolean } | null = null;
/** Page pixels per screen pixel of the picture. */
function pageScale(): number {
  const el = canvas.value;
  const id = shownPage.value;
  const frame = id ? latest.get(id) : undefined;
  if (!el || !frame) return 1;
  const r = el.getBoundingClientRect();
  const fit = Math.min(r.width / frame.bitmap.width, r.height / frame.bitmap.height);
  return fit > 0 ? frame.header.width / frame.bitmap.width / fit : 1;
}
let wheel: { x: number; y: number; dx: number; dy: number } | null = null;
let wheelTimer: ReturnType<typeof setTimeout> | null = null;
function onDown(e: PointerEvent) {
  if (!props.interactive || rewinding.value) return;
  const p = pointOf(e);
  if (!p) return;
  e.preventDefault();
  canvas.value?.focus();
  if (props.picking) return void emit("pick", p);
  canvas.value?.setPointerCapture(e.pointerId);
  // A finger may tap or scroll: wait to see which (a tap is sent on release).
  if (e.pointerType === "touch") return void (touch = { start: p, x: e.clientX, y: e.clientY, scrolled: false });
  emit("input", { type: "down", ...p, button: BUTTONS[e.button] ?? "left", clickCount: Math.min(3, Math.max(1, e.detail || 1)) });
}
function onUp(e: PointerEvent) {
  if (!props.interactive || props.picking || rewinding.value) return;
  if (e.pointerType === "touch") {
    const t = touch;
    touch = null;
    if (t && !t.scrolled) {
      emit("input", { type: "down", ...t.start, button: "left", clickCount: 1 });
      emit("input", { type: "up", ...t.start, button: "left", clickCount: 1 });
    }
    return;
  }
  const p = pointOf(e);
  if (!p) return;
  emit("input", { type: "up", ...p, button: BUTTONS[e.button] ?? "left", clickCount: Math.min(3, Math.max(1, e.detail || 1)) });
}
function onMove(e: PointerEvent) {
  if (!props.interactive || rewinding.value) return;
  if (e.pointerType === "touch") {
    if (props.picking) return;
    if (!touch) return;
    const dx = touch.x - e.clientX;
    const dy = touch.y - e.clientY;
    if (!touch.scrolled && Math.hypot(dx, dy) < 8) return;
    touch.scrolled = true;
    touch.x = e.clientX;
    touch.y = e.clientY;
    const scale = pageScale();
    addWheel(touch.start, dx * scale, dy * scale);
    return;
  }
  const p = pointOf(e);
  if (!p) return onLeave();
  nextMove = p;
  const wait = 80 - (performance.now() - lastMove);
  if (wait <= 0) sendMove();
  else moveTimer ??= setTimeout(sendMove, wait);
}
function sendMove() {
  if (moveTimer) clearTimeout(moveTimer);
  moveTimer = null;
  const p = nextMove;
  nextMove = null;
  if (!p) return;
  lastMove = performance.now();
  emit("input", { type: "move", ...p });
}
function onLeave() {
  if (moveTimer) clearTimeout(moveTimer);
  moveTimer = null;
  nextMove = null;
  emit("leave");
}
// The outline over the picture, in pixels from the screen's corner.
const outline = computed(() => {
  const h = props.hover;
  const el = canvas.value;
  const id = shownPage.value;
  const frame = id ? latest.get(id) : undefined;
  void size.value; // redraw when the picture's size changes
  if (!h || !el || !frame || rewinding.value) return null;
  const r = screenRect({ width: el.clientWidth, height: el.clientHeight }, { width: frame.bitmap.width, height: frame.bitmap.height }, { width: frame.header.width, height: frame.header.height }, h.box);
  if (!r) return null;
  return { left: `${el.offsetLeft + r.left}px`, top: `${el.offsetTop + r.top}px`, width: `${r.width}px`, height: `${r.height}px`, below: r.top < 24 };
});
function onWheel(e: WheelEvent) {
  if (!props.interactive || rewinding.value) return;
  const p = pointOf(e);
  if (!p) return;
  e.preventDefault();
  addWheel(p, e.deltaX, e.deltaY);
}
function addWheel(p: { x: number; y: number }, dx: number, dy: number) {
  wheel = { x: p.x, y: p.y, dx: (wheel?.dx ?? 0) + dx, dy: (wheel?.dy ?? 0) + dy };
  wheelTimer ??= setTimeout(() => {
    wheelTimer = null;
    if (wheel) emit("input", { type: "wheel", x: wheel.x, y: wheel.y, deltaX: Math.round(wheel.dx), deltaY: Math.round(wheel.dy) });
    wheel = null;
  }, 100);
}
function onKey(e: KeyboardEvent) {
  if (!props.interactive || rewinding.value) return;
  // Paste comes as text (the paste event); the page's own shortcuts go through as keys.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
  const key = keyOf(e);
  if (!key) return;
  e.preventDefault();
  e.stopPropagation();
  emit("input", { type: "key", key });
}
function onPaste(e: ClipboardEvent) {
  if (!props.interactive) return;
  const t = e.clipboardData?.getData("text/plain");
  if (!t) return;
  e.preventDefault();
  emit("input", { type: "text", text: t });
}
function onTab(id: string) {
  if (props.interactive) {
    chosen.value = null;
    emit("choosePage", id);
  } else chosen.value = id === props.activePageId ? null : id;
}

defineExpose({ push, backToLive });
</script>

<template>
  <div class="viewer">
    <div v-if="pages.length > 1" class="tabs" role="tablist" aria-label="Pages">
      <button
        v-for="p in pages"
        :key="p.id"
        role="tab"
        class="tab"
        :class="{ on: p.id === shownPage }"
        :aria-selected="p.id === shownPage"
        @click="onTab(p.id)"
      >
        <span class="dot" :class="{ act: p.id === activePageId }" aria-hidden="true" />{{ label(p.url) }}
      </button>
    </div>
    <div class="screen">
      <canvas
        ref="canvas"
        :class="{ hidden: !hasFrame, interactive, picking }"
        :tabindex="interactive ? 0 : undefined"
        :aria-label="interactive ? 'The recording browser: click and type here' : 'Live view of the browser'"
        @pointerdown="onDown"
        @pointerup="onUp"
        @pointermove="onMove"
        @pointerleave="onLeave"
        @wheel="onWheel"
        @keydown="onKey"
        @paste="onPaste"
        @contextmenu="interactive && $event.preventDefault()"
      />
      <div v-if="outline && hasFrame" class="outline" :class="{ picking }" :style="{ left: outline.left, top: outline.top, width: outline.width, height: outline.height }" aria-hidden="true">
        <span class="tag" :class="{ below: outline.below }">{{ hover?.label }}</span>
      </div>
      <p v-if="!hasFrame" class="placeholder">{{ running ? "Waiting for the first frame…" : "No live picture: the run isn't running." }}</p>
    </div>
    <div v-if="rewinding" class="rewind" role="group" aria-label="Rewind player" tabindex="0" @keydown="onRewindKey">
      <div class="controls">
        <button v-tip="playing ? 'Pause (K)' : 'Play (K)'" type="button" class="ib" :aria-label="playing ? 'Pause the rewind' : 'Play the rewind'" @click="togglePlay">
          <Pause v-if="playing" :size="17" />
          <Play v-else :size="17" />
        </button>
        <button v-tip="'Back one frame (,)'" type="button" class="ib" aria-label="Back one frame" @click="frameStep(-1)">
          <StepBack :size="17" />
        </button>
        <button v-tip="'Forward one frame (.)'" type="button" class="ib" aria-label="Forward one frame" @click="frameStep(1)">
          <StepForward :size="17" />
        </button>
        <button v-tip="'Back 5 seconds (Left)'" type="button" class="ib num" aria-label="Back 5 seconds" @click="jump(-5000)">−5s</button>
        <button v-tip="'Forward 5 seconds (Right)'" type="button" class="ib num" aria-label="Forward 5 seconds" @click="jump(5000)">+5s</button>
        <MenuButton class="speed" :items="speedItems" label="Rewind speed" @select="setSpeed">
          <template #button><span class="num">{{ speed }}×</span></template>
        </MenuButton>
      </div>
      <div class="scrub">
        <TimelineScrubber v-model="playhead" :steps="scrubSteps" :duration="windowLength" label="Rewind, the last 30 seconds" />
      </div>
    </div>
    <div class="meta">
      <template v-if="rewinding">
        <span class="back">Rewound: {{ seconds(behind) }}</span>
        <span v-if="rewindError" role="status">{{ rewindError }}</span>
        <button type="button" class="mini" @click="backToLive"><Radio :size="13" /> Back to live</button>
      </template>
      <template v-else>
        <span>{{ running ? `${fps} fps` : "stopped" }}</span>
        <span>{{ age(ageMs) }}</span>
        <span v-if="size">{{ size.w }}×{{ size.h }}</span>
        <button v-if="runId && running && hasFrame" type="button" class="mini" @click="startRewind"><History :size="13" /> Rewind</button>
        <span v-if="rewindError" role="status">{{ rewindError }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  display: grid;
  gap: 8px;
}
.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 4px 10px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}
.tab.on {
  color: var(--text);
  border-color: var(--accent);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line);
  flex: none;
}
.dot.act {
  background: var(--ok);
}
.screen {
  position: relative;
  background: var(--canvas);
  border-radius: var(--radius);
  overflow: hidden;
  aspect-ratio: 16 / 10;
  display: grid;
  place-items: center;
}
canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
canvas.hidden {
  display: none;
}
canvas.interactive {
  cursor: default;
  touch-action: none;
  outline: none;
}
canvas.interactive:focus-visible {
  box-shadow: inset 0 0 0 2px var(--accent);
}
canvas.picking {
  cursor: crosshair;
}
.outline {
  position: absolute;
  pointer-events: none;
  border: 2px solid var(--accent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.outline.picking {
  border-color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}
.tag {
  position: absolute;
  left: -2px;
  bottom: calc(100% + 4px);
  max-width: 320px;
  padding: 2px 6px;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  border: var(--border-width) solid var(--line);
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag.below {
  top: calc(100% + 4px);
  bottom: auto;
}
.placeholder {
  color: #8d96a0;
  margin: 0;
  padding: 16px;
  text-align: center;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) 14px;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.back {
  color: var(--warn);
}
.rewind {
  display: grid;
  gap: var(--space-1);
  border-radius: var(--radius);
}
.rewind:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}
.ib {
  display: grid;
  place-items: center;
  min-width: 34px;
  height: 34px;
  padding: 0 var(--space-1);
  flex: none;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.ib:hover {
  background: var(--hover);
}
.num {
  font-variant-numeric: tabular-nums;
}
.speed :deep(.trigger) {
  min-width: 44px;
  border: 0;
  background: none;
  font-size: 13px;
}
.mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 2px 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.mini:hover {
  border-color: var(--accent);
}
</style>
