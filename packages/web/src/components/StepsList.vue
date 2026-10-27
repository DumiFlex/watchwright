<script setup lang="ts">
// One list of steps in the Steps view (a test's steps, or the `then` of an `if`): rows with
// the step's icon, summary and line, reordered by dragging. The selected step opens its form
// and tools under its row; steps inside a step show as lists of their own, indented.
import { inject } from "vue";
import { ArrowDown, ArrowUp, Camera, CircleAlert, CircleCheck, CopyPlus, Globe, Hourglass, Layers, MousePointerClick, Plus, Trash2 } from "../icons";
import { STEP_BY_NAME, STEPS, type StepGroup } from "../yamlsteps";
import type { StepList, StepNode } from "../stepsdoc";
import { STEPS_OPS, pathKey } from "../stepsops";
import SelectMenu from "./SelectMenu.vue";
import SortableList from "./SortableList.vue";
import StepForm from "./StepForm.vue";
import { vTip } from "../tooltip";

defineOptions({ name: "StepsList" });
defineProps<{ list: StepList; label: string }>();
const ops = inject(STEPS_OPS)!;

const ICONS: Record<StepGroup, unknown> = { go: Globe, act: MousePointerClick, wait: Hourglass, check: CircleCheck, keep: Camera, shape: Layers };
const iconOf = (s: StepNode) => ICONS[STEP_BY_NAME.get(s.name)?.group ?? "shape"];
const kindOptions = STEPS.map((d) => ({ value: d.name, label: d.name }));
const LIST_LABELS: Record<string, string> = { steps: "Steps", then: "Then", else: "Otherwise" };
</script>

<template>
  <div class="steps-list">
    <SortableList
      v-if="list.steps.length"
      :model-value="list.steps"
      :item-key="(s: StepNode) => pathKey(s.path)"
      :item-label="(s: StepNode) => s.summary"
      :label="label"
      @move="(m) => ops.move(list.path, m.from, m.to)"
    >
      <template #default="{ item: s, index: i }">
        <div class="step" :class="{ selected: ops.selected.value === pathKey(s.path), unknown: !s.known, bad: ops.problemAt(s) }">
          <button type="button" class="head" :aria-expanded="ops.selected.value === pathKey(s.path)" @click="ops.select(s)">
            <component :is="iconOf(s)" class="ico" :size="15" />
            <span class="sum">
              <span v-if="s.comment" class="comment muted small">{{ s.comment }}</span>
              <span class="text">{{ s.summary }}</span>
            </span>
            <CircleAlert v-if="ops.problemAt(s)" class="warn" :size="15" aria-label="Has a problem" />
            <span class="ln num muted small">{{ s.line }}</span>
          </button>
          <p v-if="ops.problemAt(s) && ops.selected.value === pathKey(s.path)" class="problem small" role="alert">{{ ops.problemAt(s) }}</p>
          <div v-if="ops.selected.value === pathKey(s.path)" class="detail">
            <div class="tools">
              <label class="sr-only" :for="`kind-${pathKey(s.path)}`">Step</label>
              <SelectMenu :id="`kind-${pathKey(s.path)}`" :model-value="s.name" :options="kindOptions" class="kind" @update:model-value="ops.replace(s.path, $event)" />
              <span class="grow"></span>
              <button v-tip="'Move up'" type="button" class="btn icon" aria-label="Move up" :disabled="i === 0" @click="ops.move(list.path, i, i - 1)"><ArrowUp :size="15" /></button>
              <button v-tip="'Move down'" type="button" class="btn icon" aria-label="Move down" :disabled="i === list.steps.length - 1" @click="ops.move(list.path, i, i + 1)"><ArrowDown :size="15" /></button>
              <button v-tip="'Duplicate'" type="button" class="btn icon" aria-label="Duplicate" @click="ops.duplicate(s.path)"><CopyPlus :size="15" /></button>
              <button v-tip="'Delete'" type="button" class="btn icon danger" aria-label="Delete" @click="ops.remove(s.path)"><Trash2 :size="15" /></button>
            </div>
            <StepForm v-if="s.known" :name="s.name" :args="s.args" :id-base="`f-${pathKey(s.path)}`" @update="ops.update(s.path, $event)" />
            <p v-else class="muted small">"{{ s.name }}" isn't a step. Pick one above, or fix it in Source.</p>
            <button type="button" class="btn add-after" @click="ops.add(list.path, i + 1)"><Plus :size="15" /> Add a step after this</button>
          </div>
          <div v-for="inner in s.lists" :key="pathKey(inner.path)" class="inner">
            <p class="label">{{ LIST_LABELS[inner.field ?? "steps"] ?? inner.field }}</p>
            <StepsList :list="inner" :label="`${s.summary}: ${inner.field}`" />
          </div>
        </div>
      </template>
    </SortableList>
    <button type="button" class="btn add" @click="ops.add(list.path, list.steps.length)"><Plus :size="15" /> Add a step</button>
  </div>
</template>

<style scoped>
.steps-list {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
/* SortableList draws each row's box and grip; the grip stays at the top of a tall row. */
.steps-list :deep(.entry) {
  align-items: flex-start;
  padding: 3px 4px 3px 2px;
}
.steps-list :deep(.entry .grip) {
  margin-top: 3px;
}
.steps-list :deep(.entry:has(> .body > .step.selected)) {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.steps-list :deep(.entry:has(> .body > .step.bad)) {
  border-color: color-mix(in srgb, var(--bad) 50%, var(--line));
}
.step {
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 6px 6px 6px 4px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius);
}
.head:hover {
  background: var(--hover);
}
.ico {
  flex: none;
  color: var(--accent-text);
}
.unknown .ico,
.unknown .text {
  color: var(--bad);
}
.sum {
  flex: 1;
  min-width: 0;
  display: grid;
}
.text {
  overflow-wrap: anywhere;
}
.comment {
  font-style: italic;
}
.warn {
  flex: none;
  color: var(--bad);
}
.ln {
  flex: none;
  min-width: 2ch;
  text-align: right;
}
.problem {
  margin: 0 6px 8px 27px;
  color: var(--bad);
}
.detail {
  display: grid;
  gap: var(--space-3);
  margin-top: 2px;
  padding: var(--space-3) var(--space-2) var(--space-2) 4px;
  border-top: var(--border-width) solid var(--line);
}
.tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
/* The kind menu gives up width first, so the tool buttons stay on one row at phone width. */
.kind {
  flex: 0 1 160px;
  min-width: 0;
}
.grow {
  flex: 1;
}
.add,
.add-after {
  justify-self: start;
  color: var(--muted);
}
.inner {
  padding: var(--space-1) var(--space-1) var(--space-2) var(--space-5);
}
.inner .label {
  margin: 0 0 var(--space-2);
}
</style>
