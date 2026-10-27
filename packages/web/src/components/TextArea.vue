<script setup lang="ts">
// A themed multi-line input that grows with its text instead of showing the browser's
// resize grip. It stops growing at maxRows and scrolls with themed scrollbars after that.
import { nextTick, onMounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{ id?: string | undefined; placeholder?: string | undefined; rows?: number; maxRows?: number; invalid?: boolean; disabled?: boolean }>(), {
  id: undefined,
  placeholder: undefined,
  rows: 3,
  maxRows: 12,
});
const model = defineModel<string>({ default: "" });
const el = ref<HTMLTextAreaElement | null>(null);

function fit() {
  const t = el.value;
  if (!t) return;
  const css = getComputedStyle(t);
  const line = parseFloat(css.lineHeight) || 20;
  const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
  const border = t.offsetHeight - t.clientHeight;
  t.style.height = "auto";
  // border-box: scrollHeight already holds the padding, only the border is added
  const want = Math.max(t.scrollHeight, line * props.rows + padding);
  t.style.height = `${Math.min(want, line * props.maxRows + padding) + border}px`;
}
onMounted(fit);
watch(model, () => void nextTick(fit));
</script>

<template>
  <textarea
    :id="id"
    ref="el"
    v-model="model"
    class="ta"
    :class="{ invalid }"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid || undefined"
  />
</template>

<style scoped>
.ta {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  line-height: 1.45;
  resize: none;
  outline: none;
}
.ta:hover:not(:disabled) {
  border-color: var(--line-strong);
}
.ta:focus {
  border-color: var(--accent);
}
.ta.invalid {
  border-color: var(--bad);
}
.ta:disabled {
  opacity: 0.5;
}
.ta::placeholder {
  color: var(--muted);
  opacity: 1;
}
</style>
