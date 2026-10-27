<script setup lang="ts">
// A video player with themed controls instead of the browser's own: play and pause, a seek
// bar, the time, speed, frame steps and full screen. Keys while it has focus: Space or K play
// and pause, arrows jump 5 s, comma and period step one frame, F full screen.
// Videos written while recording (WebM) often report an endless duration until the end of the
// file is read, so on load the player seeks far ahead once to make the browser find the end.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { clockTime } from "../format";
import MenuButton from "./MenuButton.vue";
import RangeSlider from "./RangeSlider.vue";
import { vTip } from "../tooltip";

const props = defineProps<{ src: string; label: string }>();

const SPEEDS = [0.5, 1, 1.5, 2, 4];
const FRAME = 1 / 25;

const box = ref<HTMLElement | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const playing = ref(false);
const time = ref(0);
const duration = ref(0);
const speed = ref(1);
const failed = ref(false);
let probing = false;

const speedItems = computed(() => SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, current: s === speed.value })));
const seek = computed({
  get: () => time.value,
  set: (v: number) => {
    if (video.value) video.value.currentTime = v;
    time.value = v;
  },
});

function onMeta() {
  const v = video.value;
  if (!v) return;
  if (Number.isFinite(v.duration)) duration.value = v.duration;
  else {
    probing = true;
    v.currentTime = 1e101;
  }
}
function onDuration() {
  const v = video.value;
  if (!v || !Number.isFinite(v.duration)) return;
  duration.value = v.duration;
  if (probing) {
    probing = false;
    v.currentTime = 0;
  }
}
function onTime() {
  if (!probing && video.value) time.value = video.value.currentTime;
}
function toggle() {
  const v = video.value;
  if (!v) return;
  if (v.paused) void v.play().catch(() => (playing.value = false));
  else v.pause();
}
function jump(by: number) {
  const v = video.value;
  if (!v) return;
  v.currentTime = Math.min(Math.max(0, v.currentTime + by), duration.value || v.currentTime + by);
}
function frame(dir: 1 | -1) {
  video.value?.pause();
  jump(dir * FRAME);
}
function fullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void box.value?.requestFullscreen?.();
}
function setSpeed(v: string) {
  speed.value = Number(v);
}
watch(speed, (s) => {
  if (video.value) video.value.playbackRate = s;
});
watch(
  () => props.src,
  () => {
    playing.value = false;
    time.value = 0;
    duration.value = 0;
    failed.value = false;
  },
);

function onKey(e: KeyboardEvent) {
  // Keys that the seek bar and the speed menu handle themselves stay theirs.
  if ((e.target as HTMLElement).closest(".seek, .speed")) return;
  const k = e.key;
  if (k === " " || k === "k" || k === "K") toggle();
  else if (k === "ArrowRight") jump(5);
  else if (k === "ArrowLeft") jump(-5);
  else if (k === ".") frame(1);
  else if (k === ",") frame(-1);
  else if (k === "f" || k === "F") fullscreen();
  else return;
  e.preventDefault();
}
onBeforeUnmount(() => video.value?.pause());
</script>

<template>
  <div ref="box" class="vp" tabindex="0" :aria-label="label" role="group" @keydown="onKey">
    <video
      ref="video"
      :src="src"
      preload="metadata"
      playsinline
      @click="toggle"
      @loadedmetadata="onMeta"
      @durationchange="onDuration"
      @timeupdate="onTime"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @error="failed = true"
    />
    <p v-if="failed" class="failed">This video can't be played here. <a :href="src" download>Download it</a> instead.</p>
    <div class="controls">
      <button v-tip="playing ? 'Pause (K)' : 'Play (K)'" type="button" class="ib" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
        <svg v-if="playing" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 3v10M11 3v10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
        <svg v-else viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor" /></svg>
      </button>
      <button v-tip="'Back one frame (,)'" type="button" class="ib" aria-label="Back one frame" @click="frame(-1)">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 3v10M12.5 3.5L6.5 8l6 4.5z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
      </button>
      <button v-tip="'Forward one frame (.)'" type="button" class="ib" aria-label="Forward one frame" @click="frame(1)">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M12 3v10M3.5 3.5L9.5 8l-6 4.5z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>
      </button>
      <div class="seek">
        <RangeSlider v-model="seek" :min="0" :max="duration || 1" :step="0.1" :label="`Position in ${label}`" :format="clockTime" :show-value="false" :disabled="!duration" />
      </div>
      <span class="time num">{{ clockTime(time) }} / {{ duration ? clockTime(duration) : "–:––" }}</span>
      <MenuButton class="speed" :items="speedItems" label="Speed" @select="setSpeed">
        <template #button><span class="num">{{ speed }}×</span></template>
      </MenuButton>
      <button v-tip="'Full screen (F)'" type="button" class="ib" aria-label="Full screen" @click="fullscreen">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.vp {
  display: grid;
  gap: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.vp:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.vp:fullscreen {
  grid-template-rows: minmax(0, 1fr) auto;
  border-radius: 0;
}
video {
  display: block;
  width: 100%;
  max-height: 70vh;
  background: #000;
  cursor: pointer;
}
.vp:fullscreen video {
  max-height: none;
  height: 100%;
}
.failed {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  color: var(--bad);
}
.controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-top: var(--border-width) solid var(--line);
}
.seek {
  flex: 1;
  min-width: 80px;
  padding: 0 var(--space-2);
}
.time {
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}
.ib {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  cursor: pointer;
}
.ib:hover {
  background: var(--hover);
}
.speed :deep(.trigger) {
  min-width: 44px;
  border: 0;
  background: none;
  font-size: 13px;
}
@media (max-width: 640px) {
  .controls {
    flex-wrap: wrap;
  }
  .seek {
    order: -1;
    flex-basis: 100%;
    padding: var(--space-1) var(--space-2) 0;
  }
  .time {
    margin-right: auto;
  }
}
</style>
