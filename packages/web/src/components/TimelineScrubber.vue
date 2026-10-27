<script setup lang="ts">
// A run's steps on a time axis with a playhead to drag. Steps that overlap go on separate
// lanes and take the color of their status. Click or drag anywhere to move the playhead;
// hovering shows the time, the step and any flagged point under the pointer in the line above. The playhead is a
// role="slider": arrows move a second (Shift ten), Page Up/Down jump to the previous or next
// step, Home/End to the ends, + and - zoom. v-model is the playhead time in ms; `pick` fires
// with the step clicked on. `marks` are points to flag (a failure, a pause) above the steps;
// marks closer than a few pixels show as one with a count.
// Many short steps don't fit side by side, so the axis zooms (the buttons, Ctrl or Cmd with the
// wheel, + and -) and scrolls sideways, following the playhead while it moves. It opens zoomed
// in far enough for most steps to show their label.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ZoomIn, ZoomOut } from "../icons";
import { clock, clusterMarks, fitTimelineZoom, laneSteps, nextStart, stepAt, stepTimelineZoom, timeTicks, TIMELINE_ZOOMS, type TimelineStep } from "../timeline";
import { vTip } from "../tooltip";

export type TimelineMark = { at: number; label: string; tone?: "ok" | "bad" | "warn" | "accent" | undefined };

const props = withDefaults(defineProps<{ steps: readonly TimelineStep[]; duration: number; label: string; marks?: readonly TimelineMark[] }>(), { marks: () => [] });
const emit = defineEmits<{ pick: [step: TimelineStep] }>();
const at = defineModel<number>({ default: 0 });

const view = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const viewWidth = ref(0);
const zoom = ref(1);
const zoomed = ref(false); // set once the opening zoom is picked or the person zooms
const hoverX = ref<number | null>(null); // on the whole axis, in px
// Room at the sides of the scrolling part for the playhead's knob at either end.
const PAD = 8;
const dragging = ref(false);

const width = computed(() => viewWidth.value * zoom.value);
const lanes = computed(() => laneSteps(props.steps));
const ticks = computed(() => timeTicks(props.duration, width.value));
const fine = computed(() => props.duration < 60_000);
// Ticks less than a second apart need tenths, or neighbours read the same.
const fineTicks = computed(() => ticks.value.length > 1 && ticks.value[1]! - ticks.value[0]! < 1000);
const current = computed(() => stepAt(props.steps, at.value));
const shownAt = computed(() => Math.min(Math.max(0, at.value), props.duration));
const pos = (t: number) => (props.duration > 0 ? Math.min(100, Math.max(0, (t / props.duration) * 100)) : 0);
const px = (t: number) => (pos(t) / 100) * width.value;
const hoverAt = computed(() => (hoverX.value === null || !width.value ? null : (hoverX.value / width.value) * props.duration));
const hoverStep = computed(() => (hoverAt.value === null ? null : stepAt(props.steps, hoverAt.value)));
const valueText = computed(() => `${clock(shownAt.value)} of ${clock(props.duration)}${current.value ? `, ${current.value.label}` : ""}`);

const shown = computed(() => {
  if (hoverAt.value === null || dragging.value) return { time: null, step: current.value?.label ?? "" };
  return { time: clock(hoverAt.value, fine.value), step: hoverStep.value?.label ?? "" };
});

const segments = computed(() =>
  lanes.value.map((lane) =>
    lane.map((s) => {
      const w = px(s.end) - px(s.start);
      return { step: s, left: pos(s.start), width: Math.max(0, pos(s.end) - pos(s.start)), thin: w < 8, labelled: w >= 60 };
    }),
  ),
);

const RANK = { bad: 3, warn: 2, accent: 1, ok: 0 } as const;
const clusters = computed(() =>
  clusterMarks(props.marks, props.duration, width.value).map((c) => {
    const tone = c.marks.map((m) => m.tone ?? "accent").reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
    const first = c.marks[0]!;
    const label = c.marks.length > 1 ? `${c.marks.length} flagged points from ${clock(first.at)}, first: ${first.label}` : `${first.label} at ${clock(first.at)}`;
    return { at: c.at, count: c.marks.length, tone, label, first };
  }),
);
// The marks under the pointer, for the line above the track.
const hoverMarks = computed(() => (hoverX.value === null ? null : (clusters.value.find((c) => Math.abs(px(c.at) - hoverX.value!) <= 8) ?? null)));

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
  if (!view.value) return;
  observer = new ResizeObserver(() => {
    viewWidth.value = Math.max(0, (view.value?.clientWidth ?? 0) - 2 * PAD);
    openZoom();
  });
  observer.observe(view.value);
});
onBeforeUnmount(() => observer?.disconnect());

/** Opens zoomed in far enough for most steps to show their label, with the playhead in view. */
function openZoom() {
  if (zoomed.value || !viewWidth.value || !props.steps.length || !(props.duration > 0)) return;
  zoomed.value = true;
  const z = fitTimelineZoom(props.steps, props.duration, viewWidth.value);
  if (z !== zoom.value) setZoom(z, null);
}
watch(() => props.steps.length, openZoom);

/** Zooms to `z`, keeping the time under `anchor` (px from the left of the view) where it is; the playhead when null. */
function setZoom(z: number, anchor: number | null) {
  const v = view.value;
  const next = Math.min(TIMELINE_ZOOMS[TIMELINE_ZOOMS.length - 1]!, Math.max(1, z));
  if (!v || next === zoom.value) {
    zoom.value = next;
    return;
  }
  // x: the anchor in px from the view's left edge; the axis starts PAD in, less what is scrolled.
  const x = anchor ?? Math.min(Math.max(PAD, PAD + px(at.value) - v.scrollLeft), PAD + viewWidth.value);
  const t = width.value ? Math.min(Math.max(0, (v.scrollLeft + x - PAD) / width.value), 1) * props.duration : 0;
  zoom.value = next;
  zoomed.value = true;
  void nextTick(() => {
    if (view.value) view.value.scrollLeft = Math.max(0, PAD + px(t) - x);
  });
}
function zoomBy(dir: 1 | -1, anchor: number | null = null) {
  setZoom(stepTimelineZoom(zoom.value, dir), anchor);
}
function wheel(e: WheelEvent) {
  if (!(e.ctrlKey || e.metaKey) || !e.deltaY || !view.value) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - view.value.getBoundingClientRect().left);
}

// Keep the playhead in view while it moves (the video playing), unless it is being dragged.
watch(at, (t) => {
  const v = view.value;
  if (!v || dragging.value || zoom.value === 1) return;
  const x = px(t) - v.scrollLeft; // from the start of what is visible
  if (x < 0 || x > viewWidth.value - 16) v.scrollLeft = Math.max(0, px(t) - viewWidth.value * 0.1);
});

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
  if (e.key === "+" || e.key === "=" || e.key === "-") {
    e.preventDefault();
    zoomBy(e.key === "-" ? -1 : 1);
    return;
  }
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
      <span class="time num">{{ clock(shownAt, fine) }} <span class="of">/ {{ clock(duration, fine) }}</span></span>
      <!-- The step at the playhead, or what is under the pointer while hovering. -->
      <span class="cur" :class="{ hovering: shown.time !== null }">
        <span v-if="shown.time !== null" class="num">{{ shown.time }}</span>
        <span v-if="shown.step" class="cur-step">{{ shown.step }}</span>
        <span v-if="shown.time !== null && hoverMarks" class="cur-mark" :class="hoverMarks.tone">{{ hoverMarks.first.label }}<template v-if="hoverMarks.count > 1"> and {{ hoverMarks.count - 1 }} more</template></span>
      </span>
      <div v-if="duration > 0" class="zoom" role="group" aria-label="Timeline zoom">
        <button v-tip="'Zoom out (-)'" type="button" class="ib" aria-label="Zoom out" :disabled="zoom <= 1" @click="zoomBy(-1)"><ZoomOut :size="15" /></button>
        <span class="zoom-text num" aria-live="polite">{{ zoom }}×</span>
        <button v-tip="'Zoom in (+)'" type="button" class="ib" aria-label="Zoom in" :disabled="zoom >= TIMELINE_ZOOMS[TIMELINE_ZOOMS.length - 1]!" @click="zoomBy(1)"><ZoomIn :size="15" /></button>
      </div>
    </div>
    <div class="frame">
      <div ref="view" class="view" :class="{ zoomed: zoom > 1 }" @wheel="wheel">
        <div class="inner" :style="{ width: `${zoom * 100}%` }">
          <div ref="track" class="track" :class="{ dragging }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerleave="hoverX = null">
            <div v-if="clusters.length" class="marks">
              <span v-for="c in clusters" :key="c.at" class="mark" :class="[c.tone, { many: c.count > 1 }]" :style="{ left: `${pos(c.at)}%` }" :aria-label="c.label" role="img">
                <template v-if="c.count > 1">{{ c.count }}</template>
              </span>
            </div>
            <div v-for="(lane, li) in segments" :key="li" class="lane" aria-hidden="true">
              <span
                v-for="g in lane"
                :key="g.step.id"
                class="seg"
                :class="[tone(g.step.status), { on: current?.id === g.step.id, thin: g.thin }]"
                :style="{ left: `calc(${g.left}% + 1px)`, width: `max(2px, calc(${g.width}% - 2px))` }"
              >
                <span v-if="g.labelled" class="seg-text">{{ g.step.label }}</span>
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
                :aria-valuenow="shownAt"
                :aria-valuetext="valueText"
                @keydown="key"
              />
            </div>
            <div v-if="hoverAt !== null && !dragging" class="hover" :style="{ left: `${pos(hoverAt)}%` }" aria-hidden="true" />
          </div>
          <div class="axis" aria-hidden="true">
            <span v-for="t in ticks" :key="t" class="tick num" :class="{ end: pos(t) > 100 - (48 / (width || 1)) * 100 }" :style="{ left: `${pos(t)}%` }">{{ clock(t, fineTicks) }}</span>
          </div>
        </div>
      </div>
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
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}
.cur.hovering {
  color: var(--text);
}
.cur-step,
.cur-mark {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cur-step {
  flex: 0 1 auto;
}
.cur-mark {
  flex: 1 1 0;
}
.cur-mark.bad {
  color: var(--bad);
}
.cur-mark.warn {
  color: var(--warn);
}
.zoom {
  display: flex;
  align-items: center;
  flex: none;
  gap: 2px;
  align-self: center;
}
.zoom-text {
  min-width: 30px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.ib {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  cursor: pointer;
}
.ib:hover:not(:disabled) {
  background: var(--hover);
}
.ib:disabled {
  color: var(--muted);
  opacity: 0.5;
  cursor: default;
}
.ib:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.frame {
  position: relative;
  min-width: 0;
}
/* Room above the track for the playhead's knob, which the scrolling would cut off. */
.view {
  padding: 8px 8px 0;
  overflow: hidden;
}
.view.zoomed {
  overflow-x: auto;
  scrollbar-width: thin;
}
.inner {
  min-width: 100%;
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
  height: 14px;
}
.mark {
  position: absolute;
  top: 3px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border-radius: 50%;
  background: var(--accent);
}
/* Several marks too close to tell apart: one pill with their count. */
.mark.many {
  top: 0;
  width: auto;
  min-width: 14px;
  height: 14px;
  margin-left: -7px;
  padding: 0 4px;
  border-radius: 7px;
  color: var(--surface);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
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
/* Too narrow for a frame and a label: a plain bar in the status color. */
.seg.thin {
  padding: 0;
  border: 0;
  background: var(--line-strong);
}
.seg.thin.ok {
  background: var(--ok);
}
.seg.thin.bad {
  background: var(--bad);
}
.seg.thin.warn {
  background: var(--warn);
}
.seg.thin.accent {
  background: var(--accent);
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
