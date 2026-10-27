<script setup lang="ts">
// Every themed control on one page (#/kit), to check them in each look and mode and to copy
// from when a feature needs one. The page is not linked from the app.
import { ref } from "vue";
import CheckBox from "../components/CheckBox.vue";
import DatePicker from "../components/DatePicker.vue";
import FilePicker from "../components/FilePicker.vue";
import MenuButton from "../components/MenuButton.vue";
import ModalDialog from "../components/ModalDialog.vue";
import MultiSelect from "../components/MultiSelect.vue";
import NumberInput from "../components/NumberInput.vue";
import ProgressBar from "../components/ProgressBar.vue";
import RadioGroup from "../components/RadioGroup.vue";
import RangeSlider from "../components/RangeSlider.vue";
import SelectMenu from "../components/SelectMenu.vue";
import StatusChip from "../components/StatusChip.vue";
import TabBar from "../components/TabBar.vue";
import TextArea from "../components/TextArea.vue";
import TextField from "../components/TextField.vue";
import ToggleSwitch from "../components/ToggleSwitch.vue";
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
.err {
  color: var(--bad);
  font-size: 12px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
@media (max-width: 640px) {
  .page {
    padding: var(--space-4);
  }
}
</style>
