<script setup lang="ts">
// A path field that completes folders as you type, from the Watchwright server's machine:
// suggestions under the field, Tab completes like a terminal (to the part every match shares,
// or the highlighted folder), arrows pick, Enter takes a suggestion or submits. Below it, a
// line says whether the folder typed so far has the marker the page wants (a pack file).
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { Folder, Package } from "../icons";
import { folderUrl, getJson, type FolderListing } from "../api";
import { commonPrefix, completionTarget, join, matchNames } from "../paths";
import { useOutside, usePopup, usePopupHost } from "../popup";
import TextField from "./TextField.vue";

const props = withDefaults(defineProps<{ id?: string | undefined; placeholder?: string | undefined; invalid?: boolean; disabled?: boolean; mark?: string | undefined; markLabel?: string }>(), {
  id: undefined,
  placeholder: undefined,
  mark: undefined,
  markLabel: "Marked",
});
const model = defineModel<string>({ default: "" });
const emit = defineEmits<{ submit: [] }>();

const root = ref<HTMLElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const open = ref(false);
const active = ref(-1);
const listId = useId();
const { style } = usePopup(root, popup, open, { matchWidth: true });
useOutside([root, popup], open, () => (open.value = false));
const host = usePopupHost(root);

const focused = ref(false);
const cache = new Map<string, FolderListing | null>();
const parent = ref<FolderListing | null>(null);
const here = ref<FolderListing | null>(null);
const target = computed(() => completionTarget(model.value));
const suggestions = computed(() => {
  const t = target.value;
  if (!t || !parent.value) return [];
  return matchNames(
    parent.value.folders.map((f) => f.name),
    t.partial,
  )
    .slice(0, 8)
    .map((name) => parent.value!.folders.find((f) => f.name === name)!);
});

async function listing(dir: string): Promise<FolderListing | null> {
  if (cache.has(dir)) return cache.get(dir)!;
  const res = await getJson<FolderListing>(folderUrl(dir));
  const value = res.ok ? res.data : null;
  cache.set(dir, value);
  return value;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let asked = 0;
watch(model, (v) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    const mine = ++asked;
    const t = completionTarget(v);
    const p = t ? await listing(t.dir) : null;
    // The typed folder itself: the listed one when the path ends with a separator, else the
    // folder named exactly so (asking only for folders that exist keeps 404s out of the console).
    const exact = t && p ? p.folders.find((f) => f.name === t.partial.replace(/["']$/, "")) : undefined;
    const h = !t ? null : t.partial === "" ? p : exact ? await listing(exact.path) : null;
    if (mine !== asked) return;
    parent.value = p;
    here.value = h;
    active.value = -1;
    open.value = focused.value && suggestions.value.length > 0 && !(suggestions.value.length === 1 && suggestions.value[0]!.name === t?.partial);
  }, 120);
});
onBeforeUnmount(() => timer && clearTimeout(timer));

const marked = computed(() => (props.mark && here.value ? (here.value.marks[props.mark] ?? null) : null));
const status = computed(() => {
  if (!here.value || !props.mark) return null;
  return marked.value ? `${props.markLabel} found: ${marked.value}` : `No ${props.markLabel.toLowerCase()} file in this folder.`;
});

function take(i: number) {
  const s = suggestions.value[i];
  const t = target.value;
  if (!s || !t) return;
  model.value = join(t.dir, s.name) + (parent.value?.sep ?? "/");
}
function onKey(e: KeyboardEvent) {
  const n = suggestions.value.length;
  if (e.key === "ArrowDown" && n) {
    e.preventDefault();
    open.value = true;
    active.value = (active.value + 1) % n;
  } else if (e.key === "ArrowUp" && n) {
    e.preventDefault();
    open.value = true;
    active.value = active.value <= 0 ? n - 1 : active.value - 1;
  } else if (e.key === "Tab" && n && !e.shiftKey) {
    const t = target.value!;
    const names = suggestions.value.map((s) => s.name);
    if (active.value >= 0) take(active.value);
    else if (n === 1) take(0);
    else {
      const common = commonPrefix(names);
      if (common.length <= t.partial.length) return; // nothing more to complete; Tab moves on
      model.value = join(t.dir, common);
    }
    e.preventDefault();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (open.value && active.value >= 0) take(active.value);
    else {
      open.value = false;
      emit("submit");
    }
  } else if (e.key === "Escape" && open.value) {
    e.preventDefault();
    open.value = false;
  }
}
const optionId = (i: number) => `${listId}-s${i}`;
</script>

<template>
  <div ref="root" class="pi" @focusin="focused = true" @focusout="focused = false">
    <TextField :id="id" v-model="model" :placeholder="placeholder" :invalid="invalid" :disabled="disabled" @keydown="onKey" />
    <Teleport :to="host">
      <ul v-if="open && suggestions.length" :id="listId" ref="popup" class="sugg" role="listbox" aria-label="Matching folders" :style="style">
        <li
          v-for="(s, i) in suggestions"
          :id="optionId(i)"
          :key="s.path"
          role="option"
          :aria-selected="i === active"
          :class="{ active: i === active }"
          @pointerenter="active = i"
          @pointerdown.prevent
          @click="take(i)"
        >
          <Package v-if="mark && s.marks[mark]" class="ic marked" :size="15" />
          <Folder v-else class="ic" :size="15" />
          <span class="name">{{ s.name }}</span>
          <span v-if="mark && s.marks[mark]" class="muted small">{{ s.marks[mark] }}</span>
        </li>
        <li class="hint muted small" role="presentation">Tab completes · Enter picks</li>
      </ul>
    </Teleport>
    <p v-if="status" class="status small" :class="marked ? 'ok' : 'muted'" aria-live="polite">
      <Package v-if="marked" :size="13" />
      {{ status }}
    </p>
  </div>
</template>

<style scoped>
.pi {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.sugg {
  z-index: 40;
  max-height: min(280px, var(--popup-room, 280px));
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
.sugg li[role="option"] {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.sugg li.active {
  background: var(--raised);
}
.ic {
  flex: none;
  color: var(--muted);
}
.ic.marked {
  color: var(--accent-text);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  padding: 4px 8px 2px;
}
.status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
}
.status.ok {
  color: var(--ok);
}
</style>
