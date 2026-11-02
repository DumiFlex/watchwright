<script setup lang="ts">
// A test's last attempts as a row of ticks, newest on the right, one color per status. Each
// tick links to its attempt and names it in a tooltip. Rows of strips line up on the right, so
// the same column is the same "how many runs ago" for every test.
import { computed } from "vue";
import type { HistoryEntry } from "../api";
import { entryText } from "../history";
import { duration, when } from "../format";
import { useTileLinks } from "../tilelinks";
import { vTip } from "../tooltip";

const props = defineProps<{ entries: readonly HistoryEntry[]; label: string }>();
// In the app each tick opens its attempt; a public page may have no page to open.
const links = useTileLinks();

const ticks = computed(() =>
  props.entries.map((e) => ({
    key: e.attemptId,
    tone: e.status === "passed" ? "ok" : e.status === "failed" ? "bad" : e.status === "broken" ? "warn" : "rest",
    retried: e.try > 1,
    text: entryText(e, duration, when),
    to: links.attempt(e.runId, e.attemptId) ?? undefined,
  })),
);
</script>

<template>
  <ul class="history-strip" :aria-label="label">
    <li v-for="t in ticks" :key="t.key">
      <component :is="t.to ? 'a' : 'span'" v-tip="t.text" class="tick" :class="[t.tone, { retried: t.retried }]" :href="t.to" :aria-label="t.text" :tabindex="t.to ? undefined : 0" />
    </li>
  </ul>
</template>

<style scoped>
.history-strip {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.history-strip li {
  display: flex;
}
.tick {
  display: block;
  width: 6px;
  height: 18px;
  border-radius: 2px;
  background: var(--line);
}
.tick.ok {
  background: var(--ok);
}
.tick.bad {
  background: var(--bad);
}
.tick.warn {
  background: var(--warn);
}
/* Passed on a later try: the tick keeps its color with a notch, so the retry shows. */
.tick.retried {
  background-image: linear-gradient(var(--surface), var(--surface));
  background-size: 100% 3px;
  background-position: 0 50%;
  background-repeat: no-repeat;
}
.tick:hover,
.tick:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
