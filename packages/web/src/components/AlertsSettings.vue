<script setup lang="ts">
// Settings > Alerts: channels (a webhook, ntfy, Discord or Slack) and the rules that send to them
// when runs end a certain way, pass again, a test breaks, a schedule misses a time or an agent
// waits for approval. The server never sends a channel's URL or token back, only its site.
import { computed, onMounted, ref } from "vue";
import { getJson, sendJson, type Pack } from "../api";
import { ago } from "../format";
import { Bell, Pencil, Plus, Send, Trash2 } from "../icons";
import { join, ruleSays as says, type Rule } from "../alerts";
import type { Schedule } from "../schedules";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import CheckBox from "./CheckBox.vue";
import ModalDialog from "./ModalDialog.vue";
import MultiSelect from "./MultiSelect.vue";
import RadioGroup from "./RadioGroup.vue";
import TextField from "./TextField.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

type ChannelType = "webhook" | "ntfy" | "discord" | "slack";
interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  url: string;
  hasToken: boolean;
}
interface Delivery {
  id: number;
  at: string;
  ruleName: string;
  channelName: string;
  title: string;
  runId: string | null;
  status: "sending" | "sent" | "failed";
  tries: number;
  error: string | null;
}

const TYPES: { value: ChannelType; label: string; note: string }[] = [
  { value: "ntfy", label: "ntfy", note: "A topic on ntfy.sh or your own server; the ntfy app shows it on your phone" },
  { value: "discord", label: "Discord", note: "A channel's webhook (Edit channel > Integrations > Webhooks)" },
  { value: "slack", label: "Slack", note: "An incoming webhook of a Slack app" },
  { value: "webhook", label: "Webhook", note: "A JSON POST to any address, for your own scripts" },
];
/** Triggers about how a run ended, the ones "only on change" is about. */
const RUN_TRIGGERS = new Set(["failed", "broken", "failed_to_start", "recovered", "passed", "stopped", "test_broken"]);
const TYPE_NAMES: Record<ChannelType, string> = { ntfy: "ntfy", discord: "Discord", slack: "Slack", webhook: "Webhook" };
const PLACEHOLDERS: Record<ChannelType, string> = {
  ntfy: "https://ntfy.sh/my-watchwright-alerts",
  discord: "https://discord.com/api/webhooks/…",
  slack: "https://hooks.slack.com/services/…",
  webhook: "https://example.com/hooks/watchwright",
};
const TRIGGERS: { value: string; label: string; note?: string }[] = [
  { value: "failed", label: "A run fails" },
  { value: "broken", label: "A run ends with broken tests" },
  { value: "failed_to_start", label: "A run doesn't start" },
  { value: "recovered", label: "A run passes again", note: "After the last run of the pack or schedule didn't" },
  { value: "passed", label: "A run passes" },
  { value: "stopped", label: "A run is stopped" },
  { value: "test_broken", label: "A test breaks", note: "While the run is still going" },
  { value: "schedule_missed", label: "A schedule misses a time", note: "Missed while Watchwright was off, or skipped because its last run was still going" },
  { value: "approval", label: "An agent waits for approval" },
];
const channels = ref<Channel[] | null>(null);
const rules = ref<Rule[] | null>(null);
const log = ref<Delivery[]>([]);
const packs = ref<Pack[]>([]);
const schedules = ref<Schedule[]>([]);

async function load() {
  const [c, r, l, p, s] = await Promise.all([
    getJson<Channel[]>("/api/v1/alerts/channels"),
    getJson<Rule[]>("/api/v1/alerts/rules"),
    getJson<Delivery[]>("/api/v1/alerts/log?limit=8"),
    getJson<Pack[]>("/api/v1/packs"),
    getJson<Schedule[]>("/api/v1/schedules"),
  ]);
  channels.value = c.ok ? c.data : [];
  rules.value = r.ok ? r.data : [];
  if (l.ok) log.value = l.data;
  if (p.ok) packs.value = p.data;
  if (s.ok) schedules.value = s.data;
}
onMounted(load);

const ruleSays = (r: Rule) => says(r, (id) => packs.value.find((p) => p.id === id)?.name ?? id, (id) => schedules.value.find((s) => s.id === id)?.name ?? id);
const channelName = (id: string) => channels.value?.find((c) => c.id === id)?.name ?? id;

// ---- channel dialog

const chOpen = ref(false);
const chEditing = ref<Channel | null>(null);
const chName = ref("");
const chType = ref<ChannelType>("ntfy");
const chUrl = ref("");
const chToken = ref("");
const chError = ref<string | null>(null);
const chBusy = ref(false);
const canToken = computed(() => chType.value === "ntfy" || chType.value === "webhook");

function newChannel() {
  chEditing.value = null;
  chName.value = "";
  chType.value = "ntfy";
  chUrl.value = "";
  chToken.value = "";
  chError.value = null;
  chOpen.value = true;
}
function editChannel(c: Channel) {
  chEditing.value = c;
  chName.value = c.name;
  chType.value = c.type;
  chUrl.value = "";
  chToken.value = "";
  chError.value = null;
  chOpen.value = true;
}
async function saveChannel() {
  const editing = chEditing.value;
  const body: Record<string, unknown> = { name: chName.value.trim(), type: chType.value };
  if (chUrl.value.trim() || !editing) body.url = chUrl.value.trim();
  if (chToken.value || (!canToken.value && editing?.hasToken)) body.token = canToken.value ? chToken.value : "";
  chBusy.value = true;
  const res = editing ? await sendJson<Channel>(`/api/v1/alerts/channels/${editing.id}`, body) : await sendJson<Channel>("/api/v1/alerts/channels", body);
  chBusy.value = false;
  if (!res.ok) return void (chError.value = res.error.message);
  chOpen.value = false;
  toast(editing ? `Saved the channel ${res.data.name}.` : `Added the channel ${res.data.name}. Send a test to check it.`, { tone: "ok" });
  await load();
}

const testing = ref<string | null>(null);
async function test(c: Channel) {
  testing.value = c.id;
  const res = await sendJson(`/api/v1/alerts/channels/${c.id}/test`, {});
  testing.value = null;
  if (!res.ok) return void toast(`The test to ${c.name} didn't arrive: ${res.error.message}`, { tone: "bad", timeout: 10000 });
  toast(`Sent a test to ${c.name}.`, { tone: "ok" });
}

// ---- rule dialog

const ruleOpen = ref(false);
const ruleEditing = ref<Rule | null>(null);
const ruleName = ref("");
const ruleTriggers = ref<string[]>([]);
const rulePacks = ref<string[]>([]);
const ruleSchedules = ref<string[]>([]);
const ruleChannels = ref<string[]>([]);
const ruleChange = ref(true);
const ruleOn = ref(true);
const ruleError = ref<string | null>(null);
const ruleBusy = ref(false);
const packOptions = computed(() => packs.value.map((p) => ({ value: p.id, label: p.name })));
const scheduleOptions = computed(() => schedules.value.map((s) => ({ value: s.id, label: s.name })));
const channelOptions = computed(() => (channels.value ?? []).map((c) => ({ value: c.id, label: c.name, note: TYPE_NAMES[c.type] })));
const ruleReady = computed(() => ruleName.value.trim() !== "" && ruleTriggers.value.length > 0 && ruleChannels.value.length > 0);

function trig(value: string) {
  return computed({
    get: () => ruleTriggers.value.includes(value),
    set: (on: boolean) => (ruleTriggers.value = on ? [...ruleTriggers.value, value] : ruleTriggers.value.filter((t) => t !== value)),
  });
}
const trigModels = Object.fromEntries(TRIGGERS.map((t) => [t.value, trig(t.value)]));

function newRule() {
  ruleEditing.value = null;
  ruleName.value = "";
  ruleTriggers.value = ["failed", "recovered"];
  rulePacks.value = [];
  ruleSchedules.value = [];
  ruleChannels.value = channels.value?.length === 1 ? [channels.value[0]!.id] : [];
  ruleChange.value = true;
  ruleOn.value = true;
  ruleError.value = null;
  ruleOpen.value = true;
}
function editRule(r: Rule) {
  ruleEditing.value = r;
  ruleName.value = r.name;
  ruleTriggers.value = [...r.triggers];
  rulePacks.value = [...r.packs];
  ruleSchedules.value = [...r.schedules];
  ruleChannels.value = [...r.channels];
  ruleChange.value = r.onlyOnChange;
  ruleOn.value = r.enabled;
  ruleError.value = null;
  ruleOpen.value = true;
}
async function saveRule() {
  const editing = ruleEditing.value;
  const body = {
    name: ruleName.value.trim(),
    triggers: TRIGGERS.map((t) => t.value).filter((t) => ruleTriggers.value.includes(t)),
    packs: rulePacks.value,
    schedules: ruleSchedules.value,
    channels: ruleChannels.value,
    onlyOnChange: ruleChange.value,
    enabled: ruleOn.value,
  };
  ruleBusy.value = true;
  const res = editing ? await sendJson<Rule>(`/api/v1/alerts/rules/${editing.id}`, body) : await sendJson<Rule>("/api/v1/alerts/rules", body);
  ruleBusy.value = false;
  if (!res.ok) return void (ruleError.value = res.error.message);
  ruleOpen.value = false;
  toast(editing ? `Saved the rule ${res.data.name}.` : `Added the rule ${res.data.name}.`, { tone: "ok" });
  await load();
}

// ---- deleting

const doomed = ref<{ kind: "channel" | "rule"; id: string; name: string } | null>(null);
const deleteOpen = computed({
  get: () => doomed.value !== null,
  set: (open: boolean) => {
    if (!open) doomed.value = null;
  },
});
async function remove() {
  const d = doomed.value;
  doomed.value = null;
  if (!d) return;
  const res = await sendJson(`/api/v1/alerts/${d.kind === "channel" ? "channels" : "rules"}/${d.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Deleted the ${d.kind} ${d.name}.`);
  await load();
}
</script>

<template>
  <section class="card" aria-labelledby="s-alerts">
    <h2 id="s-alerts" class="display">Alerts</h2>
    <p class="muted small">
      A message on your phone or in a chat when a run fails, passes again, a test breaks, a schedule misses a time or an agent waits for you. Channels say where messages go, rules say when. A
      message that doesn't arrive is tried three more times.
    </p>

    <h3 class="label">Channels</h3>
    <ul v-if="channels && channels.length" class="items">
      <li v-for="c in channels" :key="c.id" class="ch">
        <Bell :size="15" class="muted" />
        <div class="who">
          <span class="name">{{ c.name }}</span>
          <span class="muted small">{{ TYPE_NAMES[c.type] }} · <code>{{ c.url }}</code><template v-if="c.hasToken"> · with a token</template></span>
        </div>
        <div class="acts">
          <button type="button" class="btn" :disabled="testing === c.id" @click="test(c)"><Send :size="14" /> Send test</button>
          <button v-tip="'Change this channel'" type="button" class="ib" :aria-label="`Change ${c.name}`" @click="editChannel(c)"><Pencil :size="14" /></button>
          <button v-tip="'Delete this channel'" type="button" class="ib del" :aria-label="`Delete ${c.name}`" @click="doomed = { kind: 'channel', id: c.id, name: c.name }"><Trash2 :size="14" /></button>
        </div>
      </li>
    </ul>
    <p v-else-if="channels" class="muted small">No channels yet.</p>
    <div><button type="button" class="btn" @click="newChannel"><Plus :size="15" /> Add channel</button></div>

    <h3 class="label">Rules</h3>
    <ul v-if="rules && rules.length" class="items">
      <li v-for="r in rules" :key="r.id" :class="{ off: !r.enabled }">
        <div class="who">
          <span class="name">{{ r.name }}<span v-if="!r.enabled" class="muted small"> · off</span></span>
          <span class="muted small">{{ ruleSays(r) }}, to {{ join(r.channels.map(channelName), "and") || "no channel" }}{{ r.onlyOnChange && r.triggers.some((t) => RUN_TRIGGERS.has(t)) ? ", only on change" : "" }}.</span>
        </div>
        <div class="acts">
          <button v-tip="'Change this rule'" type="button" class="ib" :aria-label="`Change ${r.name}`" @click="editRule(r)"><Pencil :size="14" /></button>
          <button v-tip="'Delete this rule'" type="button" class="ib del" :aria-label="`Delete ${r.name}`" @click="doomed = { kind: 'rule', id: r.id, name: r.name }"><Trash2 :size="14" /></button>
        </div>
      </li>
    </ul>
    <p v-else-if="rules" class="muted small">No rules yet{{ channels && channels.length ? "" : ". Add a channel first" }}.</p>
    <div>
      <button type="button" class="btn" :disabled="!channels?.length" @click="newRule"><Plus :size="15" /> Add rule</button>
    </div>

    <template v-if="log.length">
      <h3 class="label">Sent lately</h3>
      <ul class="items log">
        <li v-for="d in log" :key="d.id">
          <span class="dot" :class="d.status" aria-hidden="true" />
          <div class="who">
            <span class="small">
              <a v-if="d.runId" :href="`#/runs/${d.runId}`">{{ d.title }}</a><template v-else>{{ d.title }}</template>
              <span class="muted"> · to {{ d.channelName }} · {{ ago(d.at) }}</span>
            </span>
            <span v-if="d.status === 'failed'" class="bad small">Didn't arrive after {{ d.tries }} tries: {{ d.error }}</span>
            <span v-else-if="d.status === 'sending'" class="muted small">Sending{{ d.tries ? ` (try ${d.tries + 1})` : "" }}…</span>
          </div>
        </li>
      </ul>
    </template>

    <ModalDialog v-model="chOpen" :heading="chEditing ? `Change ${chEditing.name}` : 'Add a channel'" width="520px">
      <form id="ch-form" class="form" @submit.prevent="saveChannel">
        <div class="fld">
          <label for="ch-name" class="lbl small">Name</label>
          <TextField id="ch-name" v-model="chName" placeholder="Phone" />
        </div>
        <div class="fld">
          <span class="lbl small">Type</span>
          <RadioGroup v-model="chType" :options="TYPES" label="Type" />
        </div>
        <div class="fld">
          <label for="ch-url" class="lbl small">{{ chType === "ntfy" ? "Topic URL" : "Webhook URL" }}</label>
          <TextField id="ch-url" v-model="chUrl" :placeholder="chEditing ? 'Leave empty to keep the one saved' : PLACEHOLDERS[chType]" />
          <span class="muted small">Or <code>${secret.NAME}</code> to keep it in Secrets. Anyone with this address can send to the channel.</span>
        </div>
        <div v-if="canToken" class="fld">
          <label for="ch-token" class="lbl small">Token <span class="muted">(optional)</span></label>
          <TextField id="ch-token" v-model="chToken" type="password" autocomplete="new-password" :placeholder="chEditing?.hasToken ? 'Leave empty to keep the one saved' : undefined" />
          <span class="muted small">Sent as a bearer token{{ chType === "ntfy" ? ", for a protected topic" : "" }}.</span>
        </div>
        <p v-if="chError" class="error small" role="alert">{{ chError }}</p>
      </form>
      <template #actions>
        <button class="btn" @click="chOpen = false">Cancel</button>
        <button class="btn primary" type="submit" form="ch-form" :disabled="chBusy || !chName.trim() || (!chEditing && !chUrl.trim())">{{ chEditing ? "Save" : "Add channel" }}</button>
      </template>
    </ModalDialog>

    <ModalDialog v-model="ruleOpen" :heading="ruleEditing ? `Change ${ruleEditing.name}` : 'Add a rule'" width="560px">
      <form id="rule-form" class="form" @submit.prevent="saveRule">
        <div class="fld">
          <label for="rule-name" class="lbl small">Name</label>
          <TextField id="rule-name" v-model="ruleName" placeholder="Shop is down" />
        </div>
        <fieldset class="fld">
          <legend class="lbl small">When</legend>
          <div class="checks">
            <label v-for="t in TRIGGERS" :key="t.value" class="check">
              <CheckBox v-model="trigModels[t.value]!.value" />
              <span>
                {{ t.label }}<br v-if="t.note" />
                <span v-if="t.note" class="muted small">{{ t.note }}</span>
              </span>
            </label>
          </div>
        </fieldset>
        <div class="two">
          <div class="fld">
            <label for="rule-packs" class="lbl small">Packs</label>
            <MultiSelect id="rule-packs" v-model="rulePacks" :options="packOptions" :empty-label="ruleSchedules.length ? 'None' : 'Every pack'" />
          </div>
          <div class="fld">
            <label for="rule-schedules" class="lbl small">Schedules</label>
            <MultiSelect id="rule-schedules" v-model="ruleSchedules" :options="scheduleOptions" :empty-label="rulePacks.length ? 'None' : 'Every schedule'" />
          </div>
        </div>
        <div class="fld">
          <label for="rule-channels" class="lbl small">Send to</label>
          <MultiSelect id="rule-channels" v-model="ruleChannels" :options="channelOptions" placeholder="Pick channels" />
        </div>
        <ToggleSwitch id="rule-change" v-model="ruleChange">Only on change</ToggleSwitch>
        <span class="muted small hint">One message when a pack or schedule starts failing, not one for every run that fails after it.</span>
        <ToggleSwitch id="rule-on" v-model="ruleOn">On</ToggleSwitch>
        <p v-if="ruleError" class="error small" role="alert">{{ ruleError }}</p>
      </form>
      <template #actions>
        <button class="btn" @click="ruleOpen = false">Cancel</button>
        <button class="btn primary" type="submit" form="rule-form" :disabled="ruleBusy || !ruleReady">{{ ruleEditing ? "Save" : "Add rule" }}</button>
      </template>
    </ModalDialog>

    <ModalDialog v-model="deleteOpen" :heading="`Delete this ${doomed?.kind ?? 'channel'}?`">
      <p v-if="doomed?.kind === 'channel'">
        Rules stop sending to <strong>{{ doomed.name }}</strong>. A rule left with no channel sends nothing.
      </p>
      <p v-else>
        <strong>{{ doomed?.name }}</strong> stops sending alerts.
      </p>
      <template #actions>
        <button class="btn" @click="doomed = null">Cancel</button>
        <button class="btn danger" @click="remove">Delete</button>
      </template>
    </ModalDialog>
  </section>
</template>

<style scoped>
.card {
  display: grid;
  gap: var(--space-3);
}
.card > h2:first-child,
.card p {
  margin: 0;
}
.card > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.card > .label {
  margin-top: var(--space-2);
}
.items {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.items li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.items li.off .name {
  color: var(--muted);
}
.who {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acts {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.log li {
  align-items: flex-start;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--muted);
}
.dot.sent {
  background: var(--ok);
}
.dot.failed {
  background: var(--bad);
}
.bad,
.error {
  color: var(--bad);
}
.form {
  display: grid;
  gap: var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.fld legend {
  padding: 0;
  margin-bottom: var(--space-1);
}
.two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
}
.checks {
  display: grid;
  gap: var(--space-2);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  cursor: pointer;
}
.hint {
  margin-top: calc(-1 * var(--space-2));
}
.ib {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
.ib.del:hover {
  color: var(--bad);
}
@media (max-width: 720px) {
  .items li.ch {
    flex-wrap: wrap;
  }
  .ch .acts {
    width: 100%;
    padding-left: calc(15px + var(--space-2));
  }
  .two {
    grid-template-columns: 1fr;
  }
}
</style>
