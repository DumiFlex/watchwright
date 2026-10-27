<script setup lang="ts">
// The fields of one step in the Steps view, built from the step list: a target gets a
// TargetField, choices a menu, yes/no a switch, the rest a text box. `expect` picks its check
// first. Each change emits the step's whole new fields; lists of steps inside are edited in the
// list below the step, and fields the form can't show say so.
import { computed } from "vue";
import { CHECK_LABELS, controlOf, expectCheck, fieldText, fieldValue, withCheck } from "../stepform";
import { EXPECT_CHECKS, STEP_BY_NAME, type Prop, type StepArgs, type Target } from "../yamlsteps";
import SelectMenu from "./SelectMenu.vue";
import TargetField from "./TargetField.vue";
import TextField from "./TextField.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{ name: string; args: StepArgs; idBase: string }>();
const emit = defineEmits<{ update: [args: StepArgs] }>();

const def = computed(() => STEP_BY_NAME.get(props.name));
const isExpect = computed(() => props.name === "expect");
const check = computed(() => expectCheck(props.args));
const CHECK_FLAGS = new Set(["visible", "hidden", "checked", "enabled", "disabled"]);

/** The fields shown, in the step list's order; for expect only the chosen check's own field. */
const fields = computed<[string, Prop][]>(() => {
  const all = Object.entries(def.value?.fields ?? {});
  if (!isExpect.value) return all.filter(([, p]) => p.t !== "steps");
  const page = check.value === "url" || check.value === "title";
  return all.filter(([k]) => (k === "target" && !page) || k === check.value || k === "not" || k === "timeout").filter(([k]) => !(CHECK_FLAGS.has(k) && k === check.value));
});

function set(key: string, value: unknown) {
  const next: StepArgs = { ...props.args };
  if (value === undefined) delete next[key];
  else next[key] = value;
  emit("update", next);
}
const checkOptions = EXPECT_CHECKS.map((c) => ({ value: c, label: CHECK_LABELS[c] }));
function setCheck(c: (typeof EXPECT_CHECKS)[number]) {
  emit("update", withCheck(props.args, c));
}
const choiceOptions = (p: Prop) => [{ value: "", label: "Default" }, ...((p.t === "string" && p.enum) || []).map((e) => ({ value: e, label: e }))];
const targetArg = (k: string) => props.args[k] as Target | undefined;
const idOf = (k: string) => `${props.idBase}-${k}`;
</script>

<template>
  <div class="step-form">
    <div v-if="isExpect" class="row">
      <label class="key" :for="idOf('check')">Check</label>
      <SelectMenu :id="idOf('check')" :model-value="check" :options="checkOptions" class="ctl narrow" @update:model-value="setCheck" />
    </div>
    <div v-for="[key, prop] in fields" :key="key" class="row">
      <label class="key" :for="idOf(key)">
        {{ key === "not" ? "Negate" : key }}<span v-if="prop.required" class="req" aria-hidden="true">*</span>
      </label>
      <div class="ctl">
        <TargetField v-if="controlOf(prop) === 'target'" :id="idOf(key)" :label="key" :model-value="targetArg(key)" @update:model-value="set(key, $event)" />
        <SelectMenu v-else-if="controlOf(prop) === 'choice'" :id="idOf(key)" :model-value="String(args[key] ?? '')" :options="choiceOptions(prop)" class="narrow" @update:model-value="set(key, $event === '' ? undefined : $event)" />
        <ToggleSwitch v-else-if="controlOf(prop) === 'toggle'" :id="idOf(key)" :model-value="args[key] === true" @update:model-value="set(key, $event ? true : undefined)" />
        <p v-else-if="controlOf(prop) === 'json' && args[key] !== undefined && typeof args[key] === 'object'" class="muted small src-only">Set in Source: <code>{{ fieldText(args[key], "json") }}</code></p>
        <TextField v-else :id="idOf(key)" :model-value="fieldText(args[key], controlOf(prop))" :placeholder="controlOf(prop) === 'list' ? 'a, b' : controlOf(prop) === 'match' ? 'text or /regex/' : ''" @update:model-value="set(key, fieldValue($event, controlOf(prop), prop))" />
        <p v-if="prop.doc" class="doc muted small">{{ prop.doc }}</p>
      </div>
    </div>
    <p v-if="def && fields.length === 0 && !isExpect" class="muted small none">This step has nothing to set.</p>
  </div>
</template>

<style scoped>
.step-form {
  display: grid;
  gap: var(--space-3);
}
.row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
  align-items: start;
}
.key {
  padding-top: 7px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.req {
  color: var(--bad);
  margin-left: 2px;
}
.ctl {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.narrow {
  max-width: 240px;
}
.doc,
.none,
.src-only {
  margin: 0;
}
.src-only {
  padding-top: 7px;
}
@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
  }
  .key {
    padding-top: 0;
  }
}
</style>
