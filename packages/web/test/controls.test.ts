import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// The page must not show the browser's own form controls. These checks keep native
// checkboxes, selects, radios and number spinners from creeping back into the app.
// CheckBox and ThemePicker keep a hidden native input for keyboard and screen readers.
const src = new URL("../src/", import.meta.url);
const allowed = new Set(["components/CheckBox.vue", "components/ThemePicker.vue"]);
const files = (await readdir(src, { recursive: true })).filter((f) => f.endsWith(".vue") && !allowed.has(f.replaceAll("\\", "/")));

describe("controls", () => {
  it("finds the components", () => {
    expect(files).toContain("views/HomeView.vue");
  });
  it.each(files)("%s uses the themed controls", async (file) => {
    const sfc = await readFile(new URL(file, src), "utf8");
    const text = sfc.slice(sfc.indexOf("<template>"), sfc.lastIndexOf("</template>"));
    expect(text).not.toMatch(/<select\b/);
    expect(text).not.toMatch(/type="(checkbox|radio|number|range|date|datetime-local|time|color|file)"/);
  });
});
