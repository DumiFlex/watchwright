<script setup lang="ts">
// A step's target in the Steps view: how to find the element (a kind menu: role, label, text,
// test id, …) and the value, with the accessible name for a role. Filters the form doesn't show
// (`within`, `nth`, …) are kept and listed; edit them in the source.
import { computed } from "vue";
import { targetOf, targetParts, TARGET_KINDS, type TargetKind } from "../stepform";
import { describeTarget, type Target } from "../yamlsteps";
import CheckBox from "./CheckBox.vue";
import SelectMenu from "./SelectMenu.vue";
import TextField from "./TextField.vue";

const props = defineProps<{ id: string; label: string }>();
const target = defineModel<Target | undefined>({ required: true });

const parts = computed(() => targetParts(target.value));
const extras = computed(() => Object.keys(parts.value.extra));
const extraText = computed(() => (extras.value.length ? describeTarget({ css: "x", ...parts.value.extra }).replace(/^x ?/, "") : ""));

function set(change: Partial<ReturnType<typeof targetParts>>) {
  target.value = targetOf({ ...parts.value, ...change });
}
const kind = computed({ get: () => parts.value.kind, set: (k: TargetKind) => set({ kind: k, ...(k === "role" ? {} : { name: "" }) }) });
const value = computed({ get: () => parts.value.value, set: (v: string) => set({ value: v }) });
const name = computed({ get: () => parts.value.name, set: (v: string) => set({ name: v }) });
const exact = computed({ get: () => parts.value.exact, set: (v: boolean) => set({ exact: v }) });

const placeholders: Record<TargetKind, string> = {
  role: "button",
  label: "Email",
  placeholder: "What needs to be done?",
  text: "Saved",
  testId: "todo-item",
  alt: "Logo",
  title: "Close",
  css: ".cart li",
  selector: "#save",
};
const showsExact = computed(() => !["css", "testId", "selector"].includes(kind.value));
</script>

<template>
  <div class="target-field" role="group" :aria-label="props.label">
    <label class="sr-only" :for="`${id}-kind`">{{ props.label }}: found by</label>
    <SelectMenu :id="`${id}-kind`" v-model="kind" :options="TARGET_KINDS" class="kind" />
    <label class="sr-only" :for="id">{{ props.label }}: {{ kind }}</label>
    <TextField :id="id" v-model="value" class="value" :placeholder="placeholders[kind]" />
    <template v-if="kind === 'role'">
      <label class="sr-only" :for="`${id}-name`">{{ props.label }}: name</label>
      <TextField :id="`${id}-name`" v-model="name" class="value" placeholder="Name (Save)" />
    </template>
    <label v-if="showsExact" class="exact small"><CheckBox v-model="exact" /> Exact</label>
    <p v-if="extras.length" class="extra muted small">Also {{ extraText }} <span class="hint">(edit in Source)</span></p>
  </div>
</template>

<style scoped>
.target-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.kind {
  flex: none;
  width: 130px;
}
.value {
  flex: 1 1 160px;
  min-width: 0;
}
.exact {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.extra {
  flex-basis: 100%;
  margin: 0;
}
.hint {
  opacity: 0.8;
}
</style>
