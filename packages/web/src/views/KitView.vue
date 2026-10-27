<script setup lang="ts">
// Every themed control on one page (#/kit), to check them in each look and mode and to copy
// from when a feature needs one. The page is not linked from the app.
import { computed, ref } from "vue";
import CheckBox from "../components/CheckBox.vue";
import DataTable from "../components/DataTable.vue";
import DatePicker from "../components/DatePicker.vue";
import DateRangePicker, { type DateRange } from "../components/DateRangePicker.vue";
import FilePicker from "../components/FilePicker.vue";
import ImageViewer from "../components/ImageViewer.vue";
import MenuButton from "../components/MenuButton.vue";
import ModalDialog from "../components/ModalDialog.vue";
import MultiSelect from "../components/MultiSelect.vue";
import NumberInput from "../components/NumberInput.vue";
import ProgressBar from "../components/ProgressBar.vue";
import RadioGroup from "../components/RadioGroup.vue";
import RangeSlider from "../components/RangeSlider.vue";
import SelectMenu from "../components/SelectMenu.vue";
import SortableList from "../components/SortableList.vue";
import SplitPane from "../components/SplitPane.vue";
import StatusChip from "../components/StatusChip.vue";
import TabBar from "../components/TabBar.vue";
import TextArea from "../components/TextArea.vue";
import TextField from "../components/TextField.vue";
import TimelineScrubber, { type TimelineMark } from "../components/TimelineScrubber.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";
import VideoPlayer from "../components/VideoPlayer.vue";
import type { Sort } from "../table";
import type { TimelineStep } from "../timeline";
import * as icons from "../icons";
import { toast } from "../toasts";
import { vTip } from "../tooltip";

const text = ref("");
const search = ref("checkout");
const secret = ref("hunter2");
const bad = ref("not a url");
const notes = ref("Grows with its text.\nNo resize grip.");
const note2 = ref("Drag the corner, or focus it and press the arrows. Double-click it to fit the text again.");
const checked = ref(true);
const unchecked = ref(false);
const browser = ref<"chromium" | "firefox" | "webkit">("firefox");
const trace = ref("problems");
const live = ref(true);
const quiet = ref(false);
const quality = ref(70);
const limit = ref(20);
const day = ref("");
const until = ref("2026-11-03");
const files = ref<File[]>([]);
const span = ref<DateRange>({ from: "2026-10-05", to: "2026-10-18" });
const anySpan = ref<DateRange>({ from: "", to: "" });

// 500 made-up runs, so the table scrolls and renders only the rows on screen.
type DemoRun = { id: number; pack: string; status: "running" | "passed" | "failed" | "paused"; tests: number; took: number; started: string };
const packs = ["shop-smoke", "checkout-bench", "search-suite", "account-flows"];
const statuses = ["passed", "passed", "passed", "failed", "paused", "running"] as const;
const allRuns: DemoRun[] = Array.from({ length: 500 }, (_, i) => {
  const n = (i * 7919) % 997;
  const day = new Date(Date.UTC(2026, 9, 27) - i * 3_600_000 * 5);
  return { id: 500 - i, pack: packs[n % 4]!, status: statuses[n % 6]!, tests: 4 + (n % 40), took: 20 + ((n * 13) % 900), started: day.toISOString().slice(0, 16).replace("T", " ") };
});
const shown = ref(200);
const runs = computed(() => allRuns.slice(0, shown.value));
const runSort = ref<Sort>({ key: "id", dir: "desc" });
const chosenRuns = ref<(string | number)[]>([]);
const runColumns = [
  { key: "id", label: "Run", sortable: true, width: "80px" },
  { key: "pack", label: "Pack", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "tests", label: "Tests", sortable: true, align: "end" as const },
  { key: "took", label: "Took", sortable: true, align: "end" as const },
  { key: "started", label: "Started", sortable: true },
];
const took = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const lastRow = ref("");
const iconList = Object.entries(icons);
const split = ref(58);
const logLines = ["0:00 open https://shop.example.test/", "0:04 fill search: boots", "0:09 click Add to cart", "0:12 wait for cart badge", "0:21 click Checkout", "0:33 expect total 59.90", "0:41 screenshot checkout"];
const playhead = ref(12_400);
const picked2 = ref("");
const steps: TimelineStep[] = [
  { id: "1", label: "Open home page", start: 0, end: 4000, status: "passed" },
  { id: "2", label: "Search for boots", start: 4000, end: 9000, status: "passed" },
  { id: "3", label: "Wait for results", start: 5200, end: 8100, status: "passed" },
  { id: "4", label: "Add to cart", start: 9000, end: 21_000, status: "passed" },
  { id: "5", label: "Cart badge slow", start: 12_000, end: 19_500, status: "broken" },
  { id: "6", label: "Checkout", start: 21_000, end: 41_000, status: "failed" },
  { id: "7", label: "Screenshot", start: 41_000, end: 47_000 },
];
const marks: TimelineMark[] = [
  { at: 19_500, label: "Retry", tone: "warn" },
  { at: 33_000, label: "Total was 64.90", tone: "bad" },
];
type QueueItem = { id: string; name: string; state: "done" | "running" | "waiting" };
const queue = ref<QueueItem[]>([
  { id: "H1", name: "Home page loads", state: "done" },
  { id: "S1", name: "Search finds products", state: "running" },
  { id: "C1", name: "Guest checkout", state: "waiting" },
  { id: "S3", name: "Typo still finds boots", state: "waiting" },
  { id: "C3", name: "Coupon applies once", state: "waiting" },
  { id: "A1", name: "Sign in", state: "waiting" },
]);
const lastMove = ref("");
let toastCount = 0;
function demoToast(tone: "info" | "ok" | "bad" | "warn") {
  toastCount++;
  if (tone === "ok") toast(`Run #${500 + toastCount} passed`, { tone });
  else if (tone === "bad") toast("Run failed to start: the browser closed", { tone, action: { label: "Retry", run: () => toast("Starting again") } });
  else if (tone === "warn") toast("Pack changed while a run was in progress", { tone, timeout: 0 });
  else toast("Pack reloaded", { action: { label: "Undo", run: () => toast("Reload undone") } });
}
const tests = ref<string[]>(["S1", "C1"]);
const testOptions = [
  ["H1", "Home page loads", "Home"],
  ["H2", "Banner rotates", "Home"],
  ["S1", "Search finds products", "Search"],
  ["S2", "Filters narrow results", "Search"],
  ["S3", "Typo still finds boots", "Search"],
  ["S4", "Empty search shows tips", "Search"],
  ["C1", "Guest checkout", "Checkout"],
  ["C2", "Checkout with an account", "Checkout"],
  ["C3", "Coupon applies once", "Checkout"],
  ["A1", "Sign in", "Account"],
  ["A2", "Reset password", "Account"],
].map(([value, label, group]) => ({ value: value!, label: `${value} ${label}`, group: group!, note: value === "C1" ? "needs S1" : undefined }));
const browsers = [
  { value: "chromium" as const, label: "Chromium" },
  { value: "firefox" as const, label: "Firefox" },
  { value: "webkit" as const, label: "WebKit" },
];
const tab = ref<"shots" | "texts" | "log">("shots");
const tabs = [
  { value: "shots" as const, label: "Screenshots", count: 12 },
  { value: "texts" as const, label: "Texts", count: 3 },
  { value: "log" as const, label: "Log" },
];
// Sample screenshots drawn as SVG, so the kit needs no image files.
const sampleShot = (title: string, hue: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#f4f1ea"/><rect width="1280" height="72" fill="hsl(${hue},30%,25%)"/><text x="32" y="48" font-family="sans-serif" font-size="28" font-weight="700" fill="#fff">${title}</text>${[0, 1, 2]
      .map((i) => `<rect x="${40 + i * 410}" y="120" width="380" height="240" rx="12" fill="hsl(${hue + i * 40},35%,72%)"/>`)
      .join("")}<rect x="40" y="400" width="1200" height="24" rx="6" fill="#ddd"/><rect x="40" y="440" width="900" height="24" rx="6" fill="#ddd"/></svg>`,
  )}`;
const shots = [
  { url: sampleShot("Home", 140), name: "01 home" },
  { url: sampleShot("Search results", 210), name: "02 search" },
  { url: sampleShot("Cart", 20), name: "03 cart", note: "mark" },
];
const shotOpen = ref<number | null>(null);

const dialog = ref(false);
const formDialog = ref(false);
const picked = ref("");
const menu = [
  { value: "open", label: "Open" },
  { value: "again", label: "New run like this" },
  { value: "delete", label: "Delete…", danger: true },
];
const traces = [
  { value: "problems", label: "Only on problems", note: "Keep a trace when an attempt fails or breaks" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];
</script>

<template>
  <main class="page">
    <header>
      <h1 class="display">Controls</h1>
      <p class="muted">Every control the app uses, drawn from the theme. Switch the look and mode at the top to check them.</p>
    </header>

    <section class="card">
      <h2 class="display">Icons</h2>
      <p class="muted note">From Lucide, under Lucide's names. Import them from <code>src/icons.ts</code>; the line weight follows the look.</p>
      <ul class="icons">
        <li v-for="[name, icon] in iconList" :key="name">
          <component :is="icon" :size="20" />
          <span class="mono">{{ name }}</span>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2 class="display">Text</h2>
      <div class="grid">
        <div class="item"><label for="k-text">Text field</label><TextField id="k-text" v-model="text" placeholder="Placeholder text" /></div>
        <div class="item"><label for="k-search">Search</label><TextField id="k-search" v-model="search" type="search" placeholder="Find a test" /></div>
        <div class="item"><label for="k-pass">Password</label><TextField id="k-pass" v-model="secret" type="password" /></div>
        <div class="item">
          <label for="k-bad">Invalid</label><TextField id="k-bad" v-model="bad" type="url" invalid />
          <span class="err">Enter a full URL, like https://example.test/</span>
        </div>
        <div class="item"><label for="k-off">Disabled</label><TextField id="k-off" model-value="Can't change this" disabled /></div>
        <div class="item"><label for="k-notes">Text area, grows with its text</label><TextArea id="k-notes" v-model="notes" :rows="2" /></div>
        <div class="item"><label for="k-note2">Text area with a resize grip</label><TextArea id="k-note2" v-model="note2" :rows="3" resizable /></div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">Choices</h2>
      <div class="grid">
        <div class="item">
          <span class="lbl">Checkbox</span>
          <CheckBox v-model="checked">Checked</CheckBox>
          <CheckBox v-model="unchecked">Not checked</CheckBox>
          <CheckBox :model-value="true" disabled>Disabled</CheckBox>
        </div>
        <div class="item">
          <span class="lbl">Switch</span>
          <ToggleSwitch v-model="live">Follow new tabs</ToggleSwitch>
          <ToggleSwitch v-model="quiet">Quiet mode</ToggleSwitch>
          <ToggleSwitch disabled>Disabled</ToggleSwitch>
        </div>
        <div class="item">
          <span id="k-trace" class="lbl">Radio group</span>
          <RadioGroup v-model="trace" :options="traces" label="Trace" />
        </div>
        <div class="item">
          <label for="k-browser">Select</label>
          <SelectMenu id="k-browser" v-model="browser" :options="browsers" />
          <span class="lbl">Radio group, inline</span>
          <RadioGroup v-model="browser" :options="browsers" label="Browser" inline />
        </div>
        <div class="item wide">
          <label for="k-tests">Multi-select, grouped</label>
          <MultiSelect id="k-tests" v-model="tests" :options="testOptions" placeholder="Search tests" empty-label="All tests" />
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">Numbers, dates and files</h2>
      <div class="grid">
        <div class="item"><label for="k-limit">Number</label><NumberInput id="k-limit" v-model="limit" label="Pause limit" :min="1" :max="120" /></div>
        <div class="item"><label for="k-quality">Slider</label><RangeSlider id="k-quality" v-model="quality" label="Frame quality" :min="10" :max="100" :step="5" :format="(v) => `${v}%`" /></div>
        <div class="item"><label for="k-day">Date</label><DatePicker id="k-day" v-model="day" /></div>
        <div class="item"><label for="k-until">Date between Oct 1 and Dec 31</label><DatePicker id="k-until" v-model="until" min="2026-10-01" max="2026-12-31" clearable /></div>
        <div class="item"><label for="k-span">Date range</label><DateRangePicker id="k-span" v-model="span" /></div>
        <div class="item"><label for="k-any">Date range, in October and November</label><DateRangePicker id="k-any" v-model="anySpan" min="2026-10-01" max="2026-11-30" /></div>
        <div class="item wide"><label for="k-files">Files</label><FilePicker id="k-files" v-model="files" accept=".ts,.json,image/*" multiple /></div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">Feedback</h2>
      <div class="grid">
        <div class="item">
          <span class="lbl">Progress</span>
          <ProgressBar :value="0.62" label="Run progress" />
          <ProgressBar :value="0.3" label="Failed share" tone="bad" />
          <ProgressBar label="Loading" />
        </div>
        <div class="item">
          <span class="lbl">Buttons and tooltip</span>
          <div class="row">
            <button class="btn primary">Start run</button>
            <button v-tip="'Build the pack again'" class="btn">Reload</button>
            <button class="btn danger">Stop</button>
            <button class="btn" disabled>Disabled</button>
          </div>
        </div>
        <div class="item">
          <span class="lbl">Toasts</span>
          <div class="row">
            <button class="btn" @click="demoToast('info')">Info</button>
            <button class="btn" @click="demoToast('ok')">Passed</button>
            <button class="btn" @click="demoToast('bad')">Error</button>
            <button class="btn" @click="demoToast('warn')">Stays</button>
          </div>
        </div>
        <div class="item">
          <span class="lbl">Status</span>
          <div class="row">
            <StatusChip status="running" />
            <StatusChip status="passed" />
            <StatusChip status="failed" />
            <StatusChip status="paused" />
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">Table</h2>
      <p class="muted note">{{ runs.length }} runs, sorted by a click on a heading. Only the rows on screen are drawn. {{ chosenRuns.length ? `${chosenRuns.length} selected.` : "" }} {{ lastRow }}</p>
      <DataTable
        v-model:sort="runSort"
        v-model:selected="chosenRuns"
        :columns="runColumns"
        :rows="runs"
        :row-key="(r) => r.id"
        label="Runs"
        height="360px"
        selectable
        clickable
        @row-click="(r) => (lastRow = `Opened run ${r.id}.`)"
      >
        <template #cell-id="{ row }"><span class="num">#{{ row.id }}</span></template>
        <template #cell-status="{ row }"><StatusChip :status="row.status" /></template>
        <template #cell-tests="{ row }"><span class="num">{{ row.tests }}</span></template>
        <template #cell-took="{ row }"><span class="num">{{ took(row.took) }}</span></template>
        <template #cell-started="{ row }"><span class="num">{{ row.started }}</span></template>
        <template #footer>
          <button v-if="shown < allRuns.length" class="btn" @click="shown += 150">Load more</button>
          <span v-else class="muted">All {{ allRuns.length }} runs shown</span>
        </template>
      </DataTable>
      <p class="muted note">Empty and loading:</p>
      <div class="pair">
        <DataTable :columns="runColumns.slice(0, 3)" :rows="[]" :row-key="(r: DemoRun) => r.id" label="No runs">
          <template #empty>No runs yet. Start one from a pack.</template>
        </DataTable>
        <DataTable :columns="runColumns.slice(0, 3)" :rows="[]" :row-key="(r: DemoRun) => r.id" label="Loading runs" loading />
      </div>
    </section>

    <section class="card">
      <h2 class="display">Run page tools</h2>
      <div class="grid">
        <div class="item wide">
          <span class="lbl">Split panes</span>
          <p class="muted note">Drag the handle, or focus it and use the arrows. Double-click puts it back. The size is remembered; below 640px the panes stack.</p>
          <div class="split-demo">
            <SplitPane v-model="split" label="Resize screen and log" storage-key="kit" :min-first="200" :min-second="180">
              <template #first>
                <div class="screen"><span class="muted">Live screen</span></div>
              </template>
              <template #second>
                <ol class="log num">
                  <li v-for="l in logLines" :key="l">{{ l }}</li>
                </ol>
              </template>
            </SplitPane>
          </div>
        </div>
        <div class="item wide">
          <span class="lbl">Timeline</span>
          <p class="muted note">Click or drag to move the playhead. Page Up/Down jumps between steps. {{ picked2 }}</p>
          <TimelineScrubber v-model="playhead" :steps="steps" :duration="48_000" :marks="marks" label="Attempt time" @pick="(s) => (picked2 = `Picked: ${s.label}.`)" />
        </div>
        <div class="item wide">
          <span class="lbl">Reorder</span>
          <p class="muted note">Drag a grip, or focus it, press Space, move with the arrows and press Space again. Done and running tests stay put. {{ lastMove }}</p>
          <SortableList
            v-model="queue"
            :item-key="(q) => q.id"
            :item-label="(q) => `${q.id} ${q.name}`"
            :locked="(q) => q.state !== 'waiting'"
            label="Run queue"
            @move="(m) => (lastMove = `Moved ${m.item.id} from ${m.from + 1} to ${m.to + 1}.`)"
          >
            <template #default="{ item, index }">
              <div class="qrow">
                <span class="num muted">{{ index + 1 }}</span>
                <span class="qname"><span class="num">{{ item.id }}</span> {{ item.name }}</span>
                <StatusChip :status="item.state === 'done' ? 'passed' : item.state === 'running' ? 'running' : 'pending'" />
              </div>
            </template>
          </SortableList>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">Navigation and dialogs</h2>
      <div class="grid">
        <div class="item wide">
          <span class="lbl">Tabs</span>
          <TabBar v-model="tab" :tabs="tabs" id-prefix="k" label="Example tabs" />
          <p :id="`k-panel-${tab}`" role="tabpanel" :aria-labelledby="`k-tab-${tab}`" class="muted">Panel: {{ tab }}. Arrow keys move between tabs.</p>
        </div>
        <div class="item">
          <span class="lbl">Menu</span>
          <div class="row">
            <MenuButton :items="menu" label="Run actions" align="start" @select="picked = $event" />
            <span class="muted">{{ picked ? `Picked: ${picked}` : "Nothing picked" }}</span>
          </div>
        </div>
        <div class="item">
          <span class="lbl">Dialog</span>
          <div class="row">
            <button class="btn" @click="dialog = true">Confirm dialog</button>
            <button class="btn" @click="formDialog = true">Form dialog</button>
          </div>
          <ModalDialog v-model="dialog" heading="Delete this run?">
            <p>Its results and files are removed. This can't be undone.</p>
            <template #actions>
              <button class="btn" @click="dialog = false">Cancel</button>
              <button class="btn danger" @click="dialog = false">Delete run</button>
            </template>
          </ModalDialog>
          <ModalDialog v-model="formDialog" heading="Run again">
            <div class="form">
              <label for="k-again-browser">Browser</label>
              <SelectMenu id="k-again-browser" v-model="browser" :options="browsers" />
              <label for="k-again-tests">Tests</label>
              <MultiSelect id="k-again-tests" v-model="tests" :options="testOptions" empty-label="All tests" />
            </div>
            <template #actions>
              <button class="btn" @click="formDialog = false">Cancel</button>
              <button class="btn primary" @click="formDialog = false">Start run</button>
            </template>
          </ModalDialog>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">Media</h2>
      <div class="grid">
        <div class="item wide">
          <span class="lbl">Image viewer (click a shot; arrows, Z to zoom, Esc to close)</span>
          <div class="shots">
            <button v-for="(s, i) in shots" :key="s.name" type="button" class="shot" @click="shotOpen = i">
              <img :src="s.url" :alt="s.name" />
              <span class="muted">{{ s.name }}</span>
            </button>
          </div>
          <ImageViewer v-model="shotOpen" :images="shots" label="Sample shots" />
        </div>
        <div class="item wide">
          <span class="lbl">Video player (Space or K, arrows, comma and period, F)</span>
          <VideoPlayer class="video" src="kit/sample.webm" label="Sample video" />
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-6);
  display: grid;
  gap: var(--space-4);
}
h1 {
  margin: 0;
  font-size: 22px;
}
header p {
  margin: var(--space-1) 0 0;
}
.muted {
  color: var(--muted);
}
.card {
  background: var(--surface);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  padding: 18px 20px;
  min-width: 0;
}
.card h2 {
  margin: 0 0 var(--space-4);
  font-size: 15px;
  font-weight: 600;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-5) var(--space-6);
}
.item {
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-width: 0;
}
.item.wide {
  grid-column: 1 / -1;
}
.item > label[for],
.lbl {
  font-weight: 600;
  font-size: 13px;
}
.form {
  display: grid;
  gap: var(--space-2);
}
.form label {
  font-weight: 600;
  font-size: 13px;
}
.note {
  margin: 0 0 var(--space-3);
  font-size: 13px;
}
.icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.icons li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 8px 10px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
}
.icons .mono {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.split-demo {
  display: grid;
  min-height: 240px;
}
.screen {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 160px;
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--raised);
}
.log {
  margin: 0;
  padding: 0 0 0 var(--space-2);
  list-style: none;
  font-size: 12px;
  line-height: 1.8;
}
.qrow {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.qname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
}
.err {
  color: var(--bad);
  font-size: 12px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.shots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-3);
}
.shot {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: zoom-in;
}
.shot img {
  width: 100%;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
}
.video {
  max-width: 640px;
}
@media (max-width: 640px) {
  .page {
    padding: var(--space-4);
  }
}
</style>
