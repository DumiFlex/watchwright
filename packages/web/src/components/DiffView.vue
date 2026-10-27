<script setup lang="ts">
// Two versions of a text, line by line: removed lines in red, added ones in green, and in a
// line that was replaced, the part that changed stands out. Unchanged stretches fold away
// past `context` lines; a click shows them. v-model:mode switches between one column
// ("unified") and two ("split"); below 640px it is always one column.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { changedPart, diffLines, hunks, type DiffLine } from "../diff";
import { Columns2, Rows2, UnfoldVertical } from "../icons";

const props = withDefaults(defineProps<{ before: string; after: string; label: string; beforeLabel?: string; afterLabel?: string; context?: number }>(), {
  beforeLabel: "Before",
  afterLabel: "After",
  context: 3,
});
const mode = defineModel<"unified" | "split">("mode", { default: "unified" });

const root = ref<HTMLElement | null>(null);
const narrow = ref(false);
const unfolded = ref(new Set<number>());
const lines = computed(() => diffLines(props.before, props.after));
const parts = computed(() => hunks(lines.value, props.context));
const added = computed(() => lines.value.filter((l) => l.kind === "add").length);
const removed = computed(() => lines.value.filter((l) => l.kind === "del").length);
const split = computed(() => mode.value === "split" && !narrow.value);

// A run of removed lines followed by added ones is a replacement: line k of one side
// pairs with line k of the other, for split rows and the changed-part highlight.
type Side = { line: DiffLine; mark?: [string, string, string] | undefined } | null;
function pairUp(run: readonly DiffLine[]): [Side, Side][] {
  const rows: [Side, Side][] = [];
  let i = 0;
  while (i < run.length) {
    const l = run[i]!;
    if (l.kind === "same") {
      rows.push([{ line: l }, { line: l }]);
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < run.length && run[i]!.kind === "del") dels.push(run[i++]!);
    while (i < run.length && run[i]!.kind === "add") adds.push(run[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const d = dels[k];
      const a = adds[k];
      const cp = d && a ? changedPart(d.text, a.text) : null;
      rows.push([d ? { line: d, mark: cp?.a } : null, a ? { line: a, mark: cp?.b } : null]);
    }
  }
  return rows;
}
type Block = { kind: "rows"; rows: [Side, Side][] } | { kind: "fold"; from: number; skipped: number };
const blocks = computed<Block[]>(() =>
  parts.value.flatMap((h): Block[] => {
    if ("lines" in h) return [{ kind: "rows", rows: pairUp(h.lines) }];
    if (unfolded.value.has(h.from)) return [{ kind: "rows", rows: pairUp(lines.value.slice(h.from, h.from + h.skipped)) }];
    return [{ kind: "fold", from: h.from, skipped: h.skipped }];
  }),
);
// One column: each removed line, then each added one, in order.
function unifiedRows(rows: [Side, Side][]): Side[] {
  const out: Side[] = [];
  let dels: Side[] = [];
  let adds: Side[] = [];
  const flush = () => {
    out.push(...dels, ...adds);
    dels = [];
    adds = [];
  };
  for (const [a, b] of rows) {
    if (a && b && a.line.kind === "same") {
      flush();
      out.push(a);
      continue;
    }
    if (a) dels.push(a);
    if (b) adds.push(b);
  }
  flush();
  return out;
}

function unfold(from: number) {
  unfolded.value = new Set([...unfolded.value, from]);
}

let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!root.value) return;
  observer = new ResizeObserver(() => (narrow.value = (root.value?.clientWidth ?? 1000) < 640));
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
const sign = (l: DiffLine) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : "");
</script>

<template>
  <figure ref="root" class="dv">
    <figcaption class="bar">
      <span class="name">{{ label }}</span>
      <span class="stat num"><span class="plus">+{{ added }}</span> <span class="minus">-{{ removed }}</span></span>
      <span class="modes" role="group" aria-label="Layout">
        <button type="button" class="mode" :aria-pressed="!split" aria-label="One column" :disabled="narrow" @click="mode = 'unified'"><Rows2 :size="14" /></button>
        <button type="button" class="mode" :aria-pressed="split" aria-label="Side by side" :disabled="narrow" @click="mode = 'split'"><Columns2 :size="14" /></button>
      </span>
    </figcaption>
    <div class="scroll" tabindex="0" role="region" :aria-label="label">
      <div v-if="split" class="cols head mono" aria-hidden="true">
        <span>{{ beforeLabel }}</span><span>{{ afterLabel }}</span>
      </div>
      <div class="body mono" :class="{ split }">
        <template v-for="(b, bi) in blocks" :key="bi">
          <button v-if="b.kind === 'fold'" type="button" class="fold" @click="unfold(b.from)">
            <UnfoldVertical :size="14" />Show {{ b.skipped }} unchanged {{ b.skipped === 1 ? "line" : "lines" }}
          </button>
          <template v-else-if="split">
            <div v-for="([l, r], ri) in b.rows" :key="ri" class="cols">
              <div v-for="(s, si) in [l, r]" :key="si" class="line" :class="s ? s.line.kind : 'blank'">
                <template v-if="s">
                  <span class="ln" aria-hidden="true">{{ si === 0 ? s.line.a : s.line.b }}</span>
                  <span class="sign" aria-hidden="true">{{ sign(s.line) }}</span>
                  <span class="src"><template v-if="s.mark">{{ s.mark[0] }}<mark>{{ s.mark[1] }}</mark>{{ s.mark[2] }}</template><template v-else>{{ s.line.text }}</template></span>
                </template>
              </div>
            </div>
          </template>
          <template v-else>
            <div v-for="(s, ri) in unifiedRows(b.rows)" :key="ri" class="line" :class="s!.line.kind">
              <span class="ln" aria-hidden="true">{{ s!.line.a ?? "" }}</span>
              <span class="ln" aria-hidden="true">{{ s!.line.b ?? "" }}</span>
              <span class="sign">{{ sign(s!.line) }}<span class="sr-only">{{ s!.line.kind === "add" ? "added" : s!.line.kind === "del" ? "removed" : "" }}</span></span>
              <span class="src"><template v-if="s!.mark">{{ s!.mark[0] }}<mark>{{ s!.mark[1] }}</mark>{{ s!.mark[2] }}</template><template v-else>{{ s!.line.text }}</template></span>
            </div>
          </template>
        </template>
        <p v-if="!added && !removed" class="no-diff">No differences.</p>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.dv {
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
  gap: var(--space-3);
  min-height: 36px;
  padding: 0 6px 0 12px;
  border-bottom: var(--border-width) solid var(--line);
  background: var(--raised);
  font-size: 13px;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat {
  font-size: 12px;
}
.plus {
  color: var(--ok);
}
.minus {
  color: var(--bad);
}
.modes {
  display: inline-flex;
  gap: 2px;
}
.mode {
  display: grid;
  place-items: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.mode:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.mode[aria-pressed="true"] {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.mode:disabled {
  display: none;
}
.scroll {
  overflow: auto;
}
.scroll:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.body {
  min-width: max-content;
  padding: 4px 0;
  font-size: 12.5px;
  line-height: 1.6;
}
.body.split {
  min-width: 0;
}
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.cols > .line:first-child {
  border-right: var(--border-width) solid var(--line);
}
.head {
  padding: 4px 0;
  border-bottom: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: 11px;
}
.head span {
  padding: 0 12px;
}
.line {
  display: flex;
  min-width: 0;
}
.line.del {
  background: color-mix(in srgb, var(--bad) 10%, transparent);
}
.line.add {
  background: color-mix(in srgb, var(--ok) 10%, transparent);
}
.line.blank {
  background: repeating-linear-gradient(135deg, transparent 0 6px, var(--raised) 6px 7px);
}
.ln {
  flex: none;
  width: 4ch;
  padding: 0 8px;
  color: var(--muted);
  text-align: right;
  user-select: none;
  opacity: 0.7;
}
.sign {
  flex: none;
  width: 2ch;
  color: var(--muted);
  user-select: none;
}
.del .sign {
  color: var(--bad);
}
.add .sign {
  color: var(--ok);
}
.src {
  min-width: 0;
  padding-right: 12px;
  white-space: pre;
}
.split .src {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
mark {
  border-radius: 2px;
  color: inherit;
}
.del mark {
  background: color-mix(in srgb, var(--bad) 32%, transparent);
}
.add mark {
  background: color-mix(in srgb, var(--ok) 32%, transparent);
}
.fold {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 3px 12px;
  border: 0;
  border-top: var(--border-width) dashed var(--line);
  border-bottom: var(--border-width) dashed var(--line);
  background: var(--raised);
  color: var(--accent-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.fold:hover {
  background: var(--hover);
}
.no-diff {
  margin: 0;
  padding: 8px 12px;
  color: var(--muted);
}
</style>
