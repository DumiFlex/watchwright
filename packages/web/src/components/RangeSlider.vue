<script setup lang="ts">
// A themed replacement for <input type="range">: role="slider" with pointer dragging and
// the usual keys (arrows, Page Up/Down for ten steps, Home/End).
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{ min?: number; max?: number; step?: number; label: string; id?: string | undefined; disabled?: boolean; format?: ((v: number) => string) | undefined; showValue?: boolean }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    id: undefined,
    format: undefined,
    showValue: true,
  },
);
const model = defineModel<number>({ required: true });
const track = ref<HTMLElement | null>(null);

const shown = computed(() => (props.format ? props.format(model.value) : String(model.value)));
const pct = computed(() => (props.max === props.min ? 0 : ((model.value - props.min) / (props.max - props.min)) * 100));

function set(v: number) {
  const snapped = Math.round((v - props.min) / props.step) * props.step + props.min;
  model.value = Number(Math.min(props.max, Math.max(props.min, snapped)).toFixed(6));
}
function fromPointer(e: PointerEvent) {
  const r = track.value?.getBoundingClientRect();
  if (!r || r.width === 0) return;
  set(props.min + ((e.clientX - r.left) / r.width) * (props.max - props.min));
}
function down(e: PointerEvent) {
  if (props.disabled || e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  fromPointer(e);
}
function move(e: PointerEvent) {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromPointer(e);
}
function key(e: KeyboardEvent) {
  const big = props.step * 10;
  const to: Record<string, number> = {
    ArrowRight: model.value + props.step,
    ArrowUp: model.value + props.step,
    ArrowLeft: model.value - props.step,
    ArrowDown: model.value - props.step,
    PageUp: model.value + big,
    PageDown: model.value - big,
    Home: props.min,
    End: props.max,
  };
  const v = to[e.key];
  if (v === undefined) return;
  e.preventDefault();
  set(v);
}
</script>

<template>
  <div class="rs" :class="{ disabled }">
    <div ref="track" class="hit" @pointerdown="down" @pointermove="move">
      <div class="rail"><div class="fill" :style="{ width: `${pct}%` }" /></div>
      <div
        :id="id"
        class="thumb"
        role="slider"
        :tabindex="disabled ? -1 : 0"
        :aria-label="label"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="modelValue"
        :aria-valuetext="shown"
        :aria-disabled="disabled || undefined"
        :style="{ left: `${pct}%` }"
        @keydown="key"
      />
    </div>
    <span v-if="showValue" class="value num">{{ shown }}</span>
  </div>
</template>

<style scoped>
.rs {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}
.rs.disabled {
  opacity: 0.5;
}
.hit {
  position: relative;
  flex: 1;
  height: 24px;
  cursor: pointer;
  touch-action: none;
}
.disabled .hit {
  cursor: default;
}
.rail {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--raised);
  box-shadow: inset 0 0 0 var(--border-width) var(--line);
  transform: translateY(-50%);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
}
.thumb {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 16px;
  border: calc(var(--border-width) + 1px) solid var(--accent);
  border-radius: 50%;
  background: var(--surface);
  transform: translate(-50%, -50%);
}
.hit:hover .thumb,
.thumb:focus-visible {
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.thumb:focus-visible {
  outline: none;
}
.value {
  min-width: 3ch;
  color: var(--muted);
  text-align: right;
}
</style>
