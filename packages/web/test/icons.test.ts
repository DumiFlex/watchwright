import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// Icons come from src/icons.ts (Lucide), not hand-drawn <svg> in templates or arrows and
// symbols typed as text. BrandMark is the logo, TextArea's corner grip is a drawing, and
// SparkLine and BarChart draw data; none of them is an icon.
const src = new URL("../src/", import.meta.url);
const drawn = new Set(["components/BrandMark.vue", "components/TextArea.vue", "components/SparkLine.vue", "components/BarChart.vue"]);
const all = (await readdir(src, { recursive: true })).map((f) => f.replaceAll("\\", "/"));
const vue = all.filter((f) => f.endsWith(".vue"));
const code = all.filter((f) => /\.(vue|ts)$/.test(f) && f !== "icons.ts");

const template = (sfc: string) => sfc.slice(sfc.indexOf("<template>"), sfc.lastIndexOf("</template>"));

describe("icons", () => {
  it.each(vue.filter((f) => !drawn.has(f)))("%s draws no icons of its own", async (file) => {
    expect(template(await readFile(new URL(file, src), "utf8"))).not.toMatch(/<svg\b/);
  });
  it.each(vue)("%s uses no text symbols as icons", async (file) => {
    expect(template(await readFile(new URL(file, src), "utf8"))).not.toMatch(/[←→↑↓▶◀■□▲▼►✓✔✕✖✗›‹»«☰⋮⋯]/);
  });
  it.each(code)("%s imports icons from src/icons.ts", async (file) => {
    expect(await readFile(new URL(file, src), "utf8")).not.toMatch(/from "@lucide\/vue"/);
  });
});
