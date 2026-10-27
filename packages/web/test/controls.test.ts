import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// The page must not show the browser's own form controls. These checks keep native
// checkboxes, selects, radios and number spinners from creeping back into the app.
// CheckBox, RadioGroup and ThemePicker keep a hidden native input for keyboard and screen
// readers, FilePicker a hidden file input that only opens the system dialog, and TextArea
// is the themed <textarea>.
const src = new URL("../src/", import.meta.url);
const allowed = new Set(["components/CheckBox.vue", "components/RadioGroup.vue", "components/ThemePicker.vue", "components/FilePicker.vue", "components/TextArea.vue"]);
const files = (await readdir(src, { recursive: true }))
  .map((f) => f.replaceAll("\\", "/")) // Windows lists with backslashes
  .filter((f) => f.endsWith(".vue") && !allowed.has(f));

describe("controls", () => {
  it("finds the components", () => {
    expect(files).toContain("views/RunsView.vue");
  });
  it.each(files)("%s uses the themed controls", async (file) => {
    const sfc = await readFile(new URL(file, src), "utf8");
    const text = sfc.slice(sfc.indexOf("<template>"), sfc.lastIndexOf("</template>"));
    expect(text).not.toMatch(/<select\b/);
    expect(text).not.toMatch(/type="(checkbox|radio|number|range|date|datetime-local|month|week|time|color|file)"/);
    expect(text).not.toMatch(/<(progress|meter|datalist|textarea)\b/);
    // Tooltips use v-tip, not the browser's title popup.
    expect(text).not.toMatch(/\s:?title="/);
  });
});
