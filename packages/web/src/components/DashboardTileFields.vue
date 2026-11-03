<script setup lang="ts">
// The fields of one tile in the dashboard editor: its name (a pick from the names the pack's
// runs offer, or one typed), its title, its kind's own fields, which tests and runs it reads,
// and whether shares show it. v-model is the tile as the server reads it.
import { computed, ref, useId } from "vue";
import type { DashLink, Tile } from "../dashboard";
import { argOptions, kindOf, measureOptions, type DashboardNames } from "../dashedit";
import { Plus, Trash2 } from "../icons";
import { can } from "../session";
import { vTip } from "../tooltip";
import MultiSelect from "./MultiSelect.vue";
import NumberInput from "./NumberInput.vue";
import SelectMenu from "./SelectMenu.vue";
import TextArea from "./TextArea.vue";
import TextField from "./TextField.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{
  names: DashboardNames;
  /** The groups' titles, to move the tile to another one. */
  groups: readonly string[];
  group: number;
}>();
const tile = defineModel<Tile>({ required: true });
const emit = defineEmits<{ move: [to: number] }>();
const id = useId();

const kind = computed(() => kindOf(tile.value.type));
const has = (f: string) => (kind.value.fields as readonly string[]).includes(f);

/** Sets a field, or drops it when the value is empty. */
function set<K extends keyof Tile>(k: K, v: Tile[K] | "" | undefined) {
  const next = { ...tile.value };
  if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
  else next[k] = v as Tile[K];
  tile.value = next;
}

// The tile's name: one of the pack's names, or one typed for a name no run has recorded yet.
const OTHER = "\u0001other";
const argList = computed(() => argOptions(kind.value, props.names));
const argText = computed(() => (tile.value.arg === true ? "" : tile.value.arg));
const typing = ref(false);
const inList = computed(() => argList.value.some((o) => o.value === argText.value));
const showTyped = computed(() => kind.value.arg !== "breakdown" && (typing.value || !inList.value));
const argMenu = computed(() => [...argList.value.map((o) => ({ value: o.value, label: o.label })), ...(kind.value.arg === "breakdown" ? [] : [{ value: OTHER, label: "Another name…" }])]);
const argPick = computed({
  get: () => (showTyped.value ? OTHER : argText.value),
  set: (v: string) => {
    if (v === OTHER) return void (typing.value = true);
    typing.value = false;
    setArg(v);
  },
});
function setArg(v: string) {
  const next: Tile = { ...tile.value, arg: v === "" ? true : v };
  if (next.type === "stat") next.measure = v;
  tile.value = next;
}
const argLabel = computed(() => ({ metric: "Metric", criterion: "Criterion", choice: "Criterion", flag: "Flag", group: "Param or fact", measure: "Measure", breakdown: "One per", lowest: "Of", shot: "Screenshot", output: "Text or file" })[kind.value.arg as string] ?? "Name");

// Fields with a fixed set of values; "" stands for "not set".
const AGG = ["mean", "median", "p90", "sum", "min", "max", "last"].map((v) => ({ value: v, label: v === "p90" ? "90th percentile" : v[0]!.toUpperCase() + v.slice(1) }));
const measures = computed(() => measureOptions(props.names));
const measureMenu = computed(() => measures.value.map((o) => ({ value: o.value, label: o.label })));
const groupMenu = computed(() => [{ value: "", label: "None" }, ...argOptions(kindOf("value"), props.names).map((o) => ({ value: o.value, label: o.label }))]);
const sectionMenu = computed(() => [{ value: "", label: "Any section" }, ...props.names.sections.map((s) => ({ value: s, label: s }))]);
const tagMenu = computed(() => [{ value: "", label: "Any tag" }, ...props.names.tags.map((s) => ({ value: s, label: s }))]);
const testOptions = computed(() => props.names.tests.map((t) => ({ value: t.id, label: t.title !== t.id ? `${t.id} ${t.title}` : t.id })));
const RUNS = [{ value: 0, label: "The dashboard's" }, ...[5, 10, 20, 50, 100, 200].map((n) => ({ value: n, label: `The latest ${n}` }))];
const FAILURE_KINDS = [
  { value: "", label: "Failed or broken, or flagged" },
  { value: "finding", label: "With a finding flag" },
  { value: "robot", label: "With a robot flag" },
  { value: "info", label: "With an info flag" },
];

const goalSide = computed({
  get: () => (tile.value.goal?.below !== undefined ? "below" : tile.value.goal?.above !== undefined ? "above" : ""),
  set: (v: string) => set("goal", v ? { [v]: goalValue.value } : undefined),
});
const goalValue = computed(() => tile.value.goal?.below ?? tile.value.goal?.above ?? 0);
const setGoalValue = (n: number) => goalSide.value && set("goal", { [goalSide.value]: n });

// Links: a kind and a value each.
type LinkKind = "preset" | "last" | "previous" | "export" | "url";
const LINK_KINDS: { value: LinkKind; label: string }[] = [
  { value: "preset", label: "New run from a preset" },
  { value: "last", label: "Compare the last two runs" },
  { value: "previous", label: "Compare the two before" },
  { value: "export", label: "Export the latest run" },
  { value: "url", label: "A page" },
];
const linkKind = (l: DashLink): LinkKind => ("preset" in l ? "preset" : "compare" in l ? l.compare : "export" in l ? "export" : "url");
const URL_HINT = "https://";
const linkText = (l: DashLink) => ("preset" in l ? l.preset : "url" in l ? l.url : "");
const links = computed(() => tile.value.links ?? []);
function setLink(i: number, l: DashLink) {
  set(
    "links",
    links.value.map((x, j) => (j === i ? l : x)),
  );
}
function changeLinkKind(i: number, k: LinkKind) {
  const label = links.value[i]?.label;
  const base: DashLink = k === "preset" ? { preset: "" } : k === "url" ? { url: "https://", label: label ?? "" } : k === "export" ? { export: true } : { compare: k };
  setLink(i, label && k !== "url" ? { ...base, label } : base);
}
function setLinkText(i: number, v: string) {
  const l = links.value[i]!;
  if ("preset" in l) setLink(i, { ...l, preset: v });
  else if ("url" in l) setLink(i, { ...l, url: v });
}
function setLinkLabel(i: number, v: string) {
  const l = { ...links.value[i]! };
  if (v) l.label = v;
  else if (!("url" in l)) delete l.label;
  else l.label = "";
  setLink(i, l);
}
const removeLink = (i: number) => (tile.value = { ...tile.value, links: links.value.filter((_, j) => j !== i) });
const addLink = () => (tile.value = { ...tile.value, links: [...links.value, { compare: "last" }] });
</script>

<template>
  <div class="tf">
    <div v-if="kind.arg !== 'none' && kind.arg !== 'markdown' && kind.arg !== 'links'" class="fld">
      <label :for="`${id}-arg`" class="lbl small">{{ argLabel }}</label>
      <SelectMenu :id="`${id}-arg`" v-model="argPick" :options="argMenu" />
      <TextField v-if="showTyped" :model-value="argText" :placeholder="kind.arg === 'measure' ? 'metric.Load ms' : 'A name runs record'" aria-label="Name" @update:model-value="(v: string) => v.trim() && setArg(v.trim())" />
    </div>
    <div v-if="kind.arg === 'markdown'" class="fld">
      <label :for="`${id}-md`" class="lbl small">Note <span class="muted">(Markdown)</span></label>
      <TextArea :id="`${id}-md`" :model-value="argText" :rows="4" @update:model-value="(v: string) => setArg(v)" />
    </div>
    <div v-if="kind.arg === 'links'" class="fld">
      <span class="lbl small">Links</span>
      <div v-for="(l, i) in links" :key="i" class="link">
        <SelectMenu :model-value="linkKind(l)" :options="LINK_KINDS" :aria-label="`Link ${i + 1}`" @update:model-value="(k: LinkKind) => changeLinkKind(i, k)" />
        <TextField v-if="linkKind(l) === 'preset' || linkKind(l) === 'url'" :model-value="linkText(l)" :type="linkKind(l) === 'url' ? 'url' : 'text'" :placeholder="linkKind(l) === 'url' ? URL_HINT : 'Preset name'" :aria-label="linkKind(l) === 'url' ? 'Address' : 'Preset name'" @update:model-value="(v: string) => setLinkText(i, v)" />
        <TextField :model-value="l.label ?? ''" :placeholder="linkKind(l) === 'url' ? 'Label' : 'Label (optional)'" aria-label="Label" @update:model-value="(v: string) => setLinkLabel(i, v)" />
        <button v-tip="'Remove this link'" type="button" class="btn icon" :aria-label="`Remove link ${i + 1}`" :disabled="links.length === 1" @click="removeLink(i)"><Trash2 :size="15" /></button>
      </div>
      <button type="button" class="btn add" @click="addLink"><Plus :size="15" /> Add link</button>
    </div>

    <div class="fld">
      <label :for="`${id}-title`" class="lbl small">Title <span class="muted">(optional)</span></label>
      <TextField :id="`${id}-title`" :model-value="tile.title ?? ''" placeholder="Made from the kind and name" @update:model-value="(v: string) => set('title', v.trim())" />
    </div>

    <div class="two">
      <div v-if="has('measure')" class="fld">
        <label :for="`${id}-measure`" class="lbl small">Measure</label>
        <SelectMenu :id="`${id}-measure`" :model-value="tile.measure ?? 'passrate'" :options="measureMenu" @update:model-value="(v: string) => set('measure', v === 'passrate' ? undefined : v)" />
      </div>
      <div v-if="has('x')" class="fld">
        <label :for="`${id}-x`" class="lbl small">Across</label>
        <SelectMenu :id="`${id}-x`" :model-value="tile.x ?? 'passrate'" :options="measureMenu" @update:model-value="(v: string) => set('x', v)" />
      </div>
      <div v-if="has('y')" class="fld">
        <label :for="`${id}-y`" class="lbl small">Up</label>
        <SelectMenu :id="`${id}-y`" :model-value="tile.y ?? 'duration'" :options="measureMenu" @update:model-value="(v: string) => set('y', v)" />
      </div>
      <div v-if="has('of') && (tile.type === 'metric' || String(tile.arg).startsWith('metric.'))" class="fld">
        <label :for="`${id}-of`" class="lbl small">Over the attempts</label>
        <SelectMenu :id="`${id}-of`" :model-value="tile.of ?? 'mean'" :options="AGG" @update:model-value="(v: string) => set('of', v === 'mean' ? undefined : v)" />
      </div>
      <div v-if="has('unit')" class="fld">
        <label :for="`${id}-unit`" class="lbl small">Unit <span class="muted">(optional)</span></label>
        <TextField :id="`${id}-unit`" :model-value="tile.unit ?? ''" placeholder="The metric's" @update:model-value="(v: string) => set('unit', v.trim())" />
      </div>
      <div v-if="has('goal')" class="fld">
        <label :for="`${id}-goal`" class="lbl small">Goal</label>
        <div class="goal">
          <SelectMenu
            :id="`${id}-goal`"
            v-model="goalSide"
            :options="[
              { value: '', label: 'None' },
              { value: 'below', label: 'Stay below' },
              { value: 'above', label: 'Stay above' },
            ]"
          />
          <NumberInput v-if="goalSide" :model-value="goalValue" label="Goal" @update:model-value="setGoalValue" />
        </div>
      </div>
      <div v-if="has('kind')" class="fld">
        <label :for="`${id}-kind`" class="lbl small">Attempts</label>
        <SelectMenu :id="`${id}-kind`" :model-value="tile.kind ?? ''" :options="FAILURE_KINDS" @update:model-value="(v: string) => set('kind', (v || undefined) as Tile['kind'])" />
      </div>
      <div v-if="has('limit')" class="fld">
        <label :for="`${id}-limit`" class="lbl small">How many</label>
        <NumberInput :id="`${id}-limit`" :model-value="tile.limit ?? (tile.type === 'duration' ? 5 : 10)" :min="1" :max="50" label="How many" @update:model-value="(n: number) => set('limit', n)" />
      </div>
    </div>
    <div v-if="has('columns')" class="fld">
      <label :for="`${id}-cols`" class="lbl small">Columns</label>
      <MultiSelect :id="`${id}-cols`" :model-value="tile.columns ?? []" :options="measures" empty-label="Pass rate, score and runs" @update:model-value="(v: string[]) => set('columns', v.slice(0, 12))" />
    </div>
    <ToggleSwitch v-if="has('compare')" :id="`${id}-cmp`" :model-value="tile.compare === 'previous'" @update:model-value="(v: boolean) => set('compare', v ? 'previous' : undefined)">Show the one before beside it</ToggleSwitch>

    <p class="label sub">Which attempts</p>
    <div class="two">
      <div class="fld">
        <label :for="`${id}-split`" class="lbl small">One series per</label>
        <SelectMenu :id="`${id}-split`" :model-value="tile.split ?? ''" :options="groupMenu" @update:model-value="(v: string) => set('split', v)" />
      </div>
      <div class="fld">
        <label :for="`${id}-runs`" class="lbl small">Runs</label>
        <SelectMenu :id="`${id}-runs`" :model-value="tile.runs ?? 0" :options="RUNS" @update:model-value="(n: number) => set('runs', n || undefined)" />
      </div>
      <div v-if="names.sections.length" class="fld">
        <label :for="`${id}-section`" class="lbl small">Section</label>
        <SelectMenu :id="`${id}-section`" :model-value="tile.section ?? ''" :options="sectionMenu" @update:model-value="(v: string) => set('section', v)" />
      </div>
      <div v-if="names.tags.length" class="fld">
        <label :for="`${id}-tag`" class="lbl small">Tag</label>
        <SelectMenu :id="`${id}-tag`" :model-value="tile.tag ?? ''" :options="tagMenu" @update:model-value="(v: string) => set('tag', v)" />
      </div>
    </div>
    <div class="fld">
      <label :for="`${id}-tests`" class="lbl small">Tests</label>
      <MultiSelect :id="`${id}-tests`" :model-value="tile.tests ?? []" :options="testOptions" empty-label="Every test" @update:model-value="(v: string[]) => set('tests', v)" />
    </div>
    <ToggleSwitch :id="`${id}-current`" :model-value="!tile.current" @update:model-value="(v: boolean) => (tile = { ...tile, current: !v })">Also count tries that broke and ran again</ToggleSwitch>
    <ToggleSwitch :id="`${id}-public`" :model-value="tile.public" :disabled="!can('admin')" @update:model-value="(v: boolean) => (tile = { ...tile, public: v })">Show on the public status page and in shares</ToggleSwitch>
    <div v-if="groups.length > 1" class="fld">
      <label :for="`${id}-group`" class="lbl small">Group</label>
      <SelectMenu :id="`${id}-group`" :model-value="group" :options="groups.map((g, i) => ({ value: i, label: g || `Group ${i + 1}` }))" @update:model-value="(to: number) => emit('move', to)" />
    </div>
  </div>
</template>

<style scoped>
.tf {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.fld {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
.two:empty {
  display: none;
}
.goal {
  display: flex;
  gap: var(--space-2);
}
.goal > .sel {
  flex: 1;
  min-width: 0;
}
.link {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  padding-bottom: var(--space-2);
  border-bottom: var(--border-width) solid var(--line);
}
.link > :first-child {
  flex: 1 1 100%;
}
.link > :not(:first-child, .btn) {
  flex: 1 1 10rem;
  min-width: 0;
}
.add {
  justify-self: start;
}
.sub {
  margin-top: var(--space-1);
}
@media (max-width: 640px) {
  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
