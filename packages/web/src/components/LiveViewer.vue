<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { getJson, type FrameHeader } from "../api";
import { History, Radio } from "../icons";
import { rewindSteps, type RewindFrame } from "../rewind";
import TimelineScrubber from "./TimelineScrubber.vue";

// Draws the newest screencast frame of one page on a canvas. It follows the page the run last
// acted on, unless the viewer picks a tab. Rewind shows the server's last 30 s of frames on a
// scrubber (with the steps that ran then); live frames keep coming in underneath.

const props = withDefaults(
  defineProps<{
    pages: { id: string; url: string }[];
    activePageId: string | null;
    running: boolean;
    /** Set to offer Rewind. */
    runId?: string | undefined;
    /** Steps that ran, by start time (ms since the epoch), for the rewind scrubber. */
    steps?: readonly { at: number; label: string }[];
  }>(),
  { runId: undefined, steps: () => [] },
);
const emit = defineEmits<{ rewound: [moment: { pageId: string; at: number } | null] }>();

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

async function startRewind() {
  if (!props.runId) return;
  rewindError.value = null;
  const res = await getJson<{ windowMs: number; frames: RewindFrame[] }>(`/api/v1/live/${props.runId}/rewind`);
  if (!res.ok) {
    rewindError.value = res.error.message;
    return;
  }
  index.value = res.data.frames;
  if (pageFrames.value.length === 0) {
    rewindError.value = "Nothing to rewind to yet.";
    return;
  }
  rewinding.value = true;
  playhead.value = windowLength.value;
  void show();
}
function backToLive() {
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
        @click="chosen = p.id === activePageId ? null : p.id"
      >
        <span class="dot" :class="{ act: p.id === activePageId }" aria-hidden="true" />{{ label(p.url) }}
      </button>
    </div>
    <div class="screen">
      <canvas ref="canvas" :class="{ hidden: !hasFrame }" aria-label="Live view of the browser" />
      <p v-if="!hasFrame" class="placeholder">{{ running ? "Waiting for the first frame…" : "No live picture: the run isn't running." }}</p>
    </div>
    <div v-if="rewinding" class="rewind">
      <TimelineScrubber v-model="playhead" :steps="scrubSteps" :duration="windowLength" label="Rewind, the last 30 seconds" />
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
