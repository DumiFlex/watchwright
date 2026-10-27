<script setup lang="ts">
// A keyboard shortcut drawn as keys: <KeyHint keys="Mod+K" />. "Mod" shows as Cmd on a Mac
// and Ctrl elsewhere; arrows and Enter show as icons. Screen readers hear the words.
import { computed, type Component } from "vue";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Command, CornerDownLeft } from "../icons";
import { isMac, keyParts } from "../keys";

const props = defineProps<{ keys: string }>();

const ICONS: Record<string, { icon: Component; word: string }> = {
  ArrowUp: { icon: ArrowUp, word: "Up" },
  ArrowDown: { icon: ArrowDown, word: "Down" },
  ArrowLeft: { icon: ArrowLeft, word: "Left" },
  ArrowRight: { icon: ArrowRight, word: "Right" },
  Enter: { icon: CornerDownLeft, word: "Enter" },
};
const NAMES: Record<string, string> = { Escape: "Esc", " ": "Space", Space: "Space", Backspace: "Backspace", Delete: "Del", PageUp: "PgUp", PageDown: "PgDn" };

const mac = isMac();
const parts = computed(() =>
  keyParts(props.keys).map((p) => {
    if (p === "Mod") return mac ? { icon: Command, text: "", word: "Command" } : { text: "Ctrl", word: "Control" };
    const ic = ICONS[p];
    if (ic) return { icon: ic.icon, text: "", word: ic.word };
    const text = NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p);
    return { text, word: text };
  }),
);
const spoken = computed(() => parts.value.map((p) => p.word).join(" "));
</script>

<template>
  <span class="key-hint" role="img" :aria-label="spoken">
    <kbd v-for="(p, i) in parts" :key="i" class="key mono" aria-hidden="true">
      <component :is="p.icon" v-if="p.icon" :size="12" />
      <template v-else>{{ p.text }}</template>
    </kbd>
  </span>
</template>

<style scoped>
.key-hint {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  vertical-align: middle;
}
.key {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: var(--border-width) solid var(--line-strong);
  border-bottom-width: calc(var(--border-width) + 1px);
  border-radius: var(--radius-sm);
  background: var(--raised);
  color: var(--muted);
  font-size: 11px;
  line-height: 1;
}
</style>
