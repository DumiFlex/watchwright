<script setup lang="ts">
// The Watchwright mark: a watch dial with one blued-steel hand and a ruby jewel at the
// pivot. It is the same in every theme; only its ink follows the theme's text color.
withDefaults(defineProps<{ size?: number }>(), { size: 28 });

const TICKS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6;
  const major = i % 3 === 0;
  const r1 = major ? 8.2 : 9.6;
  const r2 = 11.4;
  const at = (r: number) => ({ x: 16 + r * Math.sin(a), y: 16 - r * Math.cos(a) });
  const p1 = at(r1);
  const p2 = at(r2);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, width: major ? 1.6 : 1 };
});
</script>

<template>
  <svg class="mark" :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="14.5" fill="none" stroke="var(--text)" stroke-width="1.6" />
    <line
      v-for="(t, i) in TICKS"
      :key="i"
      :x1="t.x1"
      :y1="t.y1"
      :x2="t.x2"
      :y2="t.y2"
      stroke="var(--text)"
      :stroke-width="t.width"
      stroke-linecap="round"
    />
    <line x1="16" y1="16" x2="20.82" y2="10.25" stroke="var(--brand-hand)" stroke-width="2" stroke-linecap="round" />
    <circle cx="16" cy="16" r="2.6" fill="var(--brand-jewel)" />
  </svg>
</template>

<style scoped>
.mark {
  /* The hand and jewel keep Movement's colors in every look, so the mark never changes. */
  --brand-hand: light-dark(#2e46d1, #8296ff);
  --brand-jewel: light-dark(#c8174a, #ff4d7a);
  flex: none;
}
</style>
