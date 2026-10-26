<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { FrameHeader } from "../api";

// Draws the newest screencast frame of one page on a canvas. It follows the page the run last
// acted on, unless the viewer picks a tab.

const props = defineProps<{ pages: { id: string; url: string }[]; activePageId: string | null; running: boolean }>();

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
  latest.get(header.pageId)?.bitmap.close();
  latest.set(header.pageId, { header, bitmap });
  if (header.pageId === shownPage.value) {
    stamps.push(performance.now());
    draw();
  }
}

function draw() {
  const el = canvas.value;
  const id = shownPage.value;
  const frame = id ? latest.get(id) : undefined;
  if (!el || !frame || drawing) return;
  drawing = true;
  requestAnimationFrame(() => {
    drawing = false;
    const { bitmap, header } = frame;
    if (el.width !== bitmap.width || el.height !== bitmap.height) {
      el.width = bitmap.width;
      el.height = bitmap.height;
    }
    el.getContext("2d")?.drawImage(bitmap, 0, 0);
    size.value = { w: header.width, h: header.height };
  });
}

watch(shownPage, draw);
watch(
  () => props.pages.map((p) => p.id).join(","),
  () => {
    if (chosen.value && !props.pages.some((p) => p.id === chosen.value)) chosen.value = null;
    for (const id of latest.keys()) if (!props.pages.some((p) => p.id === id)) latest.delete(id);
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

defineExpose({ push });
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
    <div class="meta">
      <span>{{ running ? `${fps} fps` : "stopped" }}</span>
      <span>{{ age(ageMs) }}</span>
      <span v-if="size">{{ size.w }}×{{ size.h }}</span>
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
  border: 1px solid var(--border);
  border-radius: 6px;
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
  background: var(--border);
  flex: none;
}
.dot.act {
  background: var(--ok);
}
.screen {
  position: relative;
  background: var(--canvas);
  border-radius: 8px;
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
  gap: 14px;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
