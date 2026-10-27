<script setup lang="ts">
// The Steps view of a YAML test file: each test's steps as a list of plain summaries with a
// form per step, built from the step list. Every edit changes the file's text through
// stepsdoc.ts, so comments and layout elsewhere stay; v-model is that text. The selected step
// follows `line` (the source view's cursor) and reports its own line back.
import { computed, provide, ref, watch } from "vue";
import { duplicateStep, insertStep, moveStep, readTests, removeStep, replaceStep, stepAtLine, updateStep, type NodePath, type StepNode } from "../stepsdoc";
import { pathKey, STEPS_OPS } from "../stepsops";
import { STEPS, type StepGroup } from "../yamlsteps";
import ModalDialog from "./ModalDialog.vue";
import StepsList from "./StepsList.vue";
import TextField from "./TextField.vue";

const props = defineProps<{ problems: readonly { line: number; message: string }[]; line: number }>();
const text = defineModel<string>({ required: true });
const emit = defineEmits<{ cursor: [line: number] }>();

const tests = computed(() => readTests(text.value));
const selected = ref<string | null>(null);

watch(
  () => [props.line, tests.value] as const,
  ([line, t]) => {
    if (!t) return;
    const s = stepAtLine(t, line);
    if (s && pathKey(s.path) !== selected.value) selected.value = pathKey(s.path);
  },
  { immediate: true },
);

function edit(fn: (t: string) => string) {
  const next = fn(text.value);
  if (next !== text.value) text.value = next;
}

const adding = ref<{ list: NodePath; index: number } | null>(null);
const addOpen = computed({ get: () => adding.value !== null, set: (v: boolean) => !v && (adding.value = null) });
const filter = ref("");
const GROUPS: Record<StepGroup, string> = { go: "Go", act: "Act", wait: "Wait", check: "Check", keep: "Keep", shape: "Shape" };
const choices = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return (Object.keys(GROUPS) as StepGroup[])
    .map((g) => ({ group: GROUPS[g], steps: STEPS.filter((s) => s.group === g && (!q || s.name.toLowerCase().includes(q) || s.doc.toLowerCase().includes(q))) }))
    .filter((g) => g.steps.length > 0);
});
function pick(name: string) {
  const a = adding.value;
  if (!a) return;
  edit((t) => insertStep(t, a.list, a.index, name));
  selected.value = pathKey([...a.list, a.index]);
  const added = tests.value && findByKey(selected.value);
  if (added) emit("cursor", added.line);
  adding.value = null;
  filter.value = "";
}

function findByKey(key: string): StepNode | null {
  let found: StepNode | null = null;
  const walk = (steps: readonly StepNode[]) => {
    for (const s of steps) {
      if (pathKey(s.path) === key) found = s;
      for (const l of s.lists) walk(l.steps);
    }
  };
  for (const t of tests.value ?? []) walk(t.steps.steps);
  return found;
}

provide(STEPS_OPS, {
  selected,
  select(step) {
    selected.value = selected.value === pathKey(step.path) ? null : pathKey(step.path);
    emit("cursor", step.line);
  },
  problemAt(step) {
    // Only the step's own lines, not the steps inside it.
    const inner = step.lists.flatMap((l) => l.steps).map((s) => [s.line, s.endLine] as const);
    return props.problems.find((p) => p.line >= step.line && p.line <= step.endLine && !inner.some(([a, b]) => p.line >= a && p.line <= b))?.message ?? null;
  },
  update: (path, args) => edit((t) => updateStep(t, path, args)),
  replace: (path, name) => edit((t) => replaceStep(t, path, name)),
  remove(path) {
    edit((t) => removeStep(t, path));
    selected.value = null;
  },
  duplicate(path) {
    edit((t) => duplicateStep(t, path));
    const i = path[path.length - 1] as number;
    selected.value = pathKey([...path.slice(0, -1), i + 1]);
  },
  move(listPath, from, to) {
    edit((t) => moveStep(t, listPath, from, to));
    if (selected.value === pathKey([...listPath, from])) selected.value = pathKey([...listPath, to]);
  },
  add(list, index) {
    adding.value = { list, index };
  },
});
</script>

<template>
  <div class="steps-panel">
    <p v-if="!tests" class="muted">The file isn't valid YAML yet, so its steps can't be shown. Fix it in Source; the problems below say where.</p>
    <section v-for="t in tests ?? []" :key="pathKey(t.path)" class="test" :aria-label="`Test ${t.id}`">
      <h3 v-if="(tests?.length ?? 0) > 1 || t.title" class="thead">
        <code>{{ t.id || "(no id)" }}</code> <span>{{ t.title }}</span>
      </h3>
      <StepsList :list="t.steps" :label="`Steps of ${t.id}`" />
    </section>
    <ModalDialog v-model="addOpen" heading="Add a step" width="560px">
      <label class="sr-only" for="add-step-filter">Find a step</label>
      <TextField id="add-step-filter" v-model="filter" type="search" placeholder="Find a step: click, fill, expect…" />
      <div class="choices">
        <section v-for="g in choices" :key="g.group">
          <p class="label">{{ g.group }}</p>
          <ul>
            <li v-for="s in g.steps" :key="s.name">
              <button type="button" class="choice" @click="pick(s.name)">
                <code>{{ s.name }}</code>
                <span class="muted small">{{ s.doc }}</span>
              </button>
            </li>
          </ul>
        </section>
        <p v-if="!choices.length" class="muted small">No step matches.</p>
      </div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.steps-panel {
  display: grid;
  gap: var(--space-5);
  align-content: start;
  padding: var(--space-4);
  min-width: 0;
}
.test {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
.thead {
  margin: 0;
  font-size: 14px;
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}
.choices {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
  max-height: min(60vh, 520px);
  overflow: auto;
}
.choices .label {
  margin: 0 0 var(--space-1);
}
.choices ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
}
.choice {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.choice:hover,
.choice:focus-visible {
  background: var(--hover);
}
.choice code {
  color: var(--accent-text);
}
</style>
