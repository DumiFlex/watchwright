<script setup lang="ts">
// One pack: whether it loads, its tests with their metadata, parameters and flag kinds, and
// its recent runs.
import { ArrowLeft } from "../icons";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getJson, sendJson, type Criterion, type Pack, type PackTest, type RunSummary } from "../api";
import { ago, countsText, when } from "../format";
import { LiveConnection } from "../live";
import StatusChip from "../components/StatusChip.vue";
import TabBar from "../components/TabBar.vue";
import { vTip } from "../tooltip";

const props = defineProps<{ id: string }>();

const pack = ref<Pack | null>(null);
const runs = ref<RunSummary[]>([]);
const error = ref<string | null>(null);
const reloading = ref(false);
type Tab = "tests" | "params" | "flags" | "rubric";
const tab = ref<Tab>("tests");

const tabs = computed(() => [
  { value: "tests" as const, label: "Tests", count: pack.value?.tests.length ?? 0 },
  { value: "params" as const, label: "Parameters", count: Object.keys(pack.value?.params ?? {}).length },
  { value: "flags" as const, label: "Flags", count: Object.keys(pack.value?.flags ?? {}).length },
  { value: "rubric" as const, label: "Rubric", count: pack.value?.rubric.length ?? 0 },
]);
// Tests that score on something other than the pack's rubric.
const ownRubric = computed(() => {
  const base = (pack.value?.rubric ?? []).map((c) => c.id).join(",");
  return (pack.value?.tests ?? []).filter((t) => t.rubric.map((c) => c.id).join(",") !== base);
});
const criterionKind = (c: Criterion) => (c.kind === "scale" ? `1 to ${c.scale}` : c.kind === "yesNo" ? "yes or no" : c.choices.join(", "));

const FLAG_KIND: Record<string, string> = {
  robot: "The harness or the test went wrong: the attempt is broken, and Redo broken runs it again.",
  finding: "The site did something wrong: the attempt failed.",
  info: "Worth noting; doesn't change the outcome.",
};

function runsText(t: PackTest): string {
  if (typeof t.runs === "number") return t.runs === 1 ? "" : `${t.runs}×`;
  if (t.runs === "computed") return "computed";
  const by = typeof t.runs.by === "string" ? t.runs.by : "param";
  return `by ${by}`;
}

async function load() {
  const [p, r] = await Promise.all([getJson<Pack>(`/api/v1/packs/${props.id}`), getJson<RunSummary[]>(`/api/v1/runs?pack=${props.id}&limit=10`)]);
  if (!p.ok) {
    error.value = p.error.code === "not_found" ? "There is no pack with this id. It may have been removed." : p.error.message;
    pack.value = null;
    return;
  }
  error.value = null;
  pack.value = p.data;
  if (r.ok) runs.value = r.data;
}

async function reload() {
  reloading.value = true;
  await sendJson(`/api/v1/packs/${props.id}/reload`);
  reloading.value = false;
  await load();
}

watch(() => props.id, load);
let live: LiveConnection | null = null;
onMounted(() => {
  void load();
  live = new LiveConnection({}, { onEvent: (e) => /^(pack|run)\./.test(e.type) && void load() });
});
onBeforeUnmount(() => live?.close());
</script>

<template>
  <main class="page">
    <p class="crumb"><a href="#/packs"><ArrowLeft :size="15" />Packs</a></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="pack">
      <div class="page-head">
        <div class="title">
          <h1 class="display">{{ pack.name }} <StatusChip v-if="pack.status === 'error'" status="failed" /></h1>
          <p v-if="pack.description">{{ pack.description }}</p>
          <p class="muted small">
            {{ pack.browser }}<template v-if="pack.baseURL"> · {{ pack.baseURL }}</template><template v-if="pack.siteKey"> · site key <code>{{ pack.siteKey }}</code></template>
            <template v-if="pack.loadedAt"> · <span v-tip="when(pack.loadedAt)">built {{ ago(pack.loadedAt) }}</span></template>
          </p>
          <p class="muted small path"><code>{{ pack.path }}</code></p>
        </div>
        <div class="acts">
          <button class="btn" :disabled="reloading" @click="reload">{{ reloading ? "Reloading…" : "Reload" }}</button>
          <a v-if="pack.status === 'ok'" class="btn primary" :href="`#/new?pack=${pack.id}`">New run</a>
        </div>
      </div>

      <section v-if="pack.status === 'error' || pack.problems.length" class="card problems" role="alert">
        <h2 class="display">The pack doesn't load</h2>
        <p v-if="pack.error" class="error">{{ pack.error }}</p>
        <ul v-if="pack.problems.length">
          <li v-for="(x, i) in pack.problems" :key="i">{{ x }}</li>
        </ul>
        <p class="muted small">Fix the files and save: the server builds the pack again by itself.</p>
      </section>

      <section class="card">
        <TabBar v-model="tab" :tabs="tabs" id-prefix="pack" label="Pack details" />

        <div v-show="tab === 'tests'" id="pack-panel-tests" role="tabpanel" aria-labelledby="pack-tab-tests" class="panel">
          <table v-if="pack.tests.length" class="tbl">
            <thead>
              <tr><th>Test</th><th>Section</th><th>Needs</th><th>Attempts</th><th>File</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in pack.tests" :key="t.id" :class="{ child: !!t.inside }">
                <td class="c-test">
                  <code>{{ t.id }}</code> <span>{{ t.title !== t.id ? t.title : "" }}</span>
                  <span v-if="t.inside" class="muted small">runs inside {{ t.inside }}</span>
                  <span v-for="tag in t.tags" :key="tag" class="tag small">{{ tag }}</span>
                </td>
                <td class="muted" data-label="Section" :class="{ none: !t.section }">{{ t.section ?? "–" }}</td>
                <td data-label="Needs" :class="{ none: !t.needs.length }"><code v-if="t.needs.length">{{ t.needs.join(", ") }}</code><span v-else class="muted">–</span></td>
                <td class="num" data-label="Attempts">{{ runsText(t) || "1" }}</td>
                <td class="muted small file"><code v-tip="t.file">{{ t.file }}</code></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">No tests found.</p>
        </div>

        <div v-show="tab === 'params'" id="pack-panel-params" role="tabpanel" aria-labelledby="pack-tab-params" class="panel">
          <dl v-if="Object.keys(pack.params).length" class="defs">
            <template v-for="(d, k) in pack.params" :key="k">
              <dt><code>{{ k }}</code> <span class="muted small">{{ d.type }}</span></dt>
              <dd>
                <span v-if="d.description">{{ d.description }}</span>
                <span v-if="d.choices" class="muted small"> Choices: <code v-for="c in d.choices" :key="String(c)" class="choice">{{ c }}</code></span>
                <span v-if="d.default !== undefined" class="muted small"> Default <code>{{ d.default }}</code>.</span>
              </dd>
            </template>
          </dl>
          <p v-else class="muted">This pack has no parameters.</p>
        </div>

        <div v-show="tab === 'flags'" id="pack-panel-flags" role="tabpanel" aria-labelledby="pack-tab-flags" class="panel">
          <dl v-if="Object.keys(pack.flags).length" class="defs">
            <template v-for="(kind, k) in pack.flags" :key="k">
              <dt><code>{{ k }}</code></dt>
              <dd><span class="kind" :class="kind">{{ kind }}</span> <span class="muted small">{{ FLAG_KIND[kind] }}</span></dd>
            </template>
          </dl>
          <p v-else class="muted">This pack declares no flags.</p>
        </div>
        <div v-show="tab === 'rubric'" id="pack-panel-rubric" role="tabpanel" aria-labelledby="pack-tab-rubric" class="panel">
          <p class="muted small">What reviewers score each attempt on.</p>
          <dl class="defs">
            <template v-for="c in pack.rubric" :key="c.id">
              <dt><code>{{ c.id }}</code></dt>
              <dd>
                <strong>{{ c.title }}</strong> <span class="muted small">{{ criterionKind(c) }}</span>
                <span v-if="c.description" class="small"> · {{ c.description }}</span>
              </dd>
            </template>
          </dl>
          <template v-if="ownRubric.length">
            <h3 class="sub">Tests with their own criteria</h3>
            <dl class="defs">
              <template v-for="t in ownRubric" :key="t.id">
                <dt><code>{{ t.id }}</code></dt>
                <dd>{{ t.rubric.map((c) => c.title).join(", ") }}</dd>
              </template>
            </dl>
          </template>
        </div>
      </section>

      <section class="card" aria-labelledby="pk-runs">
        <h2 id="pk-runs" class="display">Recent runs</h2>
        <ul v-if="runs.length" class="rlist">
          <li v-for="r in runs" :key="r.id">
            <a :href="`#/runs/${r.id}`" class="num">{{ r.id }}</a>
            <StatusChip :status="r.status" />
            <span class="small">{{ countsText(r.counts) }}</span>
            <span v-tip="when(r.startedAt ?? r.createdAt)" class="muted small">{{ ago(r.startedAt ?? r.createdAt) }}</span>
          </li>
        </ul>
        <p v-else class="muted">No runs of this pack yet.</p>
        <a v-if="runs.length" class="small" :href="`#/?pack=${pack.id}`">All runs of this pack</a>
      </section>
    </template>
  </main>
</template>

<style scoped>
.title h1 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.path code {
  word-break: break-all;
}
.acts {
  display: flex;
  gap: var(--space-2);
}
.acts a.btn {
  text-decoration: none;
}
.problems h2 {
  color: var(--bad);
}
.problems ul {
  margin: var(--space-2) 0;
  padding-left: 18px;
}
.panel {
  padding-top: var(--space-3);
  overflow-x: auto;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
}
.tbl th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  font-size: 12px;
  padding: 4px 12px 6px 0;
}
.tbl td {
  padding: 7px 12px 7px 0;
  border-top: var(--border-width) solid var(--line);
  vertical-align: baseline;
}
.tbl tr.child .c-test {
  padding-left: var(--space-5);
}
.c-test {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}
.tag {
  padding: 0 6px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent-text);
}
.file code {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.defs {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
}
.defs dd {
  margin: 0;
}
.sub {
  margin: var(--space-5) 0 var(--space-2);
  font-size: 13px;
  color: var(--muted);
}
.choice {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: var(--radius-sm);
  background: var(--raised);
}
.kind {
  display: inline-block;
  padding: 0 8px;
  border-radius: var(--radius-chip);
  font-size: 12px;
  font-weight: 600;
}
.kind.robot {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.kind.finding {
  color: var(--bad);
  background: color-mix(in srgb, var(--bad) 12%, transparent);
}
.kind.info {
  color: var(--muted);
  background: var(--raised);
}
.rlist {
  list-style: none;
  margin: 0 0 var(--space-2);
  padding: 0;
}
.rlist li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: 6px 0;
  border-top: var(--border-width) solid var(--line);
}
@media (max-width: 720px) {
  .tbl thead {
    display: none;
  }
  .tbl tr {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    padding: 8px 0;
    border-top: var(--border-width) solid var(--line);
  }
  .tbl tbody tr:first-child {
    border-top: 0;
  }
  .tbl td {
    border: 0;
    padding: 0;
    font-size: 13px;
  }
  .tbl td.c-test {
    flex-basis: 100%;
    font-size: 14px;
  }
  .tbl td[data-label]::before {
    content: attr(data-label) " ";
    color: var(--muted);
    font-family: var(--font-ui);
  }
  .tbl td.none,
  .tbl td.file {
    display: none;
  }
  .defs {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .defs dd {
    margin-bottom: var(--space-2);
  }
}
</style>
