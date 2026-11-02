<script setup lang="ts">
// Getting around a long page. With room in the right margin, the view's outline sits there,
// like the docs site's "On this page", with Back to top and To the bottom under it. Without,
// a small group at the bottom right holds the outline (in a popup) and the two jumps. Pages
// with no outline still get the jumps once they are long. See src/outline.ts.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowDownToLine, ArrowUpToLine, TableOfContents } from "../icons";
import { jumps, LAND_AT, markAmong, outline, outlineTops, railPlace } from "../outline";
import { focusStill, openModals, useOutside, usePopup } from "../popup";
import { sectionAt } from "../toc";
import { vTip } from "../tooltip";

const props = defineProps<{ off?: boolean }>();

const vw = ref(0);
const vh = ref(0);
const top = ref(0);
const height = ref(0);
const pageRight = ref(0);
const current = ref(0);

const items = computed(() => outline.value?.items ?? []);
const hasOutline = computed(() => items.value.length >= 2);
const j = computed(() => jumps(top.value, vh.value, height.value));
const rail = computed(() => (props.off || !hasOutline.value ? null : railPlace(vw.value, pageRight.value)));
const floating = computed(() => !props.off && !rail.value && j.value.long && openModals.length === 0);

let frame = 0;
function measure() {
  frame = 0;
  const root = document.documentElement;
  vw.value = root.clientWidth;
  vh.value = window.innerHeight;
  top.value = window.scrollY;
  height.value = root.scrollHeight;
  pageRight.value = document.querySelector("main.page")?.getBoundingClientRect().right ?? vw.value;
  const list = items.value;
  if (!list.length) return;
  const atBottom = top.value + vh.value >= height.value - 2;
  const tops = outlineTops(list, (id) => document.getElementById(id)?.getBoundingClientRect().top ?? null);
  // At the bottom the last part shown is marked, though its top may never reach the line.
  const last = tops.reduce<number>((at, t, i) => (t !== null ? i : at), 0);
  current.value = markAmong(list, atBottom && j.value.long ? last : sectionAt(tops, LAND_AT + 24, false));
}
const schedule = () => {
  if (!frame) frame = requestAnimationFrame(measure);
};

const behavior = (): "auto" | "smooth" => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
async function go(i: number) {
  const item = items.value[i];
  if (!item) return;
  menuOpen.value = false;
  item.open?.();
  await nextTick();
  const el = document.getElementById(item.id);
  if (!el) return;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - LAND_AT - (item.land?.() ?? 0), behavior: behavior() });
  current.value = i;
}
const toTop = () => window.scrollTo({ top: 0, behavior: behavior() });
const toBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: behavior() });

// The outline behind a button, for windows without room in the margin.
const menuOpen = ref(false);
const menuButton = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const { style } = usePopup(menuButton, menu, menuOpen, { side: "top", align: "end", gap: 8 });
useOutside([menuButton, menu], menuOpen, () => (menuOpen.value = false));
watch(menuOpen, async (o) => {
  if (!o) return;
  await nextTick();
  focusStill(menu.value?.querySelector<HTMLElement>("button.on") ?? menu.value?.querySelector<HTMLElement>("button"));
});
function onMenuKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    menuOpen.value = false;
    focusStill(menuButton.value);
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const all = [...(menu.value?.querySelectorAll<HTMLElement>("button") ?? [])];
  const at = all.indexOf(document.activeElement as HTMLElement);
  focusStill(all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]);
}
watch(floating, (f) => {
  if (!f) menuOpen.value = false;
  document.documentElement.classList.toggle("ww-jumps", f);
});

let observer: ResizeObserver | undefined;
onMounted(() => {
  measure();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  // The page grows and shrinks as cards load and tabs change.
  observer = new ResizeObserver(schedule);
  observer.observe(document.body);
});
watch(items, schedule);
onBeforeUnmount(() => {
  window.removeEventListener("scroll", schedule);
  window.removeEventListener("resize", schedule);
  observer?.disconnect();
  if (frame) cancelAnimationFrame(frame);
  document.documentElement.classList.remove("ww-jumps");
});
</script>

<template>
  <nav v-if="rail" class="rail" :style="{ left: `${rail.left}px`, width: `${rail.width}px` }" :aria-label="outline?.label ?? 'On this page'">
    <p class="head">On this page</p>
    <ul>
      <li v-for="(x, i) in items" :key="`${x.id}:${x.label}`">
        <button type="button" :class="{ on: i === current, sub: x.level === 2 }" :aria-current="i === current ? 'true' : undefined" @click="go(i)">{{ x.label }}</button>
      </li>
    </ul>
    <div v-if="j.long" class="ends">
      <button type="button" :disabled="!j.up" @click="toTop"><ArrowUpToLine :size="14" /> Back to top</button>
      <button type="button" :disabled="!j.down" @click="toBottom"><ArrowDownToLine :size="14" /> To the bottom</button>
    </div>
  </nav>
  <div v-else-if="floating" class="jumps" role="group" aria-label="Move around the page">
    <button
      v-if="hasOutline"
      ref="menuButton"
      v-tip="'On this page'"
      type="button"
      class="jb"
      aria-label="On this page"
      aria-haspopup="true"
      :aria-expanded="menuOpen"
      @click="menuOpen = !menuOpen"
    >
      <TableOfContents :size="17" />
    </button>
    <button v-tip="'Back to top'" type="button" class="jb" aria-label="Back to top" :disabled="!j.up" @click="toTop"><ArrowUpToLine :size="17" /></button>
    <button v-tip="'To the bottom'" type="button" class="jb" aria-label="To the bottom" :disabled="!j.down" @click="toBottom"><ArrowDownToLine :size="17" /></button>
  </div>
  <Teleport to="body">
    <nav v-if="menuOpen && floating" ref="menu" class="menu" :style="style" :aria-label="outline?.label ?? 'On this page'" @keydown="onMenuKey">
      <p class="head">On this page</p>
      <ul>
        <li v-for="(x, i) in items" :key="`${x.id}:${x.label}`">
          <button type="button" :class="{ on: i === current, sub: x.level === 2 }" :aria-current="i === current ? 'true' : undefined" @click="go(i)">{{ x.label }}</button>
        </li>
      </ul>
    </nav>
  </Teleport>
</template>

<style scoped>
.rail {
  position: fixed;
  top: calc(56px + var(--space-6));
  z-index: 20;
  max-height: calc(100vh - 56px - 2 * var(--space-6));
  overflow-y: auto;
  padding-left: var(--space-4);
  border-left: var(--border-width) solid var(--line);
}
.head {
  margin: 0 0 var(--space-2);
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
ul {
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}
li button {
  display: block;
  width: 100%;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
li button.sub {
  padding-left: var(--space-3);
}
li button:hover {
  color: var(--text);
}
li button.on {
  color: var(--accent-text);
  font-weight: 600;
}
.ends {
  display: grid;
  gap: 1px;
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
}
.ends button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.ends button:hover:not(:disabled) {
  color: var(--text);
}
.ends button:disabled {
  opacity: 0.45;
  cursor: default;
}

.jumps {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 25;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgb(0 0 0 / 14%);
}
.jb {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  cursor: pointer;
}
.jb:hover:not(:disabled),
.jb[aria-expanded="true"] {
  background: var(--raised);
}
.jb:disabled {
  color: var(--muted);
  opacity: 0.45;
  cursor: default;
}

.menu {
  z-index: 30;
  width: min(280px, calc(100vw - 2 * var(--space-4)));
  max-height: min(420px, var(--popup-room, 420px));
  overflow-y: auto;
  padding: var(--space-3) var(--space-3) var(--space-2);
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
.menu li button {
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 14px;
}
.menu li button.sub {
  padding-left: calc(var(--space-2) + var(--space-3));
}
.menu li button:hover,
.menu li button:focus-visible {
  background: var(--raised);
}
</style>
