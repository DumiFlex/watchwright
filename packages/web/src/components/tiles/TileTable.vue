<script setup lang="ts">
// Setups or parts of a pack side by side: a leaderboard (one row per value of a param, columns of
// measures, the best of each column marked with a star and in words for screen readers) or a
// breakdown (one row per section, tag or test, one column per param value), each number with a
// thin bar of its share of the column.
import { computed } from "vue";
import { formatValue, share, type TileData } from "../../dashboard";
import { Star } from "../../icons";
import { vTip } from "../../tooltip";

const props = defineProps<{ kind: "leaderboard"; data: TileData["leaderboard"] } | { kind: "breakdown"; data: TileData["breakdown"] }>();

interface Col {
  key: string;
  label: string;
  measure: string;
  unit: string | null;
}
interface Row {
  key: string;
  title: string;
  sub: string | null;
  cells: (number | null)[];
  best: boolean[];
}

const table = computed<{ head: string; cols: Col[]; rows: Row[] }>(() => {
  if (props.kind === "leaderboard") {
    const d = props.data;
    return {
      head: d.by,
      cols: d.columns.map((c) => ({ key: c.key, label: c.label, measure: c.key, unit: c.unit })),
      rows: d.rows.map((r) => ({
        key: r.value,
        title: r.value,
        sub: `${r.runs} ${r.runs === 1 ? "run" : "runs"}`,
        cells: d.columns.map((c) => r.cells[c.key] ?? null),
        best: d.columns.map((c) => d.best[c.key] === r.value),
      })),
    };
  }
  const d = props.data;
  return {
    head: d.by,
    cols: d.groups.map((g, i) => ({ key: g ?? `all-${i}`, label: g ?? d.label, measure: d.measure, unit: d.unit })),
    rows: d.rows.map((r) => ({ key: r.key, title: r.title, sub: null, cells: r.cells, best: r.cells.map(() => false) })),
  };
});
const columnValues = (i: number) => table.value.rows.map((r) => r.cells[i] ?? null);
</script>

<template>
  <div class="tile-table">
    <p v-if="!table.rows.length" class="muted small">No run in range has values for this yet.</p>
    <table v-else>
      <thead>
        <tr>
          <th scope="col">{{ table.head }}</th>
          <th v-for="c in table.cols" :key="c.key" scope="col" class="n">{{ c.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in table.rows" :key="r.key">
          <th scope="row">
            <span class="rtitle">{{ r.title }}</span>
            <span v-if="r.sub" class="muted small">{{ r.sub }}</span>
          </th>
          <td v-for="(c, i) in table.cols" :key="c.key" class="n" :class="{ best: r.best[i] }">
            <span class="cell">
              <Star v-if="r.best[i]" v-tip="'Best in this column'" :size="12" class="star" />
              <span class="num">{{ formatValue(r.cells[i], c.measure, c.unit) }}</span>
              <span v-if="r.best[i]" class="sr-only">, best</span>
            </span>
            <span v-if="r.cells[i] !== null" class="bar" aria-hidden="true"><span :style="{ width: `${Math.round(share(r.cells[i] ?? null, columnValues(i)) * 100)}%` }" /></span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tile-table {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  padding: 6px var(--space-3) 6px 0;
  text-align: left;
  vertical-align: top;
}
td:last-child,
th:last-child {
  padding-right: 0;
}
thead th {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
tbody tr {
  border-top: var(--border-width) solid var(--line);
}
tbody th {
  font-weight: 500;
}
.rtitle {
  display: block;
}
.n {
  text-align: right;
  white-space: nowrap;
}
.cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.best .num {
  font-weight: 600;
}
.star {
  color: var(--accent-text);
}
.bar {
  display: block;
  height: 3px;
  margin-top: 4px;
  border-radius: 2px;
  background: var(--raised);
}
.bar > span {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: 2px;
  background: var(--accent);
}
p {
  margin: 0;
}
</style>
