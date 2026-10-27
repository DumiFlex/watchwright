<script setup lang="ts">
// A source file reference (a test file, a build error's spot, a stack frame) that opens in the
// editor chosen in Settings, at its line. With no editor chosen it's plain text.
import { computed, onMounted } from "vue";
import { editorName, editorUrl } from "../editor";
import { loadSettings, settings } from "../settings";
import { vTip } from "../tooltip";

const props = defineProps<{ file: string; line?: number | undefined; column?: number | undefined; label?: string | undefined }>();
onMounted(() => void loadSettings());
const editor = computed(() => settings.values["settings.editor"]);
const url = computed(() => editorUrl(editor.value, props.file, props.line, props.column));
const text = computed(() => (props.label ?? props.file) + (props.line ? `:${props.line}` : ""));
</script>

<template>
  <a v-if="url" v-tip="`Open in ${editorName(editor)}`" class="fl" :href="url"><code>{{ text }}</code></a>
  <code v-else class="fl">{{ text }}</code>
</template>

<style scoped>
a.fl {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--line-strong);
  text-underline-offset: 3px;
}
a.fl:hover {
  color: var(--accent-text);
  text-decoration-color: currentColor;
}
</style>
