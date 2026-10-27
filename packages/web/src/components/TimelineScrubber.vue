<script setup lang="ts">
// A run's steps on a time axis with a playhead to drag. Steps that overlap go on separate
// lanes and take the color of their status. Click or drag anywhere to move the playhead;
// hovering shows the time and step under the pointer. The playhead is a role="slider":
// arrows move a second (Shift ten), Page Up/Down jump to the previous or next step,
// Home/End to the ends. v-model is the playhead time in ms; `pick` fires with the step
// clicked on. `marks` are points to flag (a failure, a pause) above the steps.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { clock, laneSteps, nextStart, stepAt, timeTicks, type TimelineStep } from "../timeline";

export type TimelineMark = { at: number; label: string; tone?: "ok" | "bad" | "warn" | "accent" | undefined };

const props = withDefaults(defineProps<{ steps: readonly TimelineStep[]; duration: number; label: string; marks?: readonly TimelineMark[] }>(), { marks: () => [] });
const emit = defineEmits<{ pick: [step: TimelineStep] }>();
const at = defineModel<number>({ default: 0 });

const track = ref<HTMLElement | null>(null);
const width = ref(0);
const hoverX = ref<number | null>(null);
const dragging = ref(false);

const lanes = computed(() => laneSteps(props.steps));
const ticks = computed(() => timeTicks(props.duration, width.value));
const fine = computed(() => props.duration < 60_000);
// Ticks less than a second apart need tenths, or neighbours read the same.
const fineTicks = computed(() => ticks.value.length > 1 && ticks.value[1]! - ticks.value[0]! < 1000);
const current = computed(() => stepAt(props.steps, at.value));
const pos = (t: number) => (props.duration > 0 ? Math.min(100, Math.max(0, (t / props.duration) * 100)) : 0);
const hoverAt = computed(() => (hoverX.value === null || !width.value ? null : (hoverX.value / width.value) * props.duration));
const hoverStep = computed(() => (hoverAt.value === null ? null : stepAt(props.steps, hoverAt.value)));
const valueText = computed(() => `${clock(at.value)} of ${clock(props.duration)}${current.value ? `, ${current.value.label}` : ""}`);

function tone(status: string | undefined) {
  switch (status) {
    case "passed":
      return "ok";
    case "failed":
      return "bad";
    case "broken":
      return "warn";
    case "running":
      return "accent";
    default:
      return "plain";
  }
}

let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!track.value) return;
  observer = new ResizeObserver(() => (width.value = track.value?.clientWidth ?? 0));
  observer.observe(track.value);
});
onBeforeUnmount(() => observer?.disconnect());

function seek(t: number) {
  at.value = Math.round(Math.min(props.duration, Math.max(0, t)));
}
function xOf(e: PointerEvent) {
  const r = track.value?.getBoundingClientRect();
  return r ? Math.min(r.width, Math.max(0, e.clientX - r.left)) : 0;
}
function down(e: PointerEvent) {
  if (e.button !== 0 || !width.value) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  dragging.value = true;
  const t = (xOf(e) / width.value) * props.duration;
  const step = stepAt(props.steps, t);
  seek(t);
  if (step) emit("pick", step);
  track.value?.querySelector<HTMLElement>(".knob")?.focus({ preventScroll: true });
}
function move(e: PointerEvent) {
  hoverX.value = xOf(e);
  if (dragging.value && width.value) seek((hoverX.value / width.value) * props.duration);
}
function up() {
  dragging.value = false;
}
function key(e: KeyboardEvent) {
  const step = e.shiftKey ? 10_000 : 1000;
  const to: Record<string, () => number | null> = {
    ArrowLeft: () => at.value - step,
    ArrowDown: () => at.value - step,
    ArrowRight: () => at.value + step,
    ArrowUp: () => at.value + step,
    PageUp: () => nextStart(props.steps, at.value, -1) ?? 0,
    PageDown: () => nextStart(props.steps, at.value, 1),
    Home: () => 0,
    End: () => props.duration,
  };
  const run = to[e.key];
  if (!run) return;
  e.preventDefault();
  const t = run();
  if (t !== null) seek(t);
}
</script>

<template>
  <div class="tl">
    <div class="top">
      <span class="time num">{{ clock(at, fine) }} <span class="of">/ {{ clock(duration, fine) }}</span></span>
      <span class="cur">{{ current?.label ?? "" }}</span>
    </div>
    <div ref="track" class="track" :class="{ dragging }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerleave="hoverX = null">
      <div v-if="marks.length" class="marks">
        <span v-for="(m, i) in marks" :key="i" class="mark" :class="m.tone ?? 'accent'" :style="{ left: `${pos(m.at)}%` }" :aria-label="`${m.label} at ${clock(m.at)}`" role="img" />
      </div>
      <div v-for="(lane, li) in lanes" :key="li" class="lane" aria-hidden="true">
        <span
          v-for="s in lane"
          :key="s.id"
          class="seg"
          :class="[tone(s.status), { on: current?.id === s.id }]"
          :style="{ left: `${pos(s.start)}%`, width: `${Math.max(0, pos(s.end) - pos(s.start))}%` }"
        >
          <span v-if="((pos(s.end) - pos(s.start)) / 100) * width >= 32" class="seg-text">{{ s.label }}</span>
        </span>
      </div>
      <div v-if="!steps.length" class="lane none" aria-hidden="true" />
      <div class="playhead" :style="{ left: `${pos(at)}%` }">
        <div
          class="knob"
          role="slider"
          tabindex="0"
          :aria-label="label"
          aria-valuemin="0"
          :aria-valuemax="duration"
          :aria-valuenow="at"
          :aria-valuetext="valueText"
          @keydown="key"
        />
      </div>
      <div v-if="hoverAt !== null && !dragging" class="hover" :style="{ left: `${pos(hoverAt)}%` }" aria-hidden="true">
        <span class="bubble" :class="{ start: pos(hoverAt) < 12, end: pos(hoverAt) > 88 }"><span class="num">{{ clock(hoverAt, fine) }}</span><template v-if="hoverStep"> · {{ hoverStep.label }}</template></span>
      </div>
    </div>
    <div class="axis" aria-hidden="true">
      <span v-for="t in ticks" :key="t" class="tick num" :class="{ end: pos(t) > 96 }" :style="{ left: `${pos(t)}%` }">{{ clock(t, fineTicks) }}</span>
    </div>
  </div>
</template>

<style scoped>
.tl {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
.top {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
}
.time {
  font-size: 14px;
  font-weight: 600;
}
.of {
  color: var(--muted);
  font-weight: 400;
}
.cur {
  overflow: hidden;
  color: var(--muted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track {
  position: relative;
  display: grid;
  gap: 4px;
  padding: 6px 0;
  border-top: var(--border-width) solid var(--line);
  border-bottom: var(--border-width) solid var(--line);
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.track.dragging {
  cursor: grabbing;
}
.marks {
  position: relative;
  height: 10px;
}
.mark {
  position: absolute;
  top: 1px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border-radius: 50%;
  background: var(--accent);
}
.mark.ok {
  background: var(--ok);
}
.mark.bad {
  background: var(--bad);
}
.mark.warn {
  background: var(--warn);
}
.lane {
  position: relative;
  height: 22px;
}
.seg {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 3px;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding: 0 6px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--raised);
  color: var(--text);
  font-size: 12px;
}
.seg.ok {
  border-color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, var(--surface));
}
.seg.bad {
  border-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 16%, var(--surface));
}
.seg.warn {
  border-color: var(--warn);
  background: color-mix(in srgb, var(--warn) 16%, var(--surface));
}
.seg.accent {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.seg.on {
  box-shadow: inset 0 0 0 1px currentColor;
}
.seg-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  pointer-events: none;
}
.playhead::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -1px;
  width: 2px;
  background: var(--accent);
}
.knob {
  position: absolute;
  top: -7px;
  left: -7px;
  width: 14px;
  height: 14px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  pointer-events: auto;
  cursor: grab;
}
.knob:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.hover {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  pointer-events: none;
}
.hover::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-left: 1px dashed var(--line-strong);
}
.bubble {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  transform: translateX(-50%);
  padding: 3px 7px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgb(0 0 0 / 14%);
}
.bubble.start {
  transform: translateX(-8px);
}
.bubble.end {
  transform: translateX(calc(-100% + 8px));
}
.axis {
  position: relative;
  height: 16px;
  overflow: hidden;
}
.tick {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  color: var(--muted);
  font-size: 11px;
}
.tick:first-child {
  transform: none;
}
/* A label at the far end ends at the edge instead of being cut off. */
.tick.end {
  transform: translateX(-100%);
}
</style>
