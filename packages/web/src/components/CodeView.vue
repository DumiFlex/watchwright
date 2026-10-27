<script setup lang="ts">
// Read-only code with line numbers and colors from the theme (src/highlight.ts knows
// TypeScript, JavaScript and JSON). `marked` lines get a band, for the line a test failed
// on; `start` numbers from another line than 1 for an excerpt. The copy button puts the
// whole text on the clipboard. The code scrolls on its own past `max-height`, and the
// scroll area is focusable so keyboard users can scroll it too.
import { computed, ref } from "vue";
import { highlight, type Lang } from "../highlight";
import { Check, Copy } from "../icons";
import { toast } from "../toasts";

const props = withDefaults(
  defineProps<{ code: string; lang?: Lang; label: string; name?: string | undefined; start?: number; marked?: readonly number[]; maxHeight?: string | undefined; wrap?: boolean }>(),
  { lang: "text", name: undefined, start: 1, marked: () => [], maxHeight: undefined },
);

const lines = computed(() => highlight(props.code.replace(/\n$/, ""), props.lang));
const mark = computed(() => new Set(props.marked));
const width = computed(() => `${String(props.start + lines.value.length - 1).length}ch`);
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code);
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    toast("Couldn't copy: the browser blocked the clipboard", { tone: "bad" });
  }
}
</script>

<template>
  <figure class="cv">
    <figcaption class="bar">
      <span class="name mono">{{ name ?? label }}</span>
      <button type="button" class="copy" :aria-label="copied ? 'Copied' : `Copy ${label}`" @click="copy">
        <Check v-if="copied" :size="14" />
        <Copy v-else :size="14" />
        <span>{{ copied ? "Copied" : "Copy" }}</span>
      </button>
    </figcaption>
    <div class="scroll" :class="{ wrap }" :style="maxHeight ? { maxHeight } : undefined" tabindex="0" role="region" :aria-label="label">
      <div class="code mono">
        <div v-for="(line, i) in lines" :key="i" class="line" :class="{ marked: mark.has(start + i) }">
          <span class="ln" :style="{ width }" aria-hidden="true">{{ start + i }}</span>
          <span class="src"><span v-for="(t, k) in line" :key="k" :class="`t-${t.kind}`">{{ t.text }}</span></span>
        </div>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.cv {
  min-width: 0;
  margin: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 6px 0 12px;
  border-bottom: var(--border-width) solid var(--line);
  background: var(--raised);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.copy:hover {
  background: var(--hover);
  color: var(--text);
}
.scroll {
  overflow: auto;
}
.scroll:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.code {
  min-width: max-content;
  padding: 8px 0;
  font-size: 12.5px;
  line-height: 1.6;
}
.wrap .code {
  min-width: 0;
}
.line {
  display: flex;
  padding-right: 12px;
}
.line.marked {
  background: color-mix(in srgb, var(--bad) 12%, transparent);
  box-shadow: inset 3px 0 0 var(--bad);
}
.ln {
  flex: none;
  box-sizing: content-box;
  padding: 0 12px 0 14px;
  color: var(--muted);
  text-align: right;
  user-select: none;
  opacity: 0.7;
}
.src {
  min-height: 1.6em;
  white-space: pre;
}
.wrap .src {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.t-keyword,
.t-key {
  color: var(--accent-text);
}
.t-string {
  color: var(--ok);
}
.t-number,
.t-literal {
  color: var(--warn);
}
.t-fn {
  color: var(--paused);
}
.t-comment {
  color: var(--muted);
  font-style: italic;
}
</style>
