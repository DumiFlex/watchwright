<script setup lang="ts">
// Record: a recording browser on the live view (or in a window on the server's machine), whose
// clicks and typing come back as steps. Each step can switch to another target that picks out the
// same element, or click at the spot that was clicked instead of the element's middle. Check, Wait
// for, Shot and Note add steps by pointing or typing. Done hands the steps to the page; nothing is
// written to the pack here. With `attach`, it shows a session someone else started (an agent
// exploring) instead of starting one: Close leaves it going, Stop ends it.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type WwEvent } from "../api";
import { AppWindow, ArrowLeft, Bot, Camera, CircleCheck, CircleDot, Crosshair, Hourglass, KeyRound, RotateCw, Send, StickyNote, Trash2 } from "../icons";
import { LiveConnection } from "../live";
import type { ViewInput } from "../liveinput";
import { targetLabel, type RecordEntry, type RecordState } from "../recording";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import { summarize, type StepArgs, type Target } from "../yamlsteps";
import CheckBox from "./CheckBox.vue";
import LiveViewer from "./LiveViewer.vue";
import ModalDialog from "./ModalDialog.vue";
import NumberInput from "./NumberInput.vue";
import SelectMenu from "./SelectMenu.vue";
import TextField from "./TextField.vue";

const props = defineProps<{
  packId: string;
  testId: string | null;
  /** How many of the test's steps run first (Record from here). */
  replay: number;
  /** In a code test: run it up to this line first. */
  line?: number | null;
  window: boolean;
  params: Record<string, unknown>;
  /** A session to show rather than start: an agent's. */
  attach?: string | null;
}>();
const emit = defineEmits<{ done: [steps: { name: string; args: StepArgs }[]]; cancel: [] }>();

const state = ref<RecordState | null>(null);
const startError = ref<string | null>(null);
const viewer = ref<InstanceType<typeof LiveViewer> | null>(null);
const steps = computed(() => state.value?.steps ?? []);
let live: LiveConnection | null = null;

const STATUS_TEXT: Record<RecordState["status"], string> = {
  waiting: "Waiting for the site",
  starting: "Opening the browser…",
  replaying: "Running the test up to the cursor…",
  recording: "Recording",
  ended: "Ended",
};

function onEvent(e: WwEvent) {
  const s = state.value;
  if (!s || e.runId !== s.id) return;
  const d = e.data;
  switch (e.type) {
    case "record.status":
      s.status = d.status as RecordState["status"];
      s.message = (d.message as string | null) ?? null;
      break;
    case "record.step": {
      const step = d.step as RecordEntry;
      if (!s.steps.some((x) => x.id === step.id)) s.steps.splice(d.index as number, 0, step);
      break;
    }
    case "record.step-updated": {
      const step = d.step as RecordEntry;
      const i = s.steps.findIndex((x) => x.id === step.id);
      if (i >= 0) s.steps[i] = step;
      break;
    }
    case "record.step-removed":
      s.steps = s.steps.filter((x) => x.id !== d.id);
      break;
    case "record.ended":
      s.status = "ended";
      s.message = (d.message as string | null) ?? s.message;
      break;
    case "page.opened":
      if (!s.pages.some((p) => p.id === d.pageId)) s.pages.push({ id: d.pageId as string, url: d.url as string });
      break;
    case "page.navigated": {
      const p = s.pages.find((x) => x.id === d.pageId);
      if (p) p.url = d.url as string;
      if (d.pageId === s.activePage) address.value = p?.url ?? address.value;
      break;
    }
    case "page.closed":
      s.pages = s.pages.filter((p) => p.id !== d.pageId);
      break;
    case "page.active":
      s.activePage = d.pageId as string;
      address.value = s.pages.find((p) => p.id === d.pageId)?.url ?? address.value;
      break;
  }
}

onMounted(async () => {
  const res = props.attach ? await getJson<RecordState>(`/api/v1/record/${props.attach}`) : await sendJson<RecordState>("/api/v1/record", { packId: props.packId, ...(props.testId ? { testId: props.testId } : {}), replay: props.replay, ...(props.line ? { line: props.line } : {}), window: props.window, params: props.params });
  if (!res.ok) {
    startError.value = res.error.message;
    return;
  }
  state.value = res.data;
  live = new LiveConnection({ runId: res.data.id, frames: true, after: 0 }, { onEvent, onFrame: (h, jpeg) => void viewer.value?.push(h, jpeg) });
  // Events before the socket subscribed are replayed from 0; fetch once more in case of a gap.
  const again = await getJson<RecordState>(`/api/v1/record/${res.data.id}`);
  if (again.ok && state.value) state.value = { ...again.data, steps: again.data.steps.length >= state.value.steps.length ? again.data.steps : state.value.steps };
});

let closed = false;
const agent = computed(() => (state.value && state.value.startedBy !== "web" ? state.value.startedBy : null));
const badgeText = computed(() => (agent.value && state.value?.status === "recording" ? `${agent.value} is exploring` : STATUS_TEXT[state.value?.status ?? "starting"]));
/** Watching an agent's session: leave it going. */
function close() {
  closed = true;
  emit("cancel");
}
async function finish(keep: boolean) {
  const s = state.value;
  closed = true;
  if (!s) return keep ? emit("done", []) : emit("cancel");
  const res = await sendJson<RecordState>(`/api/v1/record/${s.id}/stop`);
  const final = res.ok ? res.data.steps : s.steps;
  if (keep) emit("done", final.map((x) => ({ name: x.name, args: x.args })));
  else emit("cancel");
}
onBeforeUnmount(() => {
  live?.close();
  // Leaving the page ends the recording too, unless it is someone else's.
  if (!closed && !props.attach && state.value && state.value.status !== "ended") void sendJson(`/api/v1/record/${state.value.id}/stop`);
});

// Input from the live view, sent one at a time in order (a press must land before its release).
// A move, release or wheel answers with the element under the pointer, which the view outlines
// until the pointer leaves (an answer that comes back after that is dropped).
let queue: Promise<unknown> = Promise.resolve();
const hover = ref<{ box: { x: number; y: number; width: number; height: number }; label: string } | null>(null);
let left = 0;
function send(input: ViewInput | { type: "goto"; url: string } | { type: "back" | "reload" }) {
  const s = state.value;
  if (!s || s.status !== "recording") return;
  const at = left;
  queue = queue.then(async () => {
    const res = await sendJson<{ hover: { box: { x: number; y: number; width: number; height: number }; tag: string; target: Target | null } | null }>(`/api/v1/record/${s.id}/input`, input);
    if (!res.ok && input.type !== "move") toast(res.error.message, { tone: "bad" });
    if (res.ok && at === left && input.type !== "key" && input.type !== "text" && input.type !== "down") {
      const h = res.data.hover;
      hover.value = h ? { box: h.box, label: h.target ? targetLabel(h.target) : h.tag } : null;
    }
  });
}
function onLeave() {
  left++;
  hover.value = null;
}
const address = ref("");
function goAddress() {
  const url = address.value.trim();
  if (url) send({ type: "goto", url });
}
const typed = ref("");
function sendTyped(enter: boolean) {
  if (typed.value) send({ type: "text", text: typed.value });
  if (enter) send({ type: "key", key: "Enter" });
  typed.value = "";
}
function choosePage(pageId: string) {
  const s = state.value;
  if (s) void sendJson(`/api/v1/record/${s.id}/page`, { pageId });
}

// Changing a step: its target, the spot, or removing it.
async function update(step: RecordEntry, args: StepArgs) {
  const s = state.value;
  if (!s) return;
  const res = await sendJson<RecordEntry>(`/api/v1/record/${s.id}/steps/${step.id}`, { args });
  if (!res.ok) toast(res.error.message, { tone: "bad" });
}
function targetIndex(step: RecordEntry): number {
  const t = JSON.stringify(step.args.target);
  return Math.max(0, step.targets.findIndex((x) => JSON.stringify(x) === t));
}
const targetOptions = (step: RecordEntry) => step.targets.map((t, i) => ({ value: i, label: targetLabel(t) }));
function setTarget(step: RecordEntry, i: number) {
  const t = step.targets[i];
  if (t !== undefined) void update(step, { ...step.args, target: t });
}
const hasSpot = (step: RecordEntry) => (step.name === "click" || step.name === "dblclick") && (step.spot !== null || step.args.position !== undefined);
const atSpot = (step: RecordEntry) => step.args.position !== undefined;
function setSpot(step: RecordEntry, on: boolean) {
  const rest: StepArgs = { ...step.args };
  delete rest.position;
  void update(step, on && step.spot ? { ...rest, position: step.spot } : rest);
}
async function remove(step: RecordEntry) {
  const s = state.value;
  if (s) await sendJson(`/api/v1/record/${s.id}/steps/${step.id}`, {}, "DELETE");
}
const label = (step: RecordEntry) => {
  try {
    return summarize(step);
  } catch {
    return step.name;
  }
};

// Save sign-in: the browser's cookies and local storage become the site's sign-in (Settings > Sign-ins).
const savingSignIn = ref(false);
async function saveSignIn() {
  const s = state.value;
  if (!s) return;
  savingSignIn.value = true;
  const res = await sendJson<{ siteKey: string }>(`/api/v1/record/${s.id}/sign-in`);
  savingSignIn.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Saved the sign-in for ${res.data.siteKey}. Runs with Start signed in use it.`, { tone: "ok" });
}

// Tools: Check and Wait for point at an element; Shot and Note ask for a name or a text.
type Tool = "check" | "waitFor" | null;
const picking = ref<Tool>(null);
interface Picked {
  targets: Target[];
  info: { text: string; value: string | null; checked: boolean | null; tag: string };
  /** Targets that match it and the others like it, for "How many there are". */
  groups: { target: Target; count: number }[];
}
const picked = ref<Picked | null>(null);
const pickedTool = ref<Tool>(null);
const pickTarget = ref(0);
const check = ref<"visible" | "text" | "value" | "checked" | "hidden" | "count">("visible");
const expected = ref("");
const pickGroup = ref(0);
const expectedCount = ref(1);
watch(pickGroup, (i) => (expectedCount.value = picked.value?.groups[i]?.count ?? expectedCount.value));
const waitState = ref<"visible" | "hidden">("visible");
async function onPick(p: { x: number; y: number }) {
  const s = state.value;
  const tool = picking.value;
  picking.value = null;
  if (!s || !tool) return;
  const res = await sendJson<Picked>(`/api/v1/record/${s.id}/pick`, p);
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  if (res.data.targets.length === 0) return void toast("That element has no target that picks it out alone. Try its label or a nearby button.", { tone: "bad" });
  picked.value = res.data;
  pickedTool.value = tool;
  pickTarget.value = 0;
  pickGroup.value = 0;
  expectedCount.value = res.data.groups[0]?.count ?? 1;
  const i = res.data.info;
  check.value = i.checked !== null ? "checked" : i.value !== null ? "value" : i.text ? "text" : "visible";
  expected.value = i.value ?? i.text.slice(0, 80);
}
const checkOptions = computed(() => {
  const i = picked.value?.info;
  return [
    { value: "visible" as const, label: "Is visible" },
    { value: "hidden" as const, label: "Is hidden" },
    ...(i?.text ? [{ value: "text" as const, label: "Has the text" }] : []),
    ...(i?.value !== null && i?.value !== undefined ? [{ value: "value" as const, label: "Has the value" }] : []),
    ...(i?.checked !== null && i?.checked !== undefined ? [{ value: "checked" as const, label: i.checked ? "Is checked" : "Isn't checked" }] : []),
    ...(picked.value?.groups.length ? [{ value: "count" as const, label: `Is one of ${picked.value.groups[0]!.count} like it` }] : []),
  ];
});
const pickOpen = computed({ get: () => picked.value !== null, set: (v: boolean) => !v && (picked.value = null) });
async function addStep(name: string, args: StepArgs, targets: Target[] = []) {
  const s = state.value;
  if (!s) return;
  const res = await sendJson(`/api/v1/record/${s.id}/steps`, { name, args, targets });
  if (!res.ok) toast(res.error.message, { tone: "bad" });
}
function addPicked() {
  const p = picked.value;
  if (!p) return;
  const target = p.targets[pickTarget.value] ?? p.targets[0]!;
  const others = p.targets.filter((t) => t !== target);
  const group = p.groups[pickGroup.value];
  if (pickedTool.value === "check" && check.value === "count" && group) void addStep("expect", { target: group.target, count: expectedCount.value }, p.groups.filter((g) => g !== group).map((g) => g.target));
  else if (pickedTool.value === "waitFor") void addStep("waitFor", { target, ...(waitState.value === "hidden" ? { state: "hidden" } : {}) }, others);
  else {
    const c = check.value;
    const args: StepArgs = { target };
    if (c === "text") args.text = expected.value;
    else if (c === "value") args.value = expected.value;
    else if (c === "checked") Object.assign(args, { checked: true }, p.info.checked ? {} : { not: true });
    else args[c] = true;
    void addStep("expect", args, others);
  }
  picked.value = null;
}
const askFor = ref<"shot" | "note" | null>(null);
const askText = ref("");
const askOpen = computed({ get: () => askFor.value !== null, set: (v: boolean) => !v && (askFor.value = null) });
function startAsk(kind: "shot" | "note") {
  askFor.value = kind;
  askText.value = kind === "shot" ? `shot-${steps.value.filter((x) => x.name === "shot").length + 1}` : "";
}
function addAsked() {
  const v = askText.value.trim();
  if (!v || !askFor.value) return;
  void addStep(askFor.value, askFor.value === "shot" ? { name: v } : { text: v });
  askFor.value = null;
}

const recording = computed(() => state.value?.status === "recording");
</script>

<template>
  <div class="record">
    <p v-if="startError" class="error" role="alert">{{ startError }}</p>
    <div v-else class="layout">
      <section class="view" aria-label="Recording browser">
        <div class="status" role="status">
          <span class="badge" :class="[state?.status ?? 'starting', { agent }]"><component :is="agent ? Bot : CircleDot" :size="14" />{{ badgeText }}</span>
          <span v-if="state?.message" class="muted small msg">{{ state.message }}</span>
        </div>
        <div v-if="!state?.window" class="urlbar">
          <button v-tip="'Back'" type="button" class="btn icon" aria-label="Back" :disabled="!recording" @click="send({ type: 'back' })"><ArrowLeft :size="15" /></button>
          <button v-tip="'Reload'" type="button" class="btn icon" aria-label="Reload" :disabled="!recording" @click="send({ type: 'reload' })"><RotateCw :size="15" /></button>
          <form class="addr" @submit.prevent="goAddress">
            <label class="sr-only" for="rec-address">Address</label>
            <TextField id="rec-address" v-model="address" type="url" placeholder="Address, or a path on the site" :disabled="!recording" />
          </form>
        </div>
        <LiveViewer
          v-if="state && !state.window"
          ref="viewer"
          :pages="state.pages"
          :active-page-id="state.activePage"
          :running="state.status !== 'ended'"
          interactive
          :picking="picking !== null"
          :hover="hover"
          @input="send"
          @leave="onLeave"
          @pick="onPick"
          @choose-page="choosePage"
        />
        <div v-else-if="state?.window" class="window-note">
          <AppWindow :size="22" />
          <p>The browser is open in a window on the machine Watchwright runs on. Click and type there; the steps show up here.</p>
        </div>
        <p v-if="picking" class="pickhint small" role="status"><Crosshair :size="14" /> Click the element to {{ picking === "check" ? "check" : "wait for" }}. <button type="button" class="link" @click="picking = null">Cancel</button></p>
        <div class="tools">
          <button type="button" class="btn" :class="{ on: picking === 'check' }" :disabled="!recording || state?.window" @click="picking = picking === 'check' ? null : 'check'"><CircleCheck :size="15" /> Check</button>
          <button type="button" class="btn" :class="{ on: picking === 'waitFor' }" :disabled="!recording || state?.window" @click="picking = picking === 'waitFor' ? null : 'waitFor'"><Hourglass :size="15" /> Wait for</button>
          <button type="button" class="btn" :disabled="!state || state.status === 'ended'" @click="startAsk('shot')"><Camera :size="15" /> Shot</button>
          <button type="button" class="btn" :disabled="!state || state.status === 'ended'" @click="startAsk('note')"><StickyNote :size="15" /> Note</button>
          <button v-tip="'Save the cookies and local storage, so runs can start signed in'" type="button" class="btn" :disabled="!recording || savingSignIn" @click="saveSignIn"><KeyRound :size="15" /> Save sign-in</button>
        </div>
        <form v-if="!state?.window" class="typebox" @submit.prevent="sendTyped(false)">
          <label class="sr-only" for="rec-type">Type into the page</label>
          <TextField id="rec-type" v-model="typed" class="grow-field" placeholder="Type into the page (for phones and pasting)" :disabled="!recording" />
          <button v-tip="'Type it'" type="submit" class="btn icon" aria-label="Type it" :disabled="!recording || !typed"><Send :size="15" /></button>
          <button type="button" class="btn" :disabled="!recording" @click="sendTyped(true)">Enter</button>
        </form>
      </section>

      <section class="steps" aria-label="Recorded steps">
        <p class="label">Steps <span class="muted">{{ steps.length }}</span></p>
        <p v-if="!steps.length" class="muted small">Click and type on the page. Each action shows here as a step.</p>
        <ol class="list">
          <li v-for="(s, i) in steps" :key="s.id" class="step">
            <div class="row">
              <span class="n num muted small">{{ i + 1 }}</span>
              <span class="sum">{{ label(s) }}</span>
              <button v-tip="'Remove'" type="button" class="btn icon ghost" aria-label="Remove this step" @click="remove(s)"><Trash2 :size="14" /></button>
            </div>
            <div v-if="s.targets.length > 1 || hasSpot(s)" class="alts">
              <template v-if="s.targets.length > 1">
                <label class="sr-only" :for="`alt-${s.id}`">Target</label>
                <SelectMenu :id="`alt-${s.id}`" :model-value="targetIndex(s)" :options="targetOptions(s)" class="alt" @update:model-value="setTarget(s, $event)" />
              </template>
              <label v-if="hasSpot(s)" class="spot small">
                <CheckBox :model-value="atSpot(s)" @update:model-value="setSpot(s, $event)" />
                At the spot clicked<span v-if="s.spot" class="muted"> ({{ s.spot.x }}, {{ s.spot.y }})</span>
              </label>
            </div>
          </li>
        </ol>
      </section>
    </div>
    <div v-if="attach" class="actions">
      <span class="muted small hint">{{ state?.status === "ended" ? "The session ended." : `Steps ${agent ?? "the agent"} runs and those you click land in its list.` }}</span>
      <button type="button" class="btn" @click="close">Close</button>
      <button type="button" class="btn danger" :disabled="!state || state.status === 'ended'" @click="finish(false)">Stop the session</button>
    </div>
    <div v-else class="actions">
      <span class="muted small hint">{{ state?.status === "ended" ? "The recording browser closed." : "Nothing is written until Done." }}</span>
      <button type="button" class="btn" @click="finish(false)">Cancel</button>
      <button type="button" class="btn primary" :disabled="!state" @click="finish(true)">Done{{ steps.length ? `, add ${steps.length} ${steps.length === 1 ? "step" : "steps"}` : "" }}</button>
    </div>

    <ModalDialog v-model="pickOpen" :heading="pickedTool === 'waitFor' ? 'Wait for' : 'Check'" width="460px">
      <form v-if="picked" class="form" @submit.prevent="addPicked">
        <template v-if="pickedTool === 'check' && check === 'count'">
          <label class="field-label" for="pick-group">Elements</label>
          <SelectMenu id="pick-group" v-model="pickGroup" :options="picked.groups.map((g, i) => ({ value: i, label: `${targetLabel(g.target)} (${g.count} now)` }))" />
        </template>
        <template v-else>
          <label class="field-label" for="pick-target">Element</label>
          <SelectMenu id="pick-target" v-model="pickTarget" :options="picked.targets.map((t, i) => ({ value: i, label: targetLabel(t) }))" />
        </template>
        <template v-if="pickedTool === 'check'">
          <label class="field-label" for="pick-check">Check that it</label>
          <SelectMenu id="pick-check" v-model="check" :options="checkOptions" />
          <template v-if="check === 'count'">
            <label class="field-label" for="pick-count">How many</label>
            <NumberInput id="pick-count" v-model="expectedCount" label="How many" :min="0" />
          </template>
          <template v-if="check === 'text' || check === 'value'">
            <label class="field-label" for="pick-expected">{{ check === "text" ? "Text" : "Value" }}</label>
            <TextField id="pick-expected" v-model="expected" />
          </template>
        </template>
        <template v-else>
          <label class="field-label" for="pick-state">Until it is</label>
          <SelectMenu
            id="pick-state"
            v-model="waitState"
            :options="[
              { value: 'visible', label: 'Visible' },
              { value: 'hidden', label: 'Hidden' },
            ]"
          />
        </template>
      </form>
      <template #actions>
        <button type="button" class="btn" @click="picked = null">Cancel</button>
        <button type="button" class="btn primary" @click="addPicked">Add the step</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="askOpen" :heading="askFor === 'shot' ? 'Screenshot' : 'Note'" width="440px">
      <form class="form" @submit.prevent="addAsked">
        <label class="field-label" for="ask-text">{{ askFor === "shot" ? "Name" : "Note for the people who review the result" }}</label>
        <TextField id="ask-text" v-model="askText" />
      </form>
      <template #actions>
        <button type="button" class="btn" @click="askFor = null">Cancel</button>
        <button type="button" class="btn primary" :disabled="!askText.trim()" @click="addAsked">Add the step</button>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.record {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--space-4);
  align-items: start;
}
.view {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
/* The picture gives up height first, so Done stays on screen in a short window. */
.view :deep(.screen) {
  width: 100%;
  max-height: max(240px, calc(100dvh - 2 * var(--space-8) - 330px));
}
.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 8px;
  border-radius: 999px;
  background: var(--hover);
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
}
.badge.recording {
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  color: var(--bad);
}
.badge.recording.agent {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.badge.waiting,
.badge.replaying {
  background: color-mix(in srgb, var(--warn) 16%, transparent);
  color: var(--warn);
}
.msg {
  min-width: 0;
  overflow-wrap: anywhere;
}
.urlbar,
.typebox {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.addr,
.grow-field {
  flex: 1;
  min-width: 0;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.btn.on {
  border-color: var(--accent);
  color: var(--accent-text);
  box-shadow: 0 0 0 1px var(--accent);
}
.btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}
.pickhint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--accent-text);
}
.link {
  border: 0;
  background: none;
  color: var(--accent-text);
  text-decoration: underline;
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.window-note {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-4);
  border: var(--border-width) dashed var(--line);
  border-radius: var(--radius);
  color: var(--muted);
  text-align: center;
}
.window-note p {
  margin: 0;
  max-width: 420px;
}
.steps {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  max-height: min(70vh, 640px);
  overflow: auto;
  min-width: 0;
}
.steps .label {
  margin: 0;
}
.list {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.step {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.n {
  flex: none;
  min-width: 2ch;
  padding-top: 1px;
  text-align: right;
}
.sum {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.alts {
  display: grid;
  gap: var(--space-2);
  padding-left: calc(2ch + var(--space-2));
}
.alt {
  min-width: 0;
}
.spot {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}
.hint {
  margin-right: auto;
}
.form {
  display: grid;
  gap: var(--space-2);
}
.form p {
  margin: var(--space-1) 0 0;
}
@media (max-width: 860px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .steps {
    max-height: none;
  }
}
@media (max-width: 560px) {
  .tools {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .actions .hint {
    flex: 1 1 100%;
  }
}
</style>
