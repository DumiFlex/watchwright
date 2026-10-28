<script setup lang="ts">
// The approvals waiting for the person, under the top bar on every page: who asks, what it would
// do, and Approve or Refuse. Approving runs the action as if the person had pressed its button.
import { onBeforeUnmount, ref } from "vue";
import type { Approval } from "../approvals";
import { ago, when } from "../format";
import { ShieldAlert } from "../icons";
import { vTip } from "../tooltip";

defineProps<{ approvals: Approval[]; busy: string | null; /** Not stuck under the top bar (the kit page). */ inline?: boolean }>();
const emit = defineEmits<{ answer: [id: string, approve: boolean] }>();

const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 15_000);
onBeforeUnmount(() => clearInterval(tick));
</script>

<template>
  <section v-if="approvals.length" class="approvals" :class="{ inline }" aria-label="Approvals waiting" aria-live="polite">
    <div v-for="a in approvals" :key="a.id" class="row">
      <ShieldAlert :size="18" class="mark" />
      <p class="what">
        <strong>{{ a.client }}</strong> asks: {{ a.summary }}
        <span v-tip="`Asked ${when(a.createdAt)}. It expires ${when(a.expiresAt)} if nobody answers.`" class="muted small">{{ ago(a.createdAt, now) }}</span>
      </p>
      <div class="buttons">
        <button type="button" class="btn" :disabled="busy === a.id" @click="emit('answer', a.id, false)">Refuse</button>
        <button type="button" class="btn danger" :disabled="busy === a.id" @click="emit('answer', a.id, true)">Approve</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.approvals {
  position: sticky;
  top: 56px;
  z-index: 29;
  display: flex;
  flex-direction: column;
  border-bottom: var(--border-width) solid color-mix(in srgb, var(--warn) 45%, var(--line));
  background: color-mix(in srgb, var(--warn) 10%, var(--surface));
}
.approvals.inline {
  position: static;
  border: var(--border-width) solid color-mix(in srgb, var(--warn) 45%, var(--line));
  border-radius: var(--radius);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-6);
}
.approvals.inline .row {
  padding: var(--space-2) var(--space-3);
}
.row + .row {
  border-top: var(--border-width) solid color-mix(in srgb, var(--warn) 25%, var(--line));
}
.mark {
  flex: none;
  color: var(--warn);
}
.what {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.what .small {
  margin-left: var(--space-2);
  white-space: nowrap;
}
.buttons {
  display: flex;
  flex: none;
  gap: var(--space-2);
}
@media (max-width: 640px) {
  .row {
    flex-wrap: wrap;
    padding: var(--space-3) var(--space-4);
  }
  .what {
    flex-basis: calc(100% - 18px - var(--space-3));
  }
  .buttons {
    margin-left: auto;
  }
}
</style>
