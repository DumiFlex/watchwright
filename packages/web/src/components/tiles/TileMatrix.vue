<script setup lang="ts">
// Tests down the side, the latest runs across (oldest on the left), each cell an attempt's
// outcome: a status color with an icon, so it never rests on color alone. A cell opens the
// attempt. A split tile shows one grid per value of its param.
import { useTileLinks } from "../../tilelinks";
import { when } from "../../format";
import { runName, type TileData } from "../../dashboard";
import { vTip } from "../../tooltip";
import type { Component } from "vue";
import { Check, Ellipsis, Minus, Square, TriangleAlert, X } from "../../icons";

defineProps<{ data: TileData["matrix"] }>();
const links = useTileLinks();

const ICON: Record<string, Component> = { passed: Check, failed: X, broken: TriangleAlert, skipped: Minus, stopped: Square, running: Ellipsis, interrupted: TriangleAlert };
const tone = (s: string) => (s === "passed" ? "ok" : s === "failed" ? "bad" : s === "broken" || s === "interrupted" ? "warn" : s === "running" ? "accent" : "muted");
</script>

<template>
  <div class="tile-matrix">
    <p v-if="!data.grids.some((g) => g.tests.length)" class="muted small">No run in range has attempts yet.</p>
    <div v-for="g in data.grids" :key="g.group ?? ''" class="grid-wrap">
      <h4 v-if="g.group !== null" class="ghead small">{{ g.group }}</h4>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" class="sr-only">Test</th>
              <th v-for="r in g.runs" :key="r.id" scope="col" class="rcol">
                <component :is="links.run(r.id) ? 'a' : 'span'" v-tip="`${runName(r)} · ${when(r.at)}`" :href="links.run(r.id) ?? undefined" class="rlink" :tabindex="links.run(r.id) ? undefined : 0"><span class="sr-only">{{ runName(r) }}</span></component>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in g.tests" :key="t.testId">
              <th scope="row" class="tname"><span class="mono small">{{ t.testId }}</span> <span class="small">{{ t.title !== t.testId ? t.title : "" }}</span></th>
              <td v-for="(c, i) in t.cells" :key="i">
                <component
                  :is="links.attempt(g.runs[i]?.id ?? '', c.attemptId) ? 'a' : 'span'"
                  v-if="c"
                  v-tip="`${t.testId} · ${c.status}${c.attempts > 1 ? ` (worst of ${c.attempts})` : ''}${c.flags ? ` · ${c.flags} ${c.flags === 1 ? 'flag' : 'flags'}` : ''} · ${runName(g.runs[i] ?? {})}`"
                  class="cell"
                  :class="`t-${tone(c.status)}`"
                  :href="links.attempt(g.runs[i]?.id ?? '', c.attemptId) ?? undefined"
                  :tabindex="links.attempt(g.runs[i]?.id ?? '', c.attemptId) ? undefined : 0"
                  :aria-label="`${t.testId} in ${runName(g.runs[i] ?? {})}: ${c.status}`"
                >
                  <component :is="ICON[c.status] ?? Minus" :size="12" /><span v-if="c.flags" class="flag" aria-hidden="true" />
                </component>
                <span v-else class="cell empty" aria-label="didn't run" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Split grids sit side by side when the tile is wide enough. */
.tile-matrix {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-8);
  min-width: 0;
}
.grid-wrap {
  min-width: 0;
  max-width: 100%;
}
.ghead {
  margin: 0 0 var(--space-1);
  font-weight: 600;
}
.scroll {
  overflow-x: auto;
}
table {
  border-collapse: separate;
  border-spacing: 2px;
}
.tname {
  max-width: 22ch;
  padding-right: var(--space-2);
  overflow: hidden;
  font-weight: 400;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rcol {
  padding: 0;
}
.rlink {
  display: block;
  width: 20px;
  height: 6px;
  border-radius: 2px;
  background: var(--raised);
}
.rlink:hover {
  background: var(--line-strong);
}
td {
  padding: 0;
}
.cell {
  position: relative;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
  color: var(--on-accent);
}
.cell.empty {
  background: transparent;
  border: var(--border-width) dashed var(--line);
}
.t-ok {
  background: var(--ok);
}
.t-bad {
  background: var(--bad);
}
.t-warn {
  background: var(--warn);
}
.t-accent {
  background: var(--accent);
}
.t-muted {
  background: var(--raised);
  color: var(--muted);
}
.flag {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--surface);
  border-radius: 50%;
  background: var(--text);
}
p {
  margin: 0;
}
</style>
