<script setup lang="ts">
// Customize: change what a pack's dashboard shows without editing the pack. A drawer with the
// runs the tiles read, the filters, and the groups of tiles: drag a tile to move it, pick its
// width, open it for its fields, add one from the kinds. Save keeps the change on the server
// (the pack's own block stays as it is); "Use the pack's" drops it again.
import { computed, ref, useId, watch } from "vue";
import { getJson, sendJson } from "../api";
import type { Dashboard, DashboardReply, Tile, TileType } from "../dashboard";
import { KINDS, NO_NAMES, argOptions, cloneTile, kindOf, newTile, tileLabel, toSave, type DashboardNames } from "../dashedit";
import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2 } from "../icons";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import DashboardTileFields from "./DashboardTileFields.vue";
import MultiSelect from "./MultiSelect.vue";
import NumberInput from "./NumberInput.vue";
import RadioGroup from "./RadioGroup.vue";
import SelectMenu from "./SelectMenu.vue";
import SideDrawer from "./SideDrawer.vue";
import SortableList from "./SortableList.vue";
import TextField from "./TextField.vue";

const props = defineProps<{ packId: string; reply: DashboardReply }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ saved: [] }>();
const id = useId();

interface Row {
  key: number;
  tile: Tile;
}
interface Group {
  key: number;
  title: string;
  rows: Row[];
}
let nextKey = 1;
const groups = ref<Group[]>([]);
const rangeBy = ref<"runs" | "days">("runs");
const runs = ref(20);
const days = ref(7);
const filters = ref<string[]>([]);
const names = ref<DashboardNames>(NO_NAMES);
const editing = ref<number | null>(null);
const adding = ref<number | null>(null);
const addKind = ref<TileType>("metric");
const saving = ref(false);
const problems = ref<string[]>([]);

function start(d: Dashboard) {
  groups.value = d.groups.map((g) => ({ key: nextKey++, title: g.title ?? "", rows: g.tiles.map((t) => ({ key: nextKey++, tile: cloneTile(t) })) }));
  if (!groups.value.length) groups.value = [{ key: nextKey++, title: "", rows: [] }];
  rangeBy.value = d.days ? "days" : "runs";
  runs.value = d.runs;
  days.value = d.days ?? 7;
  filters.value = [...d.filters];
  editing.value = null;
  adding.value = null;
  problems.value = [];
}
watch(open, async (o) => {
  if (!o) return;
  start(props.reply.dashboard);
  const res = await getJson<DashboardNames>(`/api/v1/packs/${props.packId}/dashboard/names`);
  if (res.ok) names.value = res.data;
});

const draft = computed<Dashboard>(() => ({
  runs: runs.value,
  ...(rangeBy.value === "days" ? { days: days.value } : {}),
  filters: filters.value,
  groups: groups.value.map((g) => ({ title: g.title.trim() || null, tiles: g.rows.map((r) => r.tile) })),
}));
const filterOptions = computed(() => [...names.value.params.map((p) => ({ value: p, label: p, group: "Params" })), ...names.value.info.map((f) => ({ value: `info.${f}`, label: f, group: "Facts runs saved" }))]);
const groupTitles = computed(() => groups.value.map((g) => g.title));
const WIDTHS = [1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? "1 column" : `${n} columns` }));
const kindMenu = KINDS.map((k) => ({ value: k.type, label: `${k.label}: ${k.about.toLowerCase()}` }));

function setTile(g: Group, r: Row, t: Tile) {
  r.tile = t;
  g.rows = [...g.rows];
}
function removeTile(g: Group, r: Row) {
  g.rows = g.rows.filter((x) => x !== r);
  if (editing.value === r.key) editing.value = null;
}
function moveTile(from: number, r: Row, to: number) {
  const a = groups.value[from]!;
  const b = groups.value[to]!;
  a.rows = a.rows.filter((x) => x !== r);
  b.rows = [...b.rows, r];
}
function addTile(gi: number) {
  const kind = kindOf(addKind.value);
  const first = argOptions(kind, names.value).find((o) => o.value !== "");
  const arg: string | true = kind.arg === "none" || kind.anyAllowed ? true : kind.arg === "markdown" ? "Write what this pack checks, and who to ask." : (first?.value ?? true);
  const row = { key: nextKey++, tile: newTile(kind.type, arg) };
  const g = groups.value[gi]!;
  g.rows = [...g.rows, row];
  adding.value = null;
  editing.value = row.key;
}
function addGroup() {
  groups.value = [...groups.value, { key: nextKey++, title: "", rows: [] }];
}
function removeGroup(gi: number) {
  const [gone] = groups.value.splice(gi, 1);
  // Its tiles go to the group above (or the next one), never away with it.
  const into = groups.value[Math.max(0, gi - 1)];
  if (gone && into) into.rows = [...into.rows, ...gone.rows];
}
function moveGroup(gi: number, by: -1 | 1) {
  const list = [...groups.value];
  const [g] = list.splice(gi, 1);
  list.splice(gi + by, 0, g!);
  groups.value = list;
}

async function save() {
  saving.value = true;
  problems.value = [];
  const res = await sendJson<DashboardReply>(`/api/v1/packs/${props.packId}/dashboard`, toSave(draft.value));
  saving.value = false;
  if (!res.ok) {
    const detail = res.error.detail as { problems?: string[] } | undefined;
    problems.value = detail?.problems?.length ? detail.problems : [res.error.message];
    return;
  }
  open.value = false;
  toast("Dashboard saved");
  emit("saved");
}
async function usePacks() {
  saving.value = true;
  const res = await sendJson<DashboardReply>(`/api/v1/packs/${props.packId}/dashboard`, {}, "DELETE");
  saving.value = false;
  if (!res.ok) return void (problems.value = [res.error.message]);
  open.value = false;
  toast(props.reply.packHasOwn ? "The dashboard is the pack's own again" : "The dashboard is the default again");
  emit("saved");
}
</script>

<template>
  <SideDrawer v-model="open" heading="Customize the dashboard" width="560px">
    <div class="de">
      <p class="muted small">
        Changes are kept on this server for everyone who opens the pack. The pack's own <code>dashboard:</code> block stays as it is{{ reply.source === "override" ? "; Use the pack's brings it back" : "" }}.
      </p>

      <section class="part" aria-labelledby="de-range">
        <h3 id="de-range" class="label">Runs the tiles read</h3>
        <div class="range">
          <RadioGroup
            v-model="rangeBy"
            inline
            label="Runs the tiles read"
            :options="[
              { value: 'runs', label: 'The latest runs' },
              { value: 'days', label: 'The last days' },
            ]"
          />
          <NumberInput v-if="rangeBy === 'runs'" v-model="runs" :min="1" :max="200" label="Runs" />
          <NumberInput v-else v-model="days" :min="1" :max="3650" label="Days" />
        </div>
        <label :for="`${id}-filters`" class="lbl small">Filters at the top</label>
        <MultiSelect :id="`${id}-filters`" v-model="filters" :options="filterOptions" empty-label="None" />
      </section>

      <section v-for="(g, gi) in groups" :key="g.key" class="part group" :aria-label="g.title || `Group ${gi + 1}`">
        <div class="ghead">
          <TextField v-model="g.title" :placeholder="groups.length > 1 ? `Group ${gi + 1} title` : 'Group title (optional)'" :aria-label="`Title of group ${gi + 1}`" />
          <template v-if="groups.length > 1">
            <button v-tip="'Move the group up'" type="button" class="btn icon" aria-label="Move the group up" :disabled="gi === 0" @click="moveGroup(gi, -1)"><ChevronUp :size="15" /></button>
            <button v-tip="'Move the group down'" type="button" class="btn icon" aria-label="Move the group down" :disabled="gi === groups.length - 1" @click="moveGroup(gi, 1)"><ChevronDown :size="15" /></button>
            <button v-tip="'Remove the group (its tiles join the group above)'" type="button" class="btn icon" aria-label="Remove the group" @click="removeGroup(gi)"><Trash2 :size="15" /></button>
          </template>
        </div>
        <p v-if="!g.rows.length" class="muted small">No tiles in this group yet.</p>
        <SortableList v-model="g.rows" :item-key="(r: Row) => r.key" :item-label="(r: Row) => tileLabel(r.tile)" :label="`Tiles of ${g.title || `group ${gi + 1}`}`">
          <template #default="{ item }">
            <div class="trow">
              <button type="button" class="tname" :aria-expanded="editing === item.key" @click="editing = editing === item.key ? null : item.key">
                <span class="tl">{{ tileLabel(item.tile) }}</span>
                <span v-if="item.tile.title" class="muted small">{{ kindOf(item.tile.type).label }}</span>
                <ChevronUp v-if="editing === item.key" :size="15" /><ChevronDown v-else :size="15" />
              </button>
              <SelectMenu :model-value="item.tile.width" :options="WIDTHS" :aria-label="`Width of ${tileLabel(item.tile)}`" class="wsel" @update:model-value="(w: number) => setTile(g, item, { ...item.tile, width: w })" />
              <button v-tip="'Remove the tile'" type="button" class="btn icon" :aria-label="`Remove ${tileLabel(item.tile)}`" @click="removeTile(g, item)"><Trash2 :size="15" /></button>
            </div>
            <DashboardTileFields v-if="editing === item.key" class="tfields" :model-value="item.tile" :names="names" :groups="groupTitles" :group="gi" @update:model-value="(t: Tile) => setTile(g, item, t)" @move="(to: number) => moveTile(gi, item, to)" />
          </template>
        </SortableList>
        <div v-if="adding === gi" class="adder">
          <label :for="`${id}-kind-${gi}`" class="lbl small">Kind of tile</label>
          <SelectMenu :id="`${id}-kind-${gi}`" v-model="addKind" :options="kindMenu" />
          <div class="adder-actions">
            <button type="button" class="btn" @click="adding = null">Cancel</button>
            <button type="button" class="btn primary" @click="addTile(gi)"><Plus :size="15" /> Add</button>
          </div>
        </div>
        <button v-else type="button" class="btn addbtn" @click="adding = gi"><Plus :size="15" /> Add a tile</button>
      </section>
      <button type="button" class="btn addbtn" @click="addGroup"><Plus :size="15" /> Add a group</button>

      <div v-if="problems.length" class="problems small" role="alert">
        <p>The dashboard wasn't saved:</p>
        <ul>
          <li v-for="(p, i) in problems" :key="i">{{ p }}</li>
        </ul>
      </div>
    </div>
    <template #actions>
      <button v-if="reply.source === 'override'" v-tip="reply.packHasOwn ? 'Drop the changes made here: show the pack\'s own dashboard' : 'Drop the changes made here: show the default'" type="button" class="btn reset" :disabled="saving" @click="usePacks">
        <RotateCcw :size="15" /> {{ reply.packHasOwn ? "Use the pack's" : "Use the default" }}
      </button>
      <button type="button" class="btn" @click="open = false">Cancel</button>
      <button type="button" class="btn primary" :disabled="saving" @click="save">{{ saving ? "Saving…" : "Save" }}</button>
    </template>
  </SideDrawer>
</template>

<style scoped>
.de {
  display: grid;
  gap: var(--space-5);
}
p {
  margin: 0;
}
.part {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
.part h3 {
  margin: 0;
}
.range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  margin-bottom: var(--space-2);
}
.group {
  padding-top: var(--space-4);
  border-top: var(--border-width) solid var(--line);
}
/* A row opened for its fields keeps its grip at the top. */
.group :deep(.entry) {
  align-items: flex-start;
}
.group :deep(.grip) {
  margin-top: 3px;
}
.ghead {
  display: flex;
  gap: var(--space-2);
}
.ghead > :first-child {
  flex: 1;
  min-width: 0;
}
.trow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.tname {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 6px var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.tname:hover {
  background: var(--hover);
}
.tl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tname .muted {
  flex: none;
}
.tname svg {
  flex: none;
  margin-left: auto;
  color: var(--muted);
}
.wsel {
  flex: none;
  width: 8.5rem;
}
.tfields {
  margin: var(--space-2) 0 var(--space-3) var(--space-2);
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
}
.adder {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
}
.adder-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.addbtn {
  justify-self: start;
}
.reset {
  margin-right: auto;
}
.problems {
  padding: var(--space-3);
  border: var(--border-width) solid color-mix(in srgb, var(--bad) 45%, var(--line));
  border-radius: var(--radius);
  color: var(--bad);
}
.problems ul {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-5);
}
@media (max-width: 640px) {
  /* The name gets its own line; width and remove sit under it. */
  .trow {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .tname {
    flex-basis: 100%;
  }
  .tfields {
    margin-left: 0;
  }
}
</style>
