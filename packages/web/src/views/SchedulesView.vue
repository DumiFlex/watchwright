<script setup lang="ts">
// Schedules: runs that start by themselves, every so often or at a time of day. Each card says
// when, what comes next and how the last run went; the form makes and changes them, and a
// schedule's earlier runs open under its card.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type Pack, type Preset } from "../api";
import { ago, countsText, soon, when } from "../format";
import { CalendarClock, Ellipsis, Pause, Play, Plus } from "../icons";
import { LiveConnection } from "../live";
import { emptyForm, formOf, TIMES, whenOf, type Schedule, type ScheduleDetail, type ScheduleRun, type WhenForm } from "../schedules";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import EmptyState from "../components/EmptyState.vue";
import MenuButton from "../components/MenuButton.vue";
import ModalDialog from "../components/ModalDialog.vue";
import MultiSelect from "../components/MultiSelect.vue";
import NumberInput from "../components/NumberInput.vue";
import RadioGroup from "../components/RadioGroup.vue";
import SelectMenu from "../components/SelectMenu.vue";
import SkeletonBlock from "../components/SkeletonBlock.vue";
import StatusChip from "../components/StatusChip.vue";
import TextField from "../components/TextField.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";

const list = ref<Schedule[]>([]);
const packs = ref<Pack[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const now = ref(Date.now());

async function load() {
  const [s, p] = await Promise.all([getJson<Schedule[]>("/api/v1/schedules"), getJson<Pack[]>("/api/v1/packs")]);
  loading.value = false;
  if (!s.ok) return void (loadError.value = s.error.message);
  loadError.value = null;
  list.value = s.data;
  if (p.ok) packs.value = p.data;
  for (const id of Object.keys(history.value)) void loadHistory(id);
}

const packName = (id: string) => packs.value.find((p) => p.id === id)?.name ?? null;

/** A run's outcome: a finished run is as good as its worst attempt. */
function outcome(r: ScheduleRun): string {
  if (r.status !== "finished") return r.status;
  return r.counts.failed ? "failed" : r.counts.broken ? "broken" : "passed";
}

// Earlier runs, per open card.
const history = ref<Record<string, ScheduleDetail["runs"]>>({});
async function loadHistory(id: string) {
  const res = await getJson<ScheduleDetail>(`/api/v1/schedules/${id}`);
  if (res.ok) history.value = { ...history.value, [id]: res.data.runs };
}
function toggleHistory(id: string) {
  if (history.value[id]) {
    history.value = Object.fromEntries(Object.entries(history.value).filter(([k]) => k !== id));
  } else void loadHistory(id);
}

async function act(s: Schedule, what: "run" | "pause" | "resume") {
  const res = await sendJson<{ runId?: string }>(`/api/v1/schedules/${s.id}/${what}`);
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  if (what === "run") toast(`Started a run of "${s.name}".`, { tone: "ok" });
  await load();
}

// The form: new or editing.
const formOpen = ref(false);
const editing = ref<Schedule | null>(null);
const name = ref("");
const packId = ref("");
const timing = ref<WhenForm>(emptyForm());
const tests = ref<string[]>([]);
const preset = ref("");
const missed = ref<"once" | "skip">("once");
const saving = ref(false);
const formError = ref<string | null>(null);
const presets = ref<Preset[]>([]);

const pack = computed(() => packs.value.find((p) => p.id === packId.value) ?? null);
const packOptions = computed(() => packs.value.map((p) => ({ value: p.id, label: p.name })));
const testOptions = computed(() => (pack.value?.tests ?? []).map((t) => ({ value: t.id, label: t.title !== t.id ? `${t.id} · ${t.title}` : t.id, group: t.section ?? "Tests" })));
const presetOptions = computed(() => [{ value: "", label: "None" }, ...presets.value.map((p) => ({ value: p.name, label: p.name }))]);
const modeOptions = [
  { value: "daily" as const, label: "Every day at" },
  { value: "every" as const, label: "Every" },
  { value: "cron" as const, label: "Cron" },
];
const unitOptions = [
  { value: "m" as const, label: "minutes" },
  { value: "h" as const, label: "hours" },
  { value: "d" as const, label: "days" },
];
const missedOptions = [
  { value: "once" as const, label: "Start once when the server is back", note: "However many times were missed, then on as usual" },
  { value: "skip" as const, label: "Skip it", note: "Wait for the next time" },
];

watch(packId, async (id) => {
  presets.value = [];
  if (!id) return;
  const res = await getJson<Preset[]>(`/api/v1/presets?pack=${id}`);
  if (res.ok && packId.value === id) presets.value = res.data;
});

function openForm(s: Schedule | null) {
  editing.value = s;
  formError.value = null;
  name.value = s?.name ?? "";
  packId.value = s?.packId ?? packs.value[0]?.id ?? "";
  timing.value = s ? formOf(s.when) : emptyForm();
  tests.value = s?.run.tests ?? [];
  preset.value = s?.run.preset ?? "";
  missed.value = s?.missed ?? "once";
  formOpen.value = true;
}

async function save() {
  if (!name.value.trim() || !packId.value) return;
  saving.value = true;
  formError.value = null;
  const kept = Object.fromEntries(Object.entries(editing.value?.run ?? {}).filter(([k]) => k !== "tests" && k !== "preset"));
  const run = { ...kept, ...(tests.value.length ? { tests: tests.value } : {}), ...(preset.value ? { preset: preset.value } : {}) };
  const body = { name: name.value.trim(), packId: packId.value, when: whenOf(timing.value), run, missed: missed.value };
  const res = editing.value ? await sendJson<Schedule>(`/api/v1/schedules/${editing.value.id}`, body) : await sendJson<Schedule>("/api/v1/schedules", body);
  saving.value = false;
  if (!res.ok) return void (formError.value = res.error.message);
  formOpen.value = false;
  toast(editing.value ? `Saved "${res.data.name}".` : `"${res.data.name}" starts ${res.data.nextAt ? soon(res.data.nextAt) : "when resumed"}.`, { tone: "ok" });
  await load();
}

// Deleting.
const doomed = ref<Schedule | null>(null);
const deleteOpen = computed({ get: () => doomed.value !== null, set: (v) => (v ? undefined : (doomed.value = null)) });
async function remove() {
  const s = doomed.value;
  doomed.value = null;
  if (!s) return;
  const res = await sendJson(`/api/v1/schedules/${s.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Deleted "${s.name}". Its runs stay.`);
  await load();
}

const menu = (s: Schedule) => [
  { value: "edit", label: "Change…" },
  { value: s.enabled ? "pause" : "resume", label: s.enabled ? "Pause" : "Resume" },
  { value: "delete", label: "Delete…", danger: true },
];
function onMenu(s: Schedule, v: string) {
  if (v === "edit") openForm(s);
  else if (v === "pause" || v === "resume") void act(s, v);
  else if (v === "delete") doomed.value = s;
}

let live: LiveConnection | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  live = new LiveConnection({}, { onEvent: (e) => (e.type.startsWith("schedule.") || e.type === "run.finished") && void load() });
  clock = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => {
  live?.close();
  if (clock) clearInterval(clock);
});
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h1 class="display">Schedules</h1>
        <p class="muted">Runs that start by themselves, every so often or at a time of day, while Watchwright is running. A time that comes round while its last run is still going is skipped.</p>
      </div>
      <button v-if="list.length" type="button" class="btn primary" :disabled="!packs.length" @click="openForm(null)"><Plus :size="15" /> New schedule</button>
    </div>
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>

    <ul v-if="loading" class="scheds" aria-busy="true" aria-label="Loading schedules">
      <li v-for="i in 2" :key="i" class="card sc">
        <SkeletonBlock width="40%" height="1.2em" />
        <SkeletonBlock :lines="2" />
      </li>
    </ul>
    <ul v-else-if="list.length" class="scheds">
      <li v-for="s in list" :key="s.id" class="card sc" :class="{ off: !s.enabled }">
        <div class="top">
          <span class="sname display">{{ s.name }}</span>
          <span v-if="!s.enabled" class="chip muted small"><Pause :size="12" /> Paused</span>
          <MenuButton class="more" :items="menu(s)" :label="`More for ${s.name}`" @select="onMenu(s, $event)">
            <template #button><Ellipsis :size="16" /></template>
          </MenuButton>
        </div>
        <p class="facts small">
          <CalendarClock :size="14" class="muted" />
          <span>{{ s.says }}</span>
          <span class="muted">·</span>
          <a v-if="packName(s.packId)" :href="`#/packs/${s.packId}`">{{ packName(s.packId) }}</a>
          <span v-else class="warn">pack removed</span>
          <span v-if="s.run.tests?.length" class="muted">· {{ s.run.tests.length }} {{ s.run.tests.length === 1 ? "test" : "tests" }}</span>
          <span v-if="s.run.preset" class="muted">· preset {{ s.run.preset }}</span>
        </p>
        <dl class="when small">
          <div>
            <dt class="muted">Next</dt>
            <dd>
              <span v-if="s.enabled && s.nextAt" v-tip="when(s.nextAt)">{{ soon(s.nextAt, now) }}</span>
              <span v-else class="muted">Paused</span>
            </dd>
          </div>
          <div>
            <dt class="muted">Last</dt>
            <dd>
              <template v-if="s.lastRun">
                <StatusChip :status="outcome(s.lastRun)" />
                <a v-tip="when(s.lastRun.createdAt)" :href="`#/runs/${s.lastRun.id}`">{{ ago(s.lastRun.createdAt, now) }}</a>
              </template>
              <span v-else class="muted">Not run yet</span>
            </dd>
          </div>
        </dl>
        <div class="acts">
          <button type="button" class="btn" @click="act(s, 'run')"><Play :size="15" /> Run now</button>
          <button type="button" class="btn" :aria-expanded="!!history[s.id]" @click="toggleHistory(s.id)">{{ history[s.id] ? "Hide runs" : "Runs" }}</button>
        </div>
        <ul v-if="history[s.id]" class="runs small">
          <li v-for="r in history[s.id]" :key="r.runId">
            <StatusChip :status="r.run ? outcome(r.run) : 'deleted'" />
            <a :href="`#/runs/${r.runId}`">{{ r.runId }}</a>
            <span v-tip="when(r.startedAt)" class="muted">{{ ago(r.startedAt, now) }}</span>
            <span v-if="r.run" class="muted counts">{{ countsText(r.run.counts) }}</span>
          </li>
          <li v-if="!history[s.id]!.length" class="muted">No runs yet.</li>
        </ul>
      </li>
    </ul>
    <section v-else-if="!loadError" class="card">
      <EmptyState :icon="CalendarClock" heading="No schedules yet">
        <p>A schedule starts a pack's run by itself: every few hours, or every night at the same time. Its runs show in the runs list with a clock.</p>
        <p v-if="!packs.length">Add a pack first, on the <a href="#/packs">Packs</a> page.</p>
        <template #actions>
          <button type="button" class="btn primary" :disabled="!packs.length" @click="openForm(null)"><Plus :size="15" /> New schedule</button>
        </template>
      </EmptyState>
    </section>

    <ModalDialog v-model="formOpen" :heading="editing ? `Change ${editing.name}` : 'New schedule'" width="560px">
      <form id="sched-form" class="form" @submit.prevent="save">
        <div class="row">
          <label for="sc-name" class="lbl">Name</label>
          <TextField id="sc-name" v-model="name" placeholder="Nightly smoke" />
        </div>
        <div class="row">
          <label for="sc-pack" class="lbl">Pack</label>
          <SelectMenu id="sc-pack" v-model="packId" :options="packOptions" />
        </div>
        <div class="row">
          <span class="lbl">When</span>
          <RadioGroup v-model="timing.mode" :options="modeOptions" label="When" inline />
          <div v-if="timing.mode === 'daily'" class="inline">
            <SelectMenu id="sc-time" v-model="timing.time" :options="TIMES" class="time" />
            <ToggleSwitch id="sc-weekdays" v-model="timing.weekdays">Weekdays only</ToggleSwitch>
          </div>
          <div v-else-if="timing.mode === 'every'" class="inline">
            <NumberInput id="sc-count" v-model="timing.count" label="How many" :min="1" :max="999" />
            <SelectMenu id="sc-unit" v-model="timing.unit" :options="unitOptions" class="unit" />
          </div>
          <div v-else class="inline">
            <label class="sr-only" for="sc-cron">Cron expression</label>
            <TextField id="sc-cron" v-model="timing.cron" class="grow" placeholder="0 9 * * 1-5" />
          </div>
          <p v-if="timing.mode === 'cron'" class="muted small">Minute, hour, day, month, weekday: <code>0 9 * * 1-5</code> is 09:00 on weekdays.</p>
          <div v-if="timing.mode !== 'every'" class="inline">
            <label for="sc-tz" class="muted small">Time zone</label>
            <TextField id="sc-tz" v-model="timing.timezone" class="grow" />
          </div>
        </div>
        <div class="row">
          <label for="sc-tests" class="lbl">Tests</label>
          <MultiSelect id="sc-tests" v-model="tests" :options="testOptions" empty-label="All tests" />
        </div>
        <div v-if="presets.length" class="row">
          <label for="sc-preset" class="lbl">Preset</label>
          <SelectMenu id="sc-preset" v-model="preset" :options="presetOptions" />
          <span class="muted small">Its values and options; the tests above win when you pick some.</span>
        </div>
        <div class="row">
          <span class="lbl">A time missed while Watchwright was off</span>
          <RadioGroup v-model="missed" :options="missedOptions" label="Missed times" />
        </div>
        <p v-if="formError" class="error small" role="alert">{{ formError }}</p>
      </form>
      <template #actions>
        <button type="button" class="btn" @click="formOpen = false">Cancel</button>
        <button type="submit" form="sched-form" class="btn primary" :disabled="saving || !name.trim() || !packId">{{ editing ? "Save" : "Create schedule" }}</button>
      </template>
    </ModalDialog>

    <ModalDialog v-model="deleteOpen" heading="Delete this schedule?">
      <p v-if="doomed">
        <strong>{{ doomed.name }}</strong> stops starting runs. The runs it started stay.
      </p>
      <template #actions>
        <button class="btn" @click="doomed = null">Cancel</button>
        <button class="btn danger" @click="remove">Delete</button>
      </template>
    </ModalDialog>
  </main>
</template>

<style scoped>
.scheds {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));
  align-items: start;
  gap: var(--space-4);
}
.sc {
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-width: 0;
}
.sc p {
  margin: 0;
}
.top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.sname {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.off .sname {
  color: var(--muted);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}
.when {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  margin: 0;
}
.when dt {
  margin-bottom: 2px;
}
.when dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.runs {
  list-style: none;
  margin: 0;
  padding: var(--space-2) 0 0;
  border-top: 1px solid var(--border);
  display: grid;
  gap: var(--space-1);
}
.runs li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.counts {
  margin-left: auto;
}
.warn {
  color: var(--warn);
}
.form {
  display: grid;
  gap: var(--space-4);
}
.row {
  display: grid;
  gap: var(--space-2);
}
.row p {
  margin: 0;
}
.lbl {
  font-weight: 600;
}
.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.grow {
  flex: 1;
  min-width: 160px;
}
.time {
  width: 120px;
}
.unit {
  width: 140px;
}
</style>
