<script setup lang="ts">
// The refresh icon for a pack: builds it again from its files now and says what changed.
import { ref } from "vue";
import type { Pack } from "../api";
import { RotateCw } from "../icons";
import { refreshPack } from "../packrefresh";
import { vTip } from "../tooltip";

const props = defineProps<{ pack: Pack }>();
const emit = defineEmits<{ refreshed: [pack: Pack] }>();
const busy = ref(false);

async function run() {
  busy.value = true;
  const after = await refreshPack(props.pack);
  busy.value = false;
  if (after) emit("refreshed", after);
}
</script>

<template>
  <button v-tip="busy ? 'Building the pack…' : 'Build the pack again from its files'" type="button" class="btn icon" :aria-label="`Refresh ${pack.name}`" :aria-busy="busy" :disabled="busy" @click="run">
    <RotateCw :size="15" :class="{ spin: busy }" />
  </button>
</template>

<style scoped>
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
