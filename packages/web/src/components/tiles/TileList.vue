<script setup lang="ts">
// Attempts and tests to look at: the latest failures with their message, the lowest scores (or
// highest metric), the tests that flip, and how many attempts still wait for a score. Each line
// opens the attempt.
import { href } from "../../router";
import { ago, when } from "../../format";
import { formatValue, runName, type TileData } from "../../dashboard";
import { CircleCheck, ListChecks } from "../../icons";
import { vTip } from "../../tooltip";
import StatusChip from "../StatusChip.vue";
import HistoryStrip from "../HistoryStrip.vue";

defineProps<
  | { kind: "failures"; data: TileData["failures"] }
  | { kind: "lowest"; data: TileData["lowest"] }
  | { kind: "flaky"; data: TileData["flaky"] }
  | { kind: "unreviewed"; data: TileData["unreviewed"] }
>();

const attemptHref = (a: { runId: string; attemptId: string }) => href({ name: "attempt", runId: a.runId, attemptId: a.attemptId });
</script>

<template>
  <div class="tile-list">
    <template v-if="kind === 'failures'">
      <p v-if="!data.items.length" class="none small"><CircleCheck :size="15" /> Nothing failed or was flagged in range.</p>
      <ul v-else>
        <li v-for="a in data.items" :key="a.attemptId">
          <a class="line" :href="attemptHref(a)">
            <StatusChip :status="a.status" />
            <span class="mono small">{{ a.testId }}</span>
            <span class="ttl small">{{ a.title !== a.testId ? a.title : "" }}</span>
            <span v-tip="when(a.at)" class="muted small when">{{ runName(a) }} · {{ ago(a.at) }}</span>
          </a>
          <p v-if="a.message" class="msg small">{{ a.message }}</p>
          <p v-for="f in a.flags" :key="f.name" class="msg small"><span class="flag" :class="`k-${f.kind}`">{{ f.name }}</span> {{ f.detail ?? "" }}</p>
        </li>
      </ul>
    </template>

    <template v-else-if="kind === 'lowest'">
      <p v-if="!data.items.length" class="none small">No attempt in range has {{ data.highest ? "this metric" : "a score on this" }} yet.</p>
      <ol v-else>
        <li v-for="a in data.items" :key="a.attemptId">
          <a class="line" :href="attemptHref(a)">
            <span class="val num">{{ formatValue(a.value, data.highest ? `metric.${data.by}` : "score") }}</span>
            <span class="mono small">{{ a.testId }}</span>
            <span class="ttl small">{{ a.title !== a.testId ? a.title : "" }}</span>
            <span v-tip="when(a.at)" class="muted small when">{{ runName(a) }}</span>
          </a>
        </li>
      </ol>
    </template>

    <template v-else-if="kind === 'flaky'">
      <p v-if="!data.tests.length" class="none small"><CircleCheck :size="15" /> No test flipped between passing and failing in range.</p>
      <ul v-else>
        <li v-for="t in data.tests" :key="t.testId" class="line">
          <span class="mono small">{{ t.testId }}</span>
          <span class="ttl small">{{ t.title !== t.testId ? t.title : "" }}</span>
          <span class="muted small num">{{ t.flips }} {{ t.flips === 1 ? "flip" : "flips" }}</span>
          <HistoryStrip class="strip" :entries="t.history" :label="`${t.testId}, latest outcomes`" />
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="unrev">
        <ListChecks :size="20" class="muted" />
        <p class="big num">{{ data.waiting }}<span class="muted of">of {{ data.total }}</span></p>
        <p class="muted small">{{ data.waiting === 0 ? (data.total ? "Every attempt in range has a score." : "No attempts in range yet.") : "attempts wait for a score" }}</p>
        <a v-if="data.first" class="btn small" :href="attemptHref(data.first)">Score the first one</a>
      </div>
    </template>
  </div>
</template>

<style scoped>
ul,
ol {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  min-width: 0;
}
.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--space-2);
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
a.line:hover .ttl,
a.line:hover .mono {
  text-decoration: underline;
}
.ttl {
  flex: 1 1 8ch;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  margin-left: auto;
}
.msg {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.flag {
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: var(--raised);
  color: var(--text);
}
.flag.k-finding {
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  color: var(--bad);
}
.flag.k-robot {
  background: color-mix(in srgb, var(--warn) 14%, transparent);
  color: var(--warn);
}
.strip {
  flex-basis: 100%;
  justify-content: flex-start;
}
.val {
  min-width: 5ch;
  font-weight: 600;
}
.none {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--muted);
}
.unrev {
  display: grid;
  justify-items: start;
  gap: var(--space-1);
}
.unrev p {
  margin: 0;
}
.big {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
}
.of {
  margin-left: 6px;
  font-size: 14px;
  font-weight: 500;
}
.unrev .btn {
  margin-top: var(--space-2);
  text-decoration: none;
}
</style>
