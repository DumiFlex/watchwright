<script setup lang="ts">
// A log as a terminal-like list: search (Enter and Shift+Enter, or the arrows, go from match to
// match), level toggles with their counts, Follow (stay at the newest line as lines come in; it
// stops when you scroll up and starts again at the bottom) and Wrap. Long lines scroll sideways
// unless wrapped, and then only the lines on screen are drawn, so a log of many thousands of
// lines stays quick. With `line-href`, a line's number links to it and a click copies the link.
// `focus-line` scrolls to a line and marks it. The `filters` slot takes more filters (a test).
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from "vue";
import { ArrowDownToLine, ChevronDown, ChevronUp, WrapText } from "../icons";
import { findLines, LEVELS, levelCounts, shownLines, splitHits, stepMatch, type LogLevel, type LogLine } from "../logview";
import { rowWindow } from "../table";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import TextField from "./TextField.vue";

const props = withDefaults(
  defineProps<{
    lines: readonly LogLine[];
    label: string;
    /** Lines are still coming in: Follow starts on. */
    live?: boolean;
    /** The most the list grows to before it scrolls. */
    height?: string;
    lineHref?: ((n: number) => string) | undefined;
    focusLine?: number | null | undefined;
    /** Text shown when there are no lines at all. */
    emptyText?: string;
  }>(),
  { live: false, height: "420px", lineHref: undefined, focusLine: null, emptyText: "Nothing was logged." },
);

const id = useId();
const ROW = 24; // px, matches .row's height when lines don't wrap

const levels = reactive(new Set<LogLevel>(LEVELS));
function toggleLevel(l: LogLevel) {
  if (levels.has(l)) levels.delete(l);
  else levels.add(l);
}
const counts = computed(() => levelCounts(props.lines));
const shown = computed(() => shownLines(props.lines, levels));
const hasTests = computed(() => props.lines.some((l) => l.test));

const query = ref("");
const matches = computed(() => findLines(shown.value, query.value));
const matchSet = computed(() => new Set(matches.value));
const current = ref(-1);
const currentLine = computed(() => (current.value >= 0 ? matches.value[current.value] : undefined));

const wrap = ref(false);
const follow = ref(props.live);
const target = ref<number | null>(null);

// Scrolling and the window of lines drawn.
const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewHeight = ref(400);
const win = computed(() =>
  wrap.value ? { start: 0, end: shown.value.length, padTop: 0, padBottom: 0 } : rowWindow(scrollTop.value, viewHeight.value, ROW, shown.value.length),
);
const drawn = computed(() => shown.value.slice(win.value.start, win.value.end));

let ours = false; // the next scroll event is one we caused
function scrollTo(top: number) {
  const el = scroller.value;
  if (!el) return;
  ours = true;
  el.scrollTop = top;
  scrollTop.value = el.scrollTop;
}
function toEnd() {
  const el = scroller.value;
  if (el) scrollTo(el.scrollHeight);
}
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  if (ours) {
    ours = false;
    return;
  }
  const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < ROW;
  if (!atEnd) follow.value = false;
  else if (props.live) follow.value = true;
}
/** Brings the shown line at index `i` to the middle. */
async function reveal(i: number) {
  follow.value = false;
  if (!wrap.value) return scrollTo(i * ROW - viewHeight.value / 2 + ROW / 2);
  await nextTick();
  const row = scroller.value?.querySelector<HTMLElement>(`[data-i="${i}"]`);
  const el = scroller.value;
  if (row && el) scrollTo(row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2);
}

function go(dir: 1 | -1) {
  current.value = stepMatch(matches.value.length, current.value, dir);
  if (currentLine.value !== undefined) void reveal(currentLine.value);
}
function onSearchKey(e: KeyboardEvent) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  go(e.shiftKey ? -1 : 1);
}
// Typing goes to the first match, as a browser's find does.
watch(query, () => {
  current.value = -1;
  if (matches.value.length) go(1);
});
// Filters can drop the line a search was on.
watch(shown, () => {
  if (current.value >= matches.value.length) current.value = matches.value.length - 1;
});

function setFollow(on: boolean) {
  follow.value = on;
  if (on) void nextTick(toEnd);
}
// A log that goes live (a run starts again) follows from then on.
watch(
  () => props.live,
  (live) => live && setFollow(true),
);
watch(
  () => props.lines.length,
  () => {
    if (follow.value) void nextTick(toEnd);
  },
);
watch(wrap, () => void nextTick(() => (follow.value ? toEnd() : currentLine.value !== undefined && reveal(currentLine.value))));

function focusOn(n: number | null | undefined) {
  if (!n) return;
  const i = shown.value.findIndex((l) => l.n === n);
  if (i === -1) return;
  target.value = n;
  void nextTick(() => reveal(i));
}
watch(
  () => [props.focusLine, props.lines.length > 0] as const,
  ([n]) => focusOn(n),
);

let observer: ResizeObserver | undefined;
onMounted(() => {
  const el = scroller.value;
  if (!el) return;
  viewHeight.value = el.clientHeight;
  observer = new ResizeObserver(() => (viewHeight.value = el.clientHeight));
  observer.observe(el);
  if (props.focusLine) focusOn(props.focusLine);
  else if (follow.value) toEnd();
});
onBeforeUnmount(() => observer?.disconnect());

async function copyLink(n: number) {
  if (!props.lineHref) return;
  target.value = n;
  try {
    await navigator.clipboard.writeText(new URL(props.lineHref(n), location.href).href);
    toast(`Link to line ${n} copied`, { tone: "ok", timeout: 2000 });
  } catch {
    toast("The browser didn't allow copying.", { tone: "warn" });
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function clockTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
const fmt = (n: number) => n.toLocaleString();
const countText = computed(() => {
  if (!query.value.trim()) return "";
  if (!matches.value.length) return "No matches";
  return `${current.value >= 0 ? fmt(current.value + 1) : "–"} of ${fmt(matches.value.length)}`;
});
const footText = computed(() => {
  const all = props.lines.length;
  const s = shown.value.length;
  const lines = `${fmt(all)} ${all === 1 ? "line" : "lines"}`;
  const parts = [s === all ? lines : `${fmt(s)} of ${lines} shown`];
  if (!wrap.value && s > win.value.end - win.value.start) parts.push("only the ones on screen are drawn");
  if (props.lineHref && all) parts.push("click a line number to copy a link to it");
  return parts.join(" · ");
});
</script>

<template>
  <div class="log-viewer">
    <div class="tools">
      <div class="find" @keydown="onSearchKey">
        <label class="sr-only" :for="`${id}-find`">Search the log</label>
        <TextField :id="`${id}-find`" v-model="query" class="q" type="search" placeholder="Search the log" />
        <span v-if="countText" class="count num muted" aria-live="polite">{{ countText }}</span>
        <button v-tip="'Previous match (Shift+Enter)'" type="button" class="tb" aria-label="Previous match" :disabled="!matches.length" @click="go(-1)"><ChevronUp :size="15" /></button>
        <button v-tip="'Next match (Enter)'" type="button" class="tb" aria-label="Next match" :disabled="!matches.length" @click="go(1)"><ChevronDown :size="15" /></button>
      </div>
      <div class="levels" role="group" aria-label="Levels to show">
        <button v-for="l in LEVELS" :key="l" type="button" class="lv" :class="l" :aria-pressed="levels.has(l)" @click="toggleLevel(l)">
          {{ l }} <span class="num">{{ fmt(counts[l]) }}</span>
        </button>
      </div>
      <slot name="filters" />
      <div class="modes">
        <button v-tip="'Wrap long lines'" type="button" class="tb" aria-label="Wrap long lines" :aria-pressed="wrap" @click="wrap = !wrap"><WrapText :size="15" /></button>
        <button type="button" class="tb follow" :aria-pressed="follow" @click="setFollow(!follow)"><ArrowDownToLine :size="15" /> Follow</button>
      </div>
    </div>

    <div
      ref="scroller"
      class="lines"
      :class="{ wrap }"
      :style="{ maxHeight: height }"
      tabindex="0"
      role="region"
      :aria-label="label"
      @scroll.passive="onScroll"
    >
      <p v-if="!lines.length" class="none muted">{{ emptyText }}</p>
      <p v-else-if="!shown.length" class="none muted">No lines at these levels.</p>
      <div v-else class="body" :style="{ paddingTop: `${win.padTop}px`, paddingBottom: `${win.padBottom}px` }">
        <div
          v-for="(l, j) in drawn"
          :key="l.key"
          class="row"
          :class="[l.level, { hit: matchSet.has(win.start + j), current: currentLine === win.start + j, target: target === l.n }]"
          :data-i="win.start + j"
        >
          <a v-if="lineHref" v-tip="'Copy a link to this line'" class="n num" :href="lineHref(l.n)" @click.prevent="copyLink(l.n)">{{ l.n }}</a>
          <span v-else class="n num">{{ l.n }}</span>
          <time class="t num" :datetime="l.time">{{ clockTime(l.time) }}</time>
          <span class="lvl">{{ l.level }}</span>
          <span v-if="hasTests" class="test">{{ l.test ?? "" }}</span>
          <span class="msg"><template v-for="(p, k) in splitHits(l.message, query)" :key="k"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
        </div>
      </div>
    </div>
    <p v-if="lines.length" class="foot muted small">{{ footText }}</p>
  </div>
</template>

<style scoped>
.log-viewer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
.find {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 1 1 260px;
  min-width: 0;
}
.find .q {
  flex: 1;
  min-width: 0;
}
.count {
  min-width: 9ch;
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
}
.tb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  min-width: 30px;
  justify-content: center;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.tb:disabled {
  color: var(--muted);
  cursor: default;
}
.tb[aria-pressed="true"],
.lv[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.levels,
.modes {
  display: flex;
  gap: var(--space-1);
}
.lv {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.lv[aria-pressed="false"] {
  opacity: 0.6;
  text-decoration: line-through;
}
.lv.info {
  color: var(--text);
}
.lv.warn {
  color: var(--warn);
}
.lv.error {
  color: var(--bad);
}
.lv .num {
  color: var(--muted);
}
.lines {
  overflow: auto;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--raised);
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.lines:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.none {
  margin: 0;
  padding: var(--space-3);
  font-family: var(--font-ui);
}
.body {
  min-width: max-content;
}
.wrap .body {
  min-width: 0;
}
.row {
  display: flex;
  gap: var(--space-3);
  height: 24px;
  align-items: center;
  padding: 0 var(--space-3) 0 var(--space-1);
  white-space: pre;
}
.wrap .row {
  height: auto;
  min-height: 24px;
  align-items: baseline;
  padding-block: 3px;
  white-space: normal;
}
.wrap .msg {
  flex: 1;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}
.n {
  flex: none;
  width: 6ch;
  text-align: right;
  color: var(--muted);
  text-decoration: none;
}
a.n:hover {
  color: var(--accent);
  text-decoration: underline;
}
.t {
  flex: none;
  color: var(--muted);
}
.lvl {
  flex: none;
  width: 5ch;
  color: var(--muted);
}
.test {
  flex: none;
  width: 8ch;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}
.msg {
  color: var(--text);
}
.row.warn .lvl {
  color: var(--warn);
  font-weight: 600;
}
.row.error .lvl {
  color: var(--bad);
  font-weight: 600;
}
.row.error {
  background: color-mix(in srgb, var(--bad) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--bad);
}
.row.warn {
  background: color-mix(in srgb, var(--warn) 7%, transparent);
}
.row.current,
.row.target {
  box-shadow: inset 3px 0 0 var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
mark {
  border-radius: 2px;
  background: color-mix(in srgb, var(--warn) 35%, transparent);
  color: inherit;
}
.row.current mark {
  background: color-mix(in srgb, var(--accent) 45%, transparent);
}
.foot {
  margin: 0;
}
@media (max-width: 600px) {
  .t {
    display: none;
  }
}
</style>
