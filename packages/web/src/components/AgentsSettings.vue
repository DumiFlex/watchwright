<script setup lang="ts">
// Settings > Agents: the MCP address and how each agent connects to it, Add to a project (the
// skill and the MCP settings written into a project folder, through agents.install), and the
// agents that called lately.
import { computed, onMounted, ref } from "vue";
import { connectSnippets, mcpAddress, type AgentTab, type InstallAgent, type InstallResult, type SeenAgent } from "../agents";
import { getJson, sendJson } from "../api";
import { ago, when } from "../format";
import { Bot, FolderPlus } from "../icons";
import { tildify } from "../paths";
import { settings } from "../settings";
import { vTip } from "../tooltip";
import CheckBox from "./CheckBox.vue";
import CodeView from "./CodeView.vue";
import FolderBrowser from "./FolderBrowser.vue";
import ModalDialog from "./ModalDialog.vue";
import TabBar from "./TabBar.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const origin = window.location.origin;
const address = mcpAddress(origin);
const snippets = connectSnippets(origin);
const tab = ref<AgentTab>("claude");
const current = computed(() => snippets.find((s) => s.value === tab.value)!);

const seen = ref<SeenAgent[] | null>(null);
onMounted(async () => {
  const res = await getJson<SeenAgent[]>("/api/v1/agents/seen");
  seen.value = res.ok ? res.data : [];
});

// Add to a project.
const KINDS: { value: InstallAgent; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
];
const addOpen = ref(false);
const folder = ref<string | null>(null);
const picked = ref<Record<InstallAgent, boolean>>({ claude: true, codex: true, cursor: true });
const withMcp = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);
const result = ref<InstallResult | null>(null);
const chosen = computed(() => KINDS.filter((k) => picked.value[k.value]).map((k) => k.value));

function openAdd() {
  error.value = null;
  result.value = null;
  addOpen.value = true;
}
async function install() {
  if (!folder.value || chosen.value.length === 0) return;
  busy.value = true;
  error.value = null;
  const res = await sendJson<InstallResult>("/api/v1/agents/install", { folder: folder.value, agents: chosen.value, mcp: withMcp.value, server: `${origin}/` });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  result.value = res.data;
}
</script>

<template>
  <section class="card agents" aria-labelledby="s-agents">
    <h2 id="s-agents" class="display">Agents</h2>
    <p class="muted small">AI agents such as Claude Code, Codex and Cursor run your packs and read the results through the MCP server. What they start shows on the Runs page under their name, and anything they want to delete waits for you.</p>

    <CodeView :code="address" label="MCP address" />

    <div class="connect">
      <TabBar v-model="tab" :tabs="snippets.map((s) => ({ value: s.value, label: s.label }))" id-prefix="ag" label="Connect an agent" />
      <div :id="`ag-panel-${tab}`" role="tabpanel" :aria-labelledby="`ag-tab-${tab}`" class="panel">
        <p class="small">{{ current.where }}</p>
        <CodeView :code="current.code" :lang="current.lang" :label="`${current.label} setup`" wrap />
      </div>
    </div>

    <div class="project">
      <div>
        <h3 class="sub">Add to a project</h3>
        <p class="muted small">Writes the Watchwright skill where the agents look for skills in a project folder, and the MCP server into the project's settings. Or run <code class="nowrap">watchwright init-agent</code> in the folder.</p>
      </div>
      <div>
        <button type="button" class="btn" @click="openAdd"><FolderPlus :size="15" /> Add to a project…</button>
      </div>
    </div>

    <div>
      <h3 class="sub">Seen lately</h3>
      <ul v-if="seen && seen.length" class="seen">
        <li v-for="a in seen" :key="a.name">
          <Bot :size="15" class="bot" />
          <span class="name">{{ a.name }}</span>
          <span class="muted small">
            <span v-tip="when(a.lastAt)">{{ ago(a.lastAt) }}</span> · <code>{{ a.lastTool }}</code> · {{ a.calls }} {{ a.calls === 1 ? "call" : "calls" }}<template v-if="a.started"> · started {{ a.started }}</template>
          </span>
        </li>
      </ul>
      <p v-else-if="seen" class="muted small">No agent has called in the last 30 days.</p>
    </div>
  </section>

  <ModalDialog v-model="addOpen" heading="Add Watchwright to a project" width="760px">
    <template v-if="result">
      <p>Set up {{ result.agents.map((a) => KINDS.find((k) => k.value === a)?.label ?? a).join(", ") }} in <code>{{ tildify(result.folder, settings.home) }}</code>:</p>
      <ul class="wrote small">
        <li v-for="w in result.wrote" :key="w"><code>{{ w }}</code></li>
      </ul>
      <template v-if="result.commands.length">
        <p class="small">Codex keeps MCP servers in its own settings. Run this once:</p>
        <CodeView v-for="c in result.commands" :key="c" :code="c" label="Codex setup" wrap />
      </template>
      <p v-for="p in result.problems" :key="p" class="error small" role="alert">{{ p }}</p>
    </template>
    <template v-else>
      <FolderBrowser v-model:path="folder" />
      <fieldset class="kinds">
        <legend class="small">For</legend>
        <CheckBox v-for="k in KINDS" :id="`ag-kind-${k.value}`" :key="k.value" v-model="picked[k.value]">{{ k.label }}</CheckBox>
      </fieldset>
      <ToggleSwitch id="ag-mcp" v-model="withMcp">Also add the MCP server to the project's settings</ToggleSwitch>
      <p v-if="error" class="error small" role="alert">{{ error }}</p>
    </template>
    <template #actions>
      <template v-if="result">
        <button type="button" class="btn primary" @click="addOpen = false">Done</button>
      </template>
      <template v-else>
        <button type="button" class="btn" @click="addOpen = false">Cancel</button>
        <button type="button" class="btn primary" :disabled="busy || !folder || chosen.length === 0" @click="install">{{ busy ? "Writing…" : "Add to this folder" }}</button>
      </template>
    </template>
  </ModalDialog>
</template>

<style scoped>
.agents {
  display: grid;
  gap: var(--space-3);
}
.agents > h2:first-child,
.agents p {
  margin: 0;
}
.agents > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.connect {
  display: grid;
  gap: var(--space-2);
}
.panel {
  display: grid;
  gap: var(--space-2);
}
.project {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
}
.sub {
  margin: 0 0 var(--space-1);
  font-size: 13px;
}
.seen {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.seen li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}
.nowrap {
  white-space: nowrap;
}
.bot {
  color: var(--accent);
}
.name {
  font-weight: 600;
}
.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  border: 0;
  margin: var(--space-3) 0 var(--space-2);
  padding: 0;
}
.kinds legend {
  padding: 0;
  margin-bottom: var(--space-1);
  font-weight: 600;
}
.wrote {
  margin: var(--space-2) 0 var(--space-3);
  padding-left: var(--space-4);
}
@media (max-width: 640px) {
  .project {
    grid-template-columns: 1fr;
  }
}
</style>
