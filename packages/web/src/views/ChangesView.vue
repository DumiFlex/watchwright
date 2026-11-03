<script setup lang="ts">
// Proposed changes: with login on only admins change a pack's code, so users propose changes and an
// admin reads each file's diff here, then applies or declines it with a reply. The person who
// proposed a change sees what became of it, and can withdraw it while it waits.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ago, when } from "../format";
import { ArrowLeft, CircleAlert, FileCode, GitPullRequest } from "../icons";
import { LiveConnection } from "../live";
import { applyProposal, declineProposal, fileChange, getProposal, listProposals, STATUS_WORDS, withdrawProposal, type Proposal, type ProposalDetail } from "../proposals";
import { href } from "../router";
import { can, session } from "../session";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import DiffView from "../components/DiffView.vue";
import EmptyState from "../components/EmptyState.vue";
import ModalDialog from "../components/ModalDialog.vue";
import SkeletonBlock from "../components/SkeletonBlock.vue";
import StatusChip from "../components/StatusChip.vue";
import TabBar from "../components/TabBar.vue";
import TextArea from "../components/TextArea.vue";

const props = defineProps<{ id: string | null }>();

const show = ref<"waiting" | "all">("waiting");
const list = ref<Proposal[]>([]);
const waitingCount = ref(0);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadList() {
  const res = await listProposals(show.value === "waiting" ? "waiting" : undefined);
  loading.value = false;
  if (!res.ok) return void (loadError.value = res.error.message);
  loadError.value = null;
  list.value = res.data.proposals;
  waitingCount.value = res.data.waiting;
}
const tabs = computed(() => [
  { value: "waiting" as const, label: "Waiting", count: waitingCount.value },
  { value: "all" as const, label: "All" },
]);
watch(show, () => void loadList());

const detail = ref<ProposalDetail | null>(null);
const detailError = ref<string | null>(null);
async function loadDetail() {
  if (!props.id) return void (detail.value = null);
  const res = await getProposal(props.id);
  if (!res.ok) return void (detailError.value = res.error.message);
  detailError.value = null;
  detail.value = res.data;
}
watch(() => props.id, () => void (props.id ? loadDetail() : loadList()));

const diffMode = ref<"unified" | "split">("unified");
const moved = computed(() => detail.value?.files.filter((f) => f.changedSince).map((f) => f.path) ?? []);
const isMine = computed(() => !!detail.value && (!session.on || (session.user !== null && session.user.id === detail.value.userId)));

// Answering: apply or decline with a reply; withdraw for the person who proposed it.
const answer = ref<"apply" | "decline" | null>(null);
const reply = ref("");
const busy = ref(false);
function startAnswer(kind: "apply" | "decline") {
  reply.value = "";
  answer.value = kind;
}
async function sendAnswer() {
  const d = detail.value;
  if (!d || !answer.value || busy.value) return;
  busy.value = true;
  const res = answer.value === "apply" ? await applyProposal(d.id, reply.value, moved.value.length > 0) : await declineProposal(d.id, reply.value);
  busy.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(answer.value === "apply" ? `Applied: ${d.paths.join(", ")} written.` : "Declined.", { tone: "ok" });
  answer.value = null;
  await loadDetail();
}
const withdrawOpen = ref(false);
async function withdraw() {
  const d = detail.value;
  if (!d) return;
  const res = await withdrawProposal(d.id);
  withdrawOpen.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast("Withdrawn.", { tone: "ok" });
  await loadDetail();
}

const CHANGE_WORDS = { new: "new file", deleted: "deleted", changed: "changed" } as const;

let live: LiveConnection | null = null;
onMounted(() => {
  void (props.id ? loadDetail() : loadList());
  live = new LiveConnection({}, {
    onEvent: (e) => {
      if (!e.type.startsWith("proposal.")) return;
      if (props.id) {
        if (e.data.proposalId === props.id) void loadDetail();
      } else void loadList();
    },
  });
});
onBeforeUnmount(() => live?.close());
</script>

<template>
  <main class="page">
    <template v-if="!id">
      <div class="page-head">
        <div>
          <h1 class="display">Proposed changes</h1>
          <p class="muted">Changes to packs' code that wait for an admin. Code runs on this server, so only admins change it: anyone else edits it in the editor and proposes the change, and an admin reads the diff and applies or declines it.</p>
        </div>
      </div>
      <TabBar v-model="show" :tabs="tabs" id-prefix="changes" label="Which changes" class="tabs" />
      <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
      <ul v-if="loading" class="list" aria-busy="true" aria-label="Loading proposed changes">
        <li v-for="i in 2" :key="i" class="card row"><SkeletonBlock :lines="2" /></li>
      </ul>
      <ul v-else-if="list.length" class="list">
        <li v-for="p in list" :key="p.id">
          <a class="card row" :href="`#/changes/${p.id}`">
            <span class="top">
              <span class="pack display">{{ p.packName }}</span>
              <StatusChip :status="p.status" />
            </span>
            <span class="paths mono small">{{ p.paths.join(", ") }}</span>
            <span v-if="p.note" class="note">{{ p.note }}</span>
            <span v-tip="when(p.createdAt)" class="muted small">{{ p.by }} · {{ ago(p.createdAt) }}</span>
          </a>
        </li>
      </ul>
      <section v-else-if="!loadError" class="card">
        <EmptyState :icon="GitPullRequest" :heading="show === 'waiting' ? 'Nothing waits for review' : 'No proposed changes yet'">
          <p>When someone who can't change code edits a pack's code in the editor, <strong>Propose change</strong> sends it here.</p>
        </EmptyState>
      </section>
    </template>

    <template v-else>
      <a class="back muted small" href="#/changes"><ArrowLeft :size="14" /> Proposed changes</a>
      <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
      <SkeletonBlock v-else-if="!detail" :lines="4" />
      <template v-else>
        <div class="page-head">
          <div>
            <h1 class="display">{{ detail.packName }}: {{ detail.paths.length === 1 ? detail.paths[0] : `${detail.paths.length} files` }}</h1>
            <p class="muted">
              <StatusChip :status="detail.status" /> Proposed by {{ detail.by }} <span v-tip="when(detail.createdAt)">{{ ago(detail.createdAt) }}</span>
              <template v-if="detail.answeredBy"> · {{ STATUS_WORDS[detail.status].toLowerCase() }} by {{ detail.answeredBy }}</template>
            </p>
          </div>
          <div v-if="detail.status === 'waiting'" class="acts">
            <button v-if="isMine" type="button" class="btn" @click="withdrawOpen = true">Withdraw</button>
            <template v-if="can('admin')">
              <button type="button" class="btn" @click="startAnswer('decline')">Decline…</button>
              <button type="button" class="btn primary" @click="startAnswer('apply')">Apply…</button>
            </template>
          </div>
        </div>

        <section v-if="detail.note || detail.reply" class="card words">
          <p v-if="detail.note"><strong>{{ detail.by }}:</strong> {{ detail.note }}</p>
          <p v-if="detail.reply"><strong>{{ detail.answeredBy }}:</strong> {{ detail.reply }}</p>
        </section>

        <p v-if="detail.status === 'waiting' && moved.length" class="moved" role="note">
          <CircleAlert :size="16" />
          <span>{{ moved.join(", ") }} changed on disk since this was proposed. The diff shows what the proposal changed; applying it writes the proposed text over the file as it is now.</span>
        </p>

        <section v-for="f in detail.files" :key="f.path" class="file">
          <h2 class="fname">
            <FileCode :size="15" />
            <a class="mono" :href="href({ name: 'edit', id: detail.packId, file: f.path, line: null })">{{ f.path }}</a>
            <span class="muted small">{{ CHANGE_WORDS[fileChange(f)] }}</span>
          </h2>
          <DiffView v-model:mode="diffMode" :before="f.base ?? ''" :after="f.text ?? ''" :label="`Changes to ${f.path}`" before-label="Before" after-label="Proposed" />
        </section>
      </template>
    </template>

    <ModalDialog :model-value="answer !== null" :heading="answer === 'apply' ? 'Apply this change?' : 'Decline this change?'" width="480px" @update:model-value="(v: boolean) => (v ? null : (answer = null))">
      <p v-if="answer === 'apply'">This writes {{ detail?.paths.join(", ") }} and rebuilds the pack. The next run runs the new code.</p>
      <p v-else>The files stay as they are. Say why, so {{ detail?.by }} knows what to change.</p>
      <label class="lbl" for="change-reply">Reply to {{ detail?.by }} (optional)</label>
      <TextArea id="change-reply" v-model="reply" :rows="3" placeholder="Thanks! / Please keep the old timeout." />
      <template #actions>
        <button type="button" class="btn" @click="answer = null">Cancel</button>
        <button type="button" class="btn" :class="answer === 'apply' ? 'primary' : 'danger'" :disabled="busy" @click="sendAnswer">{{ answer === "apply" ? "Apply" : "Decline" }}</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="withdrawOpen" heading="Withdraw this change?">
      <p>Nobody can apply it after that. Your edits are kept in the proposal for reference.</p>
      <template #actions>
        <button type="button" class="btn" @click="withdrawOpen = false">Cancel</button>
        <button type="button" class="btn danger" @click="withdraw">Withdraw</button>
      </template>
    </ModalDialog>
  </main>
</template>

<style scoped>
.tabs {
  margin-bottom: var(--space-4);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: inherit;
  text-decoration: none;
}
a.row:hover {
  border-color: var(--line-strong);
}
.top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.pack {
  font-size: 1.05rem;
}
.paths {
  overflow-wrap: anywhere;
}
.note {
  overflow-wrap: anywhere;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
  color: var(--muted);
  text-decoration: none;
}
.page-head h1 {
  overflow-wrap: anywhere;
}
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.words {
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.words p {
  margin: 0;
  overflow-wrap: anywhere;
}
.moved {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  margin: 0 0 var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
}
.moved > svg {
  flex: none;
  margin-top: 0.15em;
  color: var(--warn);
}
.file {
  margin-bottom: var(--space-5);
}
.fname {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.95rem;
  margin: 0 0 var(--space-2);
}
.fname a {
  color: inherit;
  overflow-wrap: anywhere;
}
.lbl {
  display: block;
  margin: var(--space-3) 0 var(--space-1);
  font-size: 0.9rem;
}
</style>
