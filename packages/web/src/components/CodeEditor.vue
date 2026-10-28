<script setup lang="ts">
// An editable code area: CodeMirror 6, loaded in its own chunk the first time one is shown.
// v-model holds the text; `problems` are underlined (and listed by the page); Ctrl+S emits save.
// YAML test files (`steps`) get completion of steps, fields and values, and docs on hover.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EditorHandle, EditorLang, EditorProblem } from "../codemirror";
import SkeletonBlock from "./SkeletonBlock.vue";

const props = withDefaults(
  defineProps<{
    lang: EditorLang;
    label: string;
    steps?: boolean;
    problems?: readonly EditorProblem[];
    readOnly?: boolean;
    placeholder?: string | undefined;
  }>(),
  { steps: false, problems: () => [], readOnly: false, placeholder: undefined },
);
const text = defineModel<string>({ required: true });
const emit = defineEmits<{ save: []; cursor: [line: number] }>();

const host = ref<HTMLElement | null>(null);
const ready = ref(false);
let editor: EditorHandle | null = null;
let destroyed = false;
// A goto asked for before the editor has loaded happens once it has.
let pending: [number, number | undefined] | null = null;

onMounted(async () => {
  const { createEditor } = await import("../codemirror");
  if (destroyed || !host.value) return;
  editor = createEditor(host.value, {
    text: text.value,
    lang: props.lang,
    steps: props.steps,
    readOnly: props.readOnly,
    label: props.label,
    ...(props.placeholder ? { placeholder: props.placeholder } : {}),
    onChange: (t) => (text.value = t),
    onSave: () => emit("save"),
    onCursor: (line) => emit("cursor", line),
  });
  editor.setProblems(props.problems);
  ready.value = true;
  if (pending) editor.goto(...pending);
  pending = null;
});
onBeforeUnmount(() => {
  destroyed = true;
  editor?.destroy();
});

watch(text, (t) => {
  if (editor && editor.text() !== t) editor.setText(t);
});
watch(
  () => props.problems,
  (p) => editor?.setProblems(p),
);
watch(
  () => props.readOnly,
  (r) => editor?.setReadOnly(r),
);

defineExpose({
  goto: (line: number, col?: number) => (editor ? editor.goto(line, col) : (pending = [line, col])),
  focus: () => editor?.focus(),
});
</script>

<template>
  <div class="code-editor" :aria-busy="!ready">
    <SkeletonBlock v-if="!ready" class="wait" :lines="8" />
    <div ref="host" class="host" :class="{ hidden: !ready }"></div>
  </div>
</template>

<style scoped>
.code-editor {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.host {
  height: 100%;
}
.host.hidden {
  visibility: hidden;
}
.wait {
  position: absolute;
  inset: var(--space-3);
}
</style>
