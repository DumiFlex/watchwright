<script setup lang="ts">
// A themed file chooser: a drop zone with a button. The native file input stays hidden and
// only opens the system dialog; dropped files are filtered by `accept` like picked ones.
import { computed, ref } from "vue";

const props = defineProps<{ id?: string; accept?: string; multiple?: boolean; disabled?: boolean }>();
const files = defineModel<File[]>({ default: () => [] });
const input = ref<HTMLInputElement | null>(null);
const over = ref(false);

const summary = computed(() => {
  if (files.value.length === 0) return props.multiple ? "No files chosen" : "No file chosen";
  if (files.value.length === 1) return files.value[0]!.name;
  return `${files.value.length} files`;
});

function accepts(f: File) {
  if (!props.accept) return true;
  return props.accept.split(",").some((raw) => {
    const a = raw.trim().toLowerCase();
    if (a.startsWith(".")) return f.name.toLowerCase().endsWith(a);
    if (a.endsWith("/*")) return f.type.startsWith(a.slice(0, -1));
    return f.type === a;
  });
}
function take(list: FileList | null) {
  const picked = [...(list ?? [])].filter(accepts);
  if (picked.length) files.value = props.multiple ? picked : picked.slice(0, 1);
}
function onDrop(e: DragEvent) {
  over.value = false;
  if (!props.disabled) take(e.dataTransfer?.files ?? null);
}
function size(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
}
</script>

<template>
  <div
    class="fp"
    :class="{ over, disabled }"
    @dragover.prevent="over = !disabled"
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      type="file"
      class="native"
      tabindex="-1"
      aria-hidden="true"
      :accept="accept"
      :multiple="multiple"
      @change="take(($event.target as HTMLInputElement).files)"
    />
    <button :id="id" type="button" class="btn" :disabled="disabled" @click="input?.click()">{{ multiple ? "Choose files" : "Choose file" }}</button>
    <span class="summary" :class="{ muted: files.length === 0 }">{{ summary }}</span>
    <span class="hint muted">or drop {{ multiple ? "them" : "it" }} here</span>
    <ul v-if="multiple && files.length > 1" class="list">
      <li v-for="f in files" :key="f.name"><span>{{ f.name }}</span> <span class="muted num">{{ size(f.size) }}</span></li>
    </ul>
  </div>
</template>

<style scoped>
.fp {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
}
.fp.over {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.fp.disabled {
  opacity: 0.5;
}
.native {
  display: none;
}
.summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--muted);
}
.hint {
  margin-left: auto;
  font-size: 12px;
}
.list {
  flex-basis: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.list li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 2px 0;
}
</style>
