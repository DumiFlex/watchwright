<script setup lang="ts">
// A themed folder browser. The browser never tells a page a folder's path, so the Watchwright
// server lists folders on its machine (`GET /folders`) and this draws them: places on the side
// (home, drives, recent folders, extra places from the page), the path as crumbs, and the
// folders inside, with marked folders (a pack folder) badged. Keyboard: type to filter (or
// type a path and press Enter to go there), arrows to move, Enter to open, Backspace in an
// empty filter to go up. The page decides what to do with the open folder (the `footer` slot).
import { computed, nextTick, onMounted, ref, useId, watch, type Component } from "vue";
import { ChevronRight, Folder, FolderUp, HardDrive, History, House, Package } from "../icons";
import { folderUrl, getJson, type FolderListing, type FolderPlaces } from "../api";
import { crumbs, rootOf, tildify } from "../paths";
import TextField from "./TextField.vue";
import { vTip } from "../tooltip";

const props = withDefaults(
  defineProps<{
    /** Extra places for the side list, such as the folders of packs already added. */
    places?: readonly { label: string; path: string }[];
    /** Labels for marker kinds shown as badges: `{ pack: "Pack" }`. */
    markLabels?: Record<string, string>;
  }>(),
  { places: () => [], markLabels: () => ({}) },
);
/** The open folder; null opens the home folder. */
const path = defineModel<string | null>("path", { default: null });
const emit = defineEmits<{ listing: [listing: FolderListing | null] }>();

const listing = ref<FolderListing | null>(null);
const placesData = ref<FolderPlaces | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const filter = ref("");
const active = ref(0);
const listId = useId();
const list = ref<HTMLElement | null>(null);
const field = ref<InstanceType<typeof TextField> | null>(null);

const looksLikePath = computed(() => !!rootOf(filter.value.trim().replace(/^["']/, "")) || filter.value.trim().startsWith("~"));
const shown = computed(() => {
  const all = listing.value?.folders ?? [];
  if (!filter.value || looksLikePath.value) return all;
  const f = filter.value.toLowerCase();
  const starts = all.filter((e) => e.name.toLowerCase().startsWith(f));
  return [...starts, ...all.filter((e) => !e.name.toLowerCase().startsWith(f) && e.name.toLowerCase().includes(f))];
});
const trail = computed(() => (listing.value ? crumbs(listing.value.path) : []));

type Place = { key: string; label: string; path: string; icon: Component; missing?: boolean };
const sideGroups = computed(() => {
  const p = placesData.value;
  const groups: { title: string; items: Place[] }[] = [];
  if (p) groups.push({ title: "Places", items: [{ key: "home", label: "Home", path: p.home, icon: House }, ...p.roots.map((r) => ({ key: `root:${r}`, label: r === "/" ? "Computer" : r.replace(/\\$/, ""), path: r, icon: HardDrive }))] });
  if (props.places.length) groups.push({ title: "Packs", items: props.places.map((x) => ({ key: `pack:${x.path}`, label: x.label, path: x.path, icon: Package })) });
  if (p?.recent.length) groups.push({ title: "Recent", items: p.recent.map((r) => ({ key: `recent:${r.path}`, label: tildify(r.path, p.home), path: r.path, icon: History, missing: !r.exists })) });
  return groups;
});

async function load(target: string, climb = false) {
  loading.value = true;
  let res = await getJson<FolderListing>(folderUrl(target));
  // Starting somewhere that's gone (a pack's old folder): open the nearest folder that's still there.
  for (const c of climb ? crumbs(target).reverse().slice(1) : []) {
    if (res.ok || res.error.code !== "not_found") break;
    res = await getJson<FolderListing>(folderUrl(c.path));
  }
  loading.value = false;
  if (!res.ok) {
    error.value = res.error.message;
    return false;
  }
  error.value = null;
  listing.value = res.data;
  filter.value = "";
  active.value = 0;
  if (path.value !== res.data.path) path.value = res.data.path;
  emit("listing", res.data);
  return true;
}

function go(target: string) {
  void load(target).then((ok) => ok && field.value?.focus());
}

watch(path, (p) => {
  if (p && p !== listing.value?.path) void load(p, true);
});

onMounted(async () => {
  const res = await getJson<FolderPlaces>("/api/v1/folders/places");
  if (res.ok) placesData.value = res.data;
  const start = path.value ?? (res.ok ? res.data.home : null);
  if (start) await load(start, true);
  await nextTick();
  field.value?.focus();
});

const optionId = (i: number) => `${listId}-f${i}`;
function move(to: number) {
  if (shown.value.length === 0) return;
  active.value = Math.min(shown.value.length - 1, Math.max(0, to));
  void nextTick(() => list.value?.querySelector(`#${CSS.escape(optionId(active.value))}`)?.scrollIntoView({ block: "nearest" }));
}
function up() {
  if (listing.value?.parent) go(listing.value.parent);
}
function onKey(e: KeyboardEvent) {
  const keys: Record<string, () => void> = {
    ArrowDown: () => move(active.value + 1),
    ArrowUp: () => move(active.value - 1),
    PageDown: () => move(active.value + 8),
    PageUp: () => move(active.value - 8),
    Enter: () => {
      if (looksLikePath.value) return go(filter.value.trim());
      const e = shown.value[active.value];
      if (e) go(e.path);
    },
    Backspace: () => (filter.value === "" ? up() : undefined),
  };
  const run = keys[e.key];
  if (!run) return;
  if (e.key === "Backspace" && filter.value !== "") return;
  e.preventDefault();
  run();
}
watch(filter, () => (active.value = 0));

function badge(marks: Record<string, string>): string | null {
  const kind = Object.keys(marks).find((k) => props.markLabels[k]);
  return kind ? `${props.markLabels[kind]} · ${marks[kind]}` : null;
}
defineExpose({ reload: () => listing.value && load(listing.value.path), focus: () => field.value?.focus() });
</script>

<template>
  <div class="fb">
    <nav class="side" aria-label="Places">
      <section v-for="g in sideGroups" :key="g.title" class="group">
        <h3 class="gtitle">{{ g.title }}</h3>
        <button
          v-for="p in g.items"
          :key="p.key"
          v-tip="p.path"
          type="button"
          class="place"
          :class="{ here: listing?.path === p.path, missing: p.missing }"
          :disabled="p.missing"
          @click="go(p.path)"
        >
          <component :is="p.icon" :size="15" />
          <span class="plabel">{{ p.label }}</span>
        </button>
      </section>
    </nav>

    <div class="main">
      <div class="bar">
        <button type="button" class="iconbtn" aria-label="Up one folder" :disabled="!listing?.parent" @click="up">
          <FolderUp :size="16" />
        </button>
        <ol class="crumbs" aria-label="Folder path">
          <li v-for="(c, i) in trail" :key="c.path">
            <ChevronRight v-if="i > 0" class="csep" :size="13" />
            <button type="button" class="crumb" :aria-current="i === trail.length - 1 ? 'location' : undefined" @click="go(c.path)">{{ c.label }}</button>
          </li>
        </ol>
      </div>
      <label class="sr-only" :for="`${listId}-filter`">Filter folders or go to a path</label>
      <TextField :id="`${listId}-filter`" ref="field" v-model="filter" type="search" placeholder="Filter, or type a path and press Enter" @keydown="onKey" />
      <p v-if="error" class="error small" role="alert">{{ error }}</p>
      <ul :id="listId" ref="list" class="list" role="listbox" aria-label="Folders" :aria-busy="loading">
        <li
          v-for="(e, i) in shown"
          :id="optionId(i)"
          :key="e.path"
          role="option"
          :aria-selected="i === active"
          :class="{ active: i === active, marked: !!badge(e.marks) }"
          @pointerenter="active = i"
          @click="go(e.path)"
        >
          <Package v-if="badge(e.marks)" class="ficon" :size="16" />
          <Folder v-else class="ficon" :size="16" />
          <span class="fname">{{ e.name }}</span>
          <span v-if="badge(e.marks)" class="badge small">{{ badge(e.marks) }}</span>
        </li>
        <li v-if="listing && shown.length === 0" class="empty muted small" role="presentation">{{ filter && !looksLikePath ? "No folder matches." : "No folders here." }}</li>
      </ul>
      <p v-if="listing?.truncated" class="muted small">Showing the first {{ listing.folders.length }} folders. Filter or type a path to find others.</p>
      <slot name="footer" :listing="listing" />
    </div>
  </div>
</template>

<style scoped>
.fb {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: var(--space-4);
  min-height: 0;
}
.side {
  display: grid;
  align-content: start;
  gap: var(--space-3);
  min-width: 0;
  max-height: 420px;
  overflow-y: auto;
}
.group {
  display: grid;
  gap: 2px;
}
.gtitle {
  margin: 0 0 var(--space-1);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.place {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.place:hover:not(:disabled) {
  background: var(--hover);
}
.place.here {
  background: var(--raised);
  color: var(--accent-text);
}
.place.missing {
  opacity: 0.5;
  cursor: default;
  text-decoration: line-through;
}
.plabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main {
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.iconbtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.iconbtn:hover:not(:disabled) {
  border-color: var(--line-strong);
}
.iconbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.crumbs li {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.csep {
  flex: none;
  color: var(--muted);
}
.crumb {
  max-width: 180px;
  overflow: hidden;
  padding: 2px 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.crumb:hover {
  background: var(--hover);
  color: var(--text);
}
.crumb[aria-current] {
  color: var(--text);
  font-weight: 600;
}
.list {
  height: 300px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.list li[role="option"] {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.list li.active {
  background: var(--raised);
}
.ficon {
  flex: none;
  color: var(--muted);
}
.marked .ficon {
  color: var(--accent-text);
}
.fname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex: none;
  margin-left: auto;
  padding: 1px 8px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent-text);
}
.empty {
  padding: var(--space-3);
}
.error {
  margin: 0;
}
@media (max-width: 720px) {
  .fb {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    max-height: none;
  }
  .group {
    display: flex;
    gap: var(--space-1);
  }
  .gtitle {
    display: none;
  }
  .place {
    flex: none;
    border: var(--border-width) solid var(--line);
  }
  .list {
    height: 260px;
  }
}
</style>
