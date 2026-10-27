<script setup lang="ts">
// Every themed control on one page (#/kit), to check them in each look and mode and to copy
// from when a feature needs one. The page is not linked from the app.
import { computed, ref } from "vue";
import BreadCrumbs from "../components/BreadCrumbs.vue";
import BarChart, { type BarItem, type BarSeries } from "../components/BarChart.vue";
import CheckBox from "../components/CheckBox.vue";
import CheckTree from "../components/CheckTree.vue";
import CommandPalette, { type PaletteCommand } from "../components/CommandPalette.vue";
import CodeEditor from "../components/CodeEditor.vue";
import CodeView from "../components/CodeView.vue";
import MarkdownView from "../components/MarkdownView.vue";
import DataTable from "../components/DataTable.vue";
import DatePicker from "../components/DatePicker.vue";
import DateRangePicker, { type DateRange } from "../components/DateRangePicker.vue";
import DiffView from "../components/DiffView.vue";
import HistoryStrip from "../components/HistoryStrip.vue";
import FilePicker from "../components/FilePicker.vue";
import FolderBrowser from "../components/FolderBrowser.vue";
import PathInput from "../components/PathInput.vue";
import PathLine from "../components/PathLine.vue";
import ImageViewer from "../components/ImageViewer.vue";
import JsonTree from "../components/JsonTree.vue";
import KeyHint from "../components/KeyHint.vue";
import MenuButton from "../components/MenuButton.vue";
import ModalDialog from "../components/ModalDialog.vue";
import MultiSelect from "../components/MultiSelect.vue";
import NumberInput from "../components/NumberInput.vue";
import ProgressBar from "../components/ProgressBar.vue";
import RadioGroup from "../components/RadioGroup.vue";
import RangeSlider from "../components/RangeSlider.vue";
import ScoreInput from "../components/ScoreInput.vue";
import SelectMenu from "../components/SelectMenu.vue";
import SideDrawer from "../components/SideDrawer.vue";
import SkeletonBlock from "../components/SkeletonBlock.vue";
import SparkLine from "../components/SparkLine.vue";
import StatTile from "../components/StatTile.vue";
import SortableList from "../components/SortableList.vue";
import SplitPane from "../components/SplitPane.vue";
import StatusChip from "../components/StatusChip.vue";
import TabBar from "../components/TabBar.vue";
import TextArea from "../components/TextArea.vue";
import TextField from "../components/TextField.vue";
import TargetField from "../components/TargetField.vue";
import TimelineScrubber, { type TimelineMark } from "../components/TimelineScrubber.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";
import VideoPlayer from "../components/VideoPlayer.vue";
import type { Criterion, HistoryEntry, Score } from "../api";
import type { Sort } from "../table";
import type { TimelineStep } from "../timeline";
import type { TreeNode } from "../tree";
import type { Target } from "../yamlsteps";
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
const folderPath = ref("");
const browsed = ref<string | null>(null);
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
const mdText = ref(`# Checkout pack

Tests for the **shop's** checkout. Start with [the setup notes](#setup), or read the
[Watchwright guide](https://example.com/guide).

## Setup

1. Start the shop on \`http://localhost:3000\`.
2. Run the *smoke* tests first.

- [x] Guest checkout
- [ ] Saved cards
- [ ] ~~Gift wrap~~ (dropped)

> Runs take about ten minutes on a laptop.

| Test | Needs | Time |
|:-----|:------|-----:|
| C1 | S1 | 42 s |
| C2 | C1 | 1 m 5 s |

\`\`\`ts
await h.click("Pay now");
\`\`\`
`);

const testCode = `import { test, expect } from "watchwright";

// Guest checkout: add boots to the cart and pay as a guest.
test("C1 Guest checkout", { needs: ["S1"] }, async ({ page, h }) => {
  await page.goto("/products/boots");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await h.step("Checkout", async () => {
    await page.getByRole("link", { name: "Checkout" }).click();
    await expect(page.getByTestId("total")).toHaveText("59.90");
  });
  const shots = 3; /* one per page */
  await h.screenshot("checkout", { fullPage: true, count: shots });
});`;
const expectedText = ["Order summary", "Trail boots, size 42", "Qty 1", "Subtotal 59.90", "Shipping free", "Total 59.90", "", "Pay as a guest", "Email", "Card number", "Pay now"].join("\n");
const actualText = ["Order summary", "Trail boots, size 42", "Qty 1", "Subtotal 59.90", "Shipping 5.00", "Total 64.90", "", "Pay as a guest", "Email", "Card number", "Pay now", "Have a coupon?"].join("\n");
const diffMode = ref<"unified" | "split">("split");
const yamlText = ref(`id: T1
title: Add a todo
steps:
  - goto: /todomvc/
  - fill: { target: { placeholder: What needs to be done? }, value: Buy milk }
  - press: Enter
  - expect: { target: { testId: todo-title }, text: Buy milk }
`);
const pickedTarget = ref<Target | undefined>({ role: "button", name: "Save" });
const sampleJson = {
  id: "0a1b2c3d",
  pack: "shop-smoke",
  status: "failed",
  startedAt: "2026-10-27T00:12:04Z",
  counts: { planned: 6, passed: 4, failed: 1, broken: 0, skipped: 1 },
  browsers: ["chromium", "firefox"],
  options: { trace: "problems", headless: true, pauseLimit: 20, baseUrl: "https://shop.example.test" },
  attempts: [
    { test: "H1", browser: "chromium", status: "passed", ms: 4210 },
    { test: "C1", browser: "chromium", status: "failed", ms: 41_380, error: { message: "Expected 59.90, got 64.90", line: 10 } },
  ],
  note: null,
};
const packTree: TreeNode[] = [
  {
    id: "shop-smoke",
    label: "shop-smoke",
    children: [
      { id: "home", label: "Home", children: [{ id: "H1", label: "H1 Home page loads" }, { id: "H2", label: "H2 Banner rotates" }] },
      { id: "search", label: "Search", children: [{ id: "S1", label: "S1 Search finds products" }, { id: "S2", label: "S2 Filters narrow results" }, { id: "S3", label: "S3 Typo still finds boots" }] },
      { id: "checkout", label: "Checkout", children: [{ id: "C1", label: "C1 Guest checkout" }, { id: "C2", label: "C2 Checkout with an account" }] },
    ],
  },
  { id: "account-flows", label: "account-flows", children: [{ id: "A1", label: "A1 Sign in" }, { id: "A2", label: "A2 Reset password" }] },
];
const pickedTests = ref<string[]>(["S1", "S2", "S3", "C1"]);
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

// "At a glance": made-up numbers for the last 24 runs of a pack.
const runIds = Array.from({ length: 24 }, (_, i) => `#${101 + i}`);
// History strips: one letter per attempt, oldest first (p passed, f failed, b broken, s skipped, r passed on a retry).
const historyOf = (seq: string): HistoryEntry[] =>
  [...seq].map((c, i) => ({
    attemptId: `kit${String(i).padStart(9, "0")}`,
    runId: `0a1b2c${String(i).padStart(2, "0")}`,
    runLabel: "",
    number: 1,
    try: c === "r" ? 2 : 1,
    status: ({ p: "passed", r: "passed", f: "failed", b: "broken", s: "skipped" } as const)[c as "p"],
    startedAt: new Date(Date.UTC(2026, 9, 8 + i, 9)).toISOString(),
    durationMs: 3000 + ((i * 37) % 900),
    params: { lang: "de" },
  }));
const histories = [
  { id: "H1", seq: "pppppppppppppppppppp" },
  { id: "S2", seq: "ppfppfpppfppfppppfpp" },
  { id: "C2", seq: "ssssssspppprppbppppp" },
];
const passedPerRun = runIds.map((_, i) => 38 + ((i * 7) % 9) - (i % 5 === 3 ? 6 : 0));
const failedPerRun = runIds.map((_, i) => (i % 5 === 3 ? 7 : (i * 3) % 4));
const brokenPerRun = runIds.map((_, i) => (i % 7 === 2 ? 2 : 0));
const skippedPerRun = runIds.map((_, i) => (i % 6 === 0 ? 3 : 1));
const runSeries: BarSeries[] = [
  { key: "passed", label: "Passed", tone: "ok" },
  { key: "failed", label: "Failed", tone: "bad" },
  { key: "broken", label: "Broken", tone: "warn" },
  { key: "skipped", label: "Skipped", tone: "muted" },
];
const runBars: BarItem[] = runIds.map((label, i) => ({
  label,
  values: { passed: passedPerRun[i] ?? 0, failed: failedPerRun[i] ?? 0, broken: brokenPerRun[i] ?? 0, skipped: skippedPerRun[i] ?? 0 },
}));
const passRate = runIds.map((_, i) => {
  const p = passedPerRun[i] ?? 0;
  return Math.round((p / (p + (failedPerRun[i] ?? 0) + (brokenPerRun[i] ?? 0))) * 1000) / 10;
});
const minutes = runIds.map((_, i) => 14 + ((i * 5) % 7) + (i > 16 ? 3 : 0));
const pickedRun = ref("");
const loading = ref(true);
const drawer = ref(false);
const drawerStart = ref(false);
const palette = ref(false);
const ran = ref("");
const demoCommands: PaletteCommand[] = [
  { id: "rerun", label: "Run again", group: "Run 0a1b2c3d", keys: "Mod+Enter", icon: icons.RotateCcw, run: () => (ran.value = "Run again") },
  { id: "pause", label: "Pause at the next step", group: "Run 0a1b2c3d", keys: "P", icon: icons.Pause, run: () => (ran.value = "Pause") },
  { id: "stop", label: "Stop the run", group: "Run 0a1b2c3d", icon: icons.Square, run: () => (ran.value = "Stop") },
  { id: "trace", label: "Open the trace of C1 Guest checkout", group: "Run 0a1b2c3d", words: "playwright viewer", icon: icons.FileCode, run: () => (ran.value = "Open trace") },
  { id: "packs", label: "Go to packs", group: "Go to", icon: icons.FolderOpen, run: () => (ran.value = "Go to packs") },
  { id: "runs", label: "Go to runs", group: "Go to", icon: icons.ListChecks, run: () => (ran.value = "Go to runs") },
  { id: "copy", label: "Copy the run id", group: "Other", icon: icons.Copy, run: () => (ran.value = "Copy the run id") },
];
const crumbs = [
  { label: "Runs", href: "#/" },
  { label: "0a1b2c3d", href: "#/kit" },
  { label: "C1 Guest checkout" },
];
const deepCrumbs = [
  { label: "Packs", href: "#/packs" },
  { label: "shop-smoke", href: "#/kit" },
  { label: "Checkout", href: "#/kit" },
  { label: "C1 Guest checkout", href: "#/kit" },
  { label: "Attempt 2", href: "#/kit" },
  { label: "Step 4" },
];
const shortcuts = [
  { keys: "Mod+K", what: "Open the command palette" },
  { keys: "Mod+Enter", what: "Start the run" },
  { keys: "Escape", what: "Close a dialog or menu" },
  { keys: "ArrowUp", what: "Previous item" },
  { keys: "Shift+?", what: "Show the shortcuts" },
];

const overall: Criterion = { id: "overall", title: "Overall", description: null, kind: "scale", scale: 5 };
const tone: Criterion = { id: "tone", title: "Tone", description: null, kind: "choices", choices: ["Too formal", "Right", "Too casual"] };
const found: Criterion = { id: "found", title: "Found the product", description: null, kind: "yesNo" };
const overallScore = ref<Score | null>(4);
const toneScore = ref<Score | null>(null);
const foundScore = ref<Score | null>(true);

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
      <h2 class="display">Folders</h2>
      <p class="muted note">Folders on the server's machine (a page never learns a folder's path from the browser). <code>PathInput</code> completes as you type (Tab, arrows, Enter) and says whether the folder has a pack; <code>PathLine</code> shows a path that always fits; <code>FolderBrowser</code> browses with places, crumbs and a filter.</p>
      <div class="grid">
        <div class="item wide"><label for="k-folder">Path with completion</label><PathInput id="k-folder" v-model="folderPath" placeholder="Start with / or C:\ or ~/" mark="pack" mark-label="Pack" /></div>
        <div class="item wide"><span class="muted small">Path line</span><PathLine path="/home/sam/projects/clients/acme-storefront/packages/end-to-end/watchwright" home="/home/sam" /></div>
      </div>
      <FolderBrowser v-model:path="browsed" :mark-labels="{ pack: 'Pack' }" />
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
      <h2 class="display">Inspecting</h2>
      <div class="grid">
        <div class="item wide">
          <span class="lbl">Code</span>
          <CodeView :code="testCode" lang="ts" label="Test file" name="tests/checkout.test.ts" :marked="[9]" max-height="320px" />
        </div>
        <div class="item wide">
          <span class="lbl">Code editor (a YAML test: completion and hover)</span>
          <div class="kit-editor"><CodeEditor v-model="yamlText" lang="yaml" steps label="YAML test" /></div>
        </div>
        <div class="item">
          <span class="lbl">Target</span>
          <TargetField id="kit-target" v-model="pickedTarget" label="target" />
        </div>
        <div class="item wide">
          <span class="lbl">Markdown (edit the source, the preview follows)</span>
          <div class="kit-md">
            <div class="kit-editor tall"><CodeEditor v-model="mdText" lang="markdown" label="Markdown source" /></div>
            <div class="kit-md-preview"><MarkdownView :source="mdText" id-prefix="kit-md-" label="Markdown preview" /></div>
          </div>
        </div>
        <div class="item wide">
          <span class="lbl">Diff</span>
          <DiffView v-model:mode="diffMode" :before="expectedText" :after="actualText" label="Page text, checkout" before-label="Expected" after-label="Got" :context="2" />
        </div>
        <div class="item wide">
          <span class="lbl">JSON</span>
          <JsonTree :value="sampleJson" label="run" :open-depth="1" max-height="360px" />
        </div>
        <div class="item wide">
          <span class="lbl">Tree with checkboxes</span>
          <p class="muted note">{{ pickedTests.length }} tests picked: {{ pickedTests.join(", ") || "none" }}</p>
          <CheckTree v-model="pickedTests" :nodes="packTree" label="Tests to run" />
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
      <h2 class="display">Getting around</h2>
      <div class="grid">
        <div class="item">
          <span class="lbl">Command palette</span>
          <div class="row">
            <button class="btn" @click="palette = true">Open palette</button>
            <span class="muted">{{ ran ? `Ran: ${ran}` : "Or press" }} <KeyHint v-if="!ran" keys="Mod+K" /></span>
          </div>
          <p class="muted note">The app's own palette (pages, looks and modes) opens with <KeyHint keys="Mod+K" /> anywhere. This one shows run commands.</p>
          <CommandPalette v-model:open="palette" :commands="demoCommands" label="Run commands" />
        </div>
        <div class="item">
          <span class="lbl">Side drawer</span>
          <div class="row">
            <button class="btn" @click="drawer = true">From the end</button>
            <button class="btn" @click="drawerStart = true">From the start</button>
          </div>
          <SideDrawer v-model="drawer" heading="Attempt 2 of C1 Guest checkout">
            <p class="muted">Details open next to the page instead of over it.</p>
            <JsonTree :value="sampleJson" label="Attempt details" :open-depth="1" />
            <template #actions>
              <button class="btn" @click="drawer = false">Close</button>
              <button class="btn primary" @click="drawer = false">Open attempt</button>
            </template>
          </SideDrawer>
          <SideDrawer v-model="drawerStart" heading="Filters" side="start" width="320px">
            <div class="form">
              <label for="k-drawer-browser">Browser</label>
              <SelectMenu id="k-drawer-browser" v-model="browser" :options="browsers" />
              <label for="k-drawer-tests">Tests</label>
              <MultiSelect id="k-drawer-tests" v-model="tests" :options="testOptions" empty-label="All tests" />
            </div>
          </SideDrawer>
        </div>
        <div class="item wide">
          <span class="lbl">Breadcrumbs</span>
          <BreadCrumbs :items="crumbs" />
          <BreadCrumbs :items="deepCrumbs" />
        </div>
        <div class="item wide">
          <span class="lbl">Shortcut keys</span>
          <dl class="shortcut-list">
            <template v-for="k in shortcuts" :key="k.keys">
              <dt><KeyHint :keys="k.keys" /></dt>
              <dd>{{ k.what }}</dd>
            </template>
          </dl>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">At a glance</h2>
      <div class="grid">
        <div class="item wide">
          <span class="lbl">Stat tiles</span>
          <div class="tiles">
            <StatTile label="Pass rate" :value="passRate.at(-1) ?? 0" unit="%" :delta="1.6" period="last week" :format-delta="(v: number) => `${v > 0 ? '+' : ''}${v} pts`" :trend="passRate" :trend-labels="runIds" />
            <StatTile label="Runs this week" :value="24" :delta="6" period="last week" :trend="[3, 2, 4, 5, 3, 4, 3]" />
            <StatTile label="Median run time" :value="18" unit=" min" :delta="3" period="last week" good-when="down" :trend="minutes" :trend-labels="runIds" />
            <StatTile label="Broken tests" :value="0" :delta="0" period="the previous run" good-when="down" />
          </div>
        </div>
        <div class="item wide">
          <span class="lbl">Bar chart</span>
          <p class="muted note">Tests per run for shop-smoke. {{ pickedRun ? `Clicked: ${pickedRun}` : "Hover a column; click to open it." }}</p>
          <BarChart :items="runBars" :series="runSeries" label="Tests per run, shop-smoke" @pick="pickedRun = runBars[$event]?.label ?? ''" />
        </div>
        <div class="item">
          <span class="lbl">Sparklines</span>
          <div class="spark-rows">
            <span class="muted">Pass rate</span>
            <SparkLine :values="passRate" :labels="runIds" label="Pass rate" :format="(v: number) => `${v}%`" />
            <span class="num">{{ passRate.at(-1) }}%</span>
            <span class="muted">Failures</span>
            <SparkLine :values="failedPerRun" :labels="runIds" label="Failures per run" kind="bars" />
            <span class="num">{{ failedPerRun.at(-1) }}</span>
            <span class="muted">Run time</span>
            <SparkLine :values="minutes" :labels="runIds" label="Run time in minutes" tone="muted" :format="(v: number) => `${v} min`" />
            <span class="num">{{ minutes.at(-1) }} min</span>
          </div>
        </div>
        <div class="item">
          <span class="lbl">Test history</span>
          <div v-for="h in histories" :key="h.id" class="row">
            <code>{{ h.id }}</code>
            <HistoryStrip :entries="historyOf(h.seq)" :label="`Last attempts of ${h.id}`" />
          </div>
        </div>
        <div class="item">
          <span class="lbl">Loading placeholders</span>
          <ToggleSwitch v-model="loading">Loading</ToggleSwitch>
          <div class="skeleton-demo" :aria-busy="loading">
            <template v-if="loading">
              <div class="row">
                <SkeletonBlock shape="circle" width="36px" />
                <SkeletonBlock width="50%" />
              </div>
              <SkeletonBlock :lines="3" />
              <SkeletonBlock shape="block" height="64px" />
            </template>
            <template v-else>
              <div class="row">
                <span class="avatar" aria-hidden="true">S</span>
                <strong>shop-smoke</strong>
              </div>
              <p class="muted">Smoke tests for the shop: home, search and a guest checkout, in Chromium and Firefox.</p>
              <SparkLine :values="passRate" :labels="runIds" label="Pass rate" kind="bars" :height="64" :format="(v: number) => `${v}%`" />
            </template>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="display">Media</h2>
      <div class="grid">
        <div class="item wide">
          <span class="lbl">Image viewer (click a shot; arrows, + and - or Ctrl+wheel to zoom, drag to pan, Esc to close)</span>
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

    <section class="card">
      <h2 class="display">Review</h2>
      <div class="grid">
        <div class="item">
          <span class="lbl">Score on a scale (digits pick, pick again to clear)</span>
          <ScoreInput v-model="overallScore" :criterion="overall" />
        </div>
        <div class="item">
          <span class="lbl">Named choices</span>
          <ScoreInput v-model="toneScore" :criterion="tone" />
        </div>
        <div class="item">
          <span class="lbl">Yes or no</span>
          <ScoreInput v-model="foundScore" :criterion="found" />
        </div>
        <div class="item">
          <span class="lbl">Disabled</span>
          <ScoreInput :model-value="3" :criterion="overall" disabled />
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
.kit-editor {
  height: 220px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.kit-editor.tall {
  height: 480px;
}
.kit-md {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.kit-md-preview {
  height: 480px;
  overflow: auto;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
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
  .kit-md {
    grid-template-columns: 1fr;
  }
  .page {
    padding: var(--space-4);
  }
}
.shortcut-list {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  margin: 0;
}
.shortcut-list dd {
  margin: 0;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}
.spark-rows {
  display: grid;
  grid-template-columns: max-content minmax(80px, 1fr) max-content;
  gap: var(--space-3);
  align-items: center;
}
.skeleton-demo {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
  min-height: 170px;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
}
.skeleton-demo p {
  margin: 0;
}
.avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}
</style>
