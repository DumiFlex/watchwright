<script setup lang="ts">
// The review of one attempt: a ScoreInput per criterion and a note. It saves by itself a moment
// after each change (as the "web" reviewer). Reviews by others (agents, other clients) show
// below, read only.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getJson, sendJson, type AttemptReviews, type Criterion, type Review, type Score } from "../api";
import { scoreText } from "../review";
import ScoreInput from "./ScoreInput.vue";
import TextArea from "./TextArea.vue";

const props = defineProps<{ runId: string; attemptId: string }>();
const ME = "web";

const criteria = ref<Criterion[]>([]);
const others = ref<Review[]>([]);
const scores = ref<Record<string, Score | null>>({});
const note = ref("");
const state = ref<"loading" | "idle" | "saving" | "saved" | "error">("loading");
const error = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let loadedFor = "";

async function load() {
  flush();
  state.value = "loading";
  const at = props.attemptId;
  const res = await getJson<AttemptReviews>(`/api/v1/runs/${props.runId}/attempts/${at}/review`);
  if (at !== props.attemptId) return;
  if (!res.ok) {
    state.value = "error";
    error.value = res.error.message;
    return;
  }
  criteria.value = res.data.criteria;
  const mine = res.data.reviews.find((r) => r.reviewer === ME);
  others.value = res.data.reviews.filter((r) => r.reviewer !== ME);
  scores.value = Object.fromEntries(res.data.criteria.map((c) => [c.id, mine?.scores[c.id] ?? null]));
  note.value = mine?.note ?? "";
  loadedFor = at;
  state.value = "idle";
}

async function save() {
  timer = null;
  const at = loadedFor;
  state.value = "saving";
  const res = await sendJson<Review>(`/api/v1/runs/${props.runId}/attempts/${at}/review`, { scores: scores.value, note: note.value });
  if (at !== loadedFor) return;
  if (res.ok) {
    state.value = "saved";
    error.value = null;
  } else {
    state.value = "error";
    error.value = res.error.message;
  }
}
function later() {
  if (state.value === "loading") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void save(), 600);
}
/** Saves a pending change now (before moving to another attempt or leaving the page). */
function flush() {
  if (!timer) return;
  clearTimeout(timer);
  void save();
}

watch(() => props.attemptId, () => void load(), { immediate: true });
onBeforeUnmount(flush);

const setScore = (id: string, v: Score | null) => {
  scores.value = { ...scores.value, [id]: v };
  later();
};
const scored = computed(() => criteria.value.filter((c) => scores.value[c.id] !== null && scores.value[c.id] !== undefined).length);
const status = computed(() =>
  ({ loading: "Loading…", idle: scored.value ? "" : "Not reviewed yet", saving: "Saving…", saved: "Saved", error: error.value ?? "Not saved" })[state.value],
);
</script>

<template>
  <section class="card review" aria-labelledby="review-title">
    <header class="head">
      <h2 id="review-title">Review</h2>
      <span class="state small" :class="{ bad: state === 'error' }" role="status">{{ status }}</span>
    </header>
    <div v-for="c in criteria" :key="c.id" class="crit">
      <div class="crit-head">
        <strong>{{ c.title }}</strong>
        <span v-if="c.description" class="muted small">{{ c.description }}</span>
      </div>
      <ScoreInput :criterion="c" :model-value="scores[c.id] ?? null" :disabled="state === 'loading'" @update:model-value="setScore(c.id, $event)" />
    </div>
    <div class="crit">
      <label class="crit-head" for="review-note"><strong>Note</strong></label>
      <TextArea id="review-note" v-model="note" :rows="3" :max-rows="12" placeholder="What stood out" @update:model-value="later" @focusout="flush" />
    </div>
    <p class="muted small keys">Digits score the focused criterion; J and K move to the next and previous attempt.</p>
    <div v-if="others.length" class="others">
      <h3>Other reviewers</h3>
      <div v-for="r in others" :key="r.reviewer" class="other">
        <p class="who"><code>{{ r.reviewer }}</code></p>
        <dl>
          <template v-for="c in criteria" :key="c.id">
            <dt>{{ c.title }}</dt>
            <dd class="num">{{ scoreText(c, r.scores[c.id]) }}</dd>
          </template>
        </dl>
        <p v-if="r.note" class="note">{{ r.note }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.review {
  display: grid;
  gap: var(--space-4);
  align-content: start;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.head h2 {
  margin: 0;
  font-size: 15px;
}
.state {
  color: var(--muted);
}
.state.bad {
  color: var(--bad);
}
.crit {
  display: grid;
  gap: var(--space-2);
}
.crit-head {
  display: grid;
  gap: 2px;
}
.keys {
  margin: 0;
}
.others {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
}
.others h3 {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.other dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px var(--space-3);
  margin: var(--space-1) 0 0;
}
.other dt {
  color: var(--muted);
}
.other dd {
  margin: 0;
}
.who,
.note {
  margin: 0;
}
.note {
  margin-top: var(--space-1);
  white-space: pre-wrap;
}
</style>
