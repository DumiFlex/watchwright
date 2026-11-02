<script setup lang="ts">
// Changes a going run's settings. They take effect from the next attempt; a new pause limit
// applies at once to a broken pause that is going.
import { ref, watch } from "vue";
import { sendJson, type RunDetail, type RunSettings } from "../api";
import ModalDialog from "./ModalDialog.vue";
import NumberInput from "./NumberInput.vue";
import RadioGroup from "./RadioGroup.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const props = defineProps<{ runId: string; settings: RunSettings | null }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ saved: [run: RunDetail] }>();

const pauseOnBroken = ref(true);
const pauseLimit = ref(20);
const ownLimit = ref(false);
const testLimit = ref(30);
const trace = ref<RunSettings["trace"]>("problems");
const video = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

// Each time it opens, it starts from the settings in effect.
watch(open, (o) => {
  if (!o || !props.settings) return;
  const s = props.settings;
  pauseOnBroken.value = s.pauseOnBroken;
  pauseLimit.value = Math.round(s.pauseLimitMinutes * 100) / 100;
  ownLimit.value = s.testTimeoutMinutes !== null;
  testLimit.value = s.testTimeoutMinutes ?? 30;
  trace.value = s.trace;
  video.value = s.video;
  error.value = null;
});

const traceOptions = [
  { value: "problems" as const, label: "Only on problems", note: "Keep a trace when an attempt fails or breaks" },
  { value: "always" as const, label: "Always", note: "Large for long tests" },
  { value: "never" as const, label: "Never" },
];

async function save() {
  const s = props.settings;
  if (!s) return;
  // Only what changed, so the run's log says what someone changed.
  const body: Record<string, unknown> = {};
  if (pauseOnBroken.value !== s.pauseOnBroken) body.pauseOnBroken = pauseOnBroken.value;
  if (pauseLimit.value !== Math.round(s.pauseLimitMinutes * 100) / 100) body.pauseLimitMinutes = pauseLimit.value;
  const limit = ownLimit.value ? testLimit.value : null;
  if (limit !== s.testTimeoutMinutes) body.testTimeoutMinutes = limit ?? 0;
  if (trace.value !== s.trace) body.trace = trace.value;
  if (video.value !== s.video) body.video = video.value;
  if (Object.keys(body).length === 0) return void (open.value = false);
  busy.value = true;
  error.value = null;
  const res = await sendJson<RunDetail>(`/api/v1/runs/${props.runId}/settings`, body);
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  emit("saved", res.data);
  open.value = false;
}
</script>

<template>
  <ModalDialog v-model="open" heading="Run settings" width="480px">
    <p class="muted small">Changes apply from the next test and stay with the run, also when it resumes.</p>
    <div class="opts">
      <div class="opt">
        <span class="name">When a test breaks</span>
        <ToggleSwitch id="rs-pause" v-model="pauseOnBroken">Pause and wait for Retry or Skip</ToggleSwitch>
        <div v-if="pauseOnBroken" class="inline">
          <span class="muted small">Skip by itself after</span>
          <NumberInput id="rs-limit" v-model="pauseLimit" label="Minutes before it skips" :min="1" :max="1440" />
          <span class="muted small">min</span>
        </div>
        <span v-if="pauseOnBroken" class="muted small">A pause that is going now gets the new limit at once, counted from when it began.</span>
      </div>
      <div class="opt">
        <span class="name">Time limit per test</span>
        <ToggleSwitch id="rs-own" v-model="ownLimit">Same limit for every test</ToggleSwitch>
        <div v-if="ownLimit" class="inline">
          <NumberInput id="rs-test-limit" v-model="testLimit" label="Minutes per test" :min="1" :max="1440" />
          <span class="muted small">min</span>
        </div>
        <span class="muted small">{{ ownLimit ? "Also for the test that is running, over each test's own limit." : "Each test's own limit, else the pack's." }}</span>
      </div>
      <div class="opt">
        <span class="name">Trace</span>
        <RadioGroup v-model="trace" :options="traceOptions" label="Trace" />
      </div>
      <div class="opt">
        <span class="name">Video</span>
        <ToggleSwitch id="rs-video" v-model="video">Record a video of each attempt</ToggleSwitch>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template #actions>
      <button class="btn" :disabled="busy" @click="open = false">Cancel</button>
      <button class="btn primary" :disabled="busy || !settings" @click="save">{{ busy ? "Saving…" : "Save" }}</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.opts {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-3);
}
.opt {
  display: grid;
  align-content: start;
  gap: var(--space-2);
}
.name {
  font-weight: 600;
}
.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
</style>
