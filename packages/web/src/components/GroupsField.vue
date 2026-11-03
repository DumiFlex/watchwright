<script setup lang="ts">
// Pick groups by name: the ones the server already knows (from users and pack access), plus a
// box to add a new one. Names match without regard to case, so "QA" and "qa" are one group.
import { computed, ref } from "vue";
import { Plus } from "../icons";
import MultiSelect from "./MultiSelect.vue";
import TextField from "./TextField.vue";

const props = withDefaults(defineProps<{ known: readonly string[]; id: string; disabled?: boolean; placeholder?: string }>(), { placeholder: "Pick groups" });
const model = defineModel<string[]>({ default: () => [] });

const options = computed(() => {
  const seen = new Map<string, string>();
  for (const g of [...model.value, ...props.known]) if (!seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((g) => ({ value: g, label: g }));
});

const fresh = ref("");
function add() {
  const name = fresh.value.trim().slice(0, 200);
  if (!name) return;
  const known = options.value.find((o) => o.value.toLowerCase() === name.toLowerCase())?.value ?? name;
  if (!model.value.some((g) => g.toLowerCase() === name.toLowerCase())) model.value = [...model.value, known];
  fresh.value = "";
}
</script>

<template>
  <div class="gf">
    <MultiSelect :id="id" v-model="model" :options="options" :disabled="disabled" :placeholder="placeholder" empty-label="No groups" />
    <div class="new" @keydown.enter.prevent="add">
      <TextField :id="`${id}-new`" v-model="fresh" :disabled="disabled" placeholder="New group" />
      <button type="button" class="btn" :disabled="disabled || !fresh.trim()" @click="add"><Plus :size="14" /> Add</button>
    </div>
  </div>
</template>

<style scoped>
.gf {
  display: grid;
  gap: var(--space-2);
}
.new {
  display: flex;
  gap: var(--space-2);
}
.new :deep(.tf) {
  flex: 1;
  min-width: 0;
}
.new .btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
</style>
