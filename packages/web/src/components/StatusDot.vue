<script setup lang="ts">
defineProps<{ state: "ok" | "wait" | "bad"; label: string }>();
</script>

<template>
  <span class="dot-wrap">
    <span class="dot" :class="state" aria-hidden="true" />
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.dot-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--line-strong);
}
.dot.ok {
  background: var(--ok);
}
.dot.wait {
  background: var(--warn);
}
.dot.bad {
  background: var(--bad);
}
</style>
