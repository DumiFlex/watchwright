import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../src/plugins/settings/plugin.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function harness(dataDir = tempDir("ww-data-")) {
  const h = await startHarness(dataDir);
  harnesses.push(h);
  return h;
}

describe("settings", () => {
  it("lists every setting with its default and definition", async () => {
    const h = await harness();
    const res = await h.api<{ values: Record<string, unknown>; definitions: { key: string; default: unknown }[] }>("GET", "/settings");
    expect(res.data.values["settings.editor"]).toBe("vscode");
    expect(res.data.definitions.map((d) => d.key)).toContain("settings.editor");
  });

  it("changes values, keeps them across a restart and puts them back with null", async () => {
    const dir = tempDir("ww-data-");
    const h = await harness(dir);
    const set = await h.api<{ values: Record<string, unknown> }>("POST", "/settings", { values: { "settings.editor": "cursor" } });
    expect(set.data.values["settings.editor"]).toBe("cursor");
    await h.close();
    harnesses.splice(harnesses.indexOf(h), 1);
    const again = await harness(dir);
    expect((await again.api<{ values: Record<string, unknown> }>("GET", "/settings")).data.values["settings.editor"]).toBe("cursor");
    const reset = await again.api<{ values: Record<string, unknown> }>("POST", "/settings", { values: { "settings.editor": null } });
    expect(reset.data.values["settings.editor"]).toBe("vscode");
  });

  it("refuses unknown keys and values outside a setting's schema, changing nothing", async () => {
    const h = await harness();
    expect((await h.api("POST", "/settings", { values: { "nope.x": 1 } })).error?.code).toBe("unknown_setting");
    const bad = await h.api("POST", "/settings", { values: { "settings.editor": "notepad" } });
    expect(bad.error?.code).toBe("invalid_setting");
    expect(h.app.watchwright.services.get(SETTINGS).get("settings.editor")).toBe("vscode");
  });
});
