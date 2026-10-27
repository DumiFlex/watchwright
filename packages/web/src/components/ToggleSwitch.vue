<script setup lang="ts">
// An on/off switch for settings that take effect at once (a checkbox is for choices that
// are sent later, like the tests of a run). It is a button with role="switch".
defineProps<{ id?: string; disabled?: boolean }>();
const on = defineModel<boolean>({ default: false });
</script>

<template>
  <label class="sw" :class="{ disabled }">
    <button :id="id" type="button" role="switch" class="track" :aria-checked="on" :disabled="disabled" @click="on = !on">
      <span class="knob" />
    </button>
    <span v-if="$slots.default" class="text"><slot /></span>
  </label>
</template>

<style scoped>
.sw {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--space-2);
  cursor: pointer;
}
.sw.disabled {
  cursor: default;
  opacity: 0.5;
}
.track {
  flex: none;
  position: relative;
  width: 30px;
  height: 18px;
  margin-top: calc((1lh - 18px) / 2);
  padding: 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: 999px;
  background: var(--raised);
  cursor: inherit;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.knob {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--muted);
  transform: translateY(-50%);
  transition:
    left 0.15s,
    background 0.15s;
}
.track[aria-checked="true"] {
  background: var(--accent);
  border-color: var(--accent);
}
.track[aria-checked="true"] .knob {
  left: calc(100% - 14px);
  background: var(--on-accent);
}
.sw:hover:not(.disabled) .track {
  border-color: var(--accent);
}
</style>
