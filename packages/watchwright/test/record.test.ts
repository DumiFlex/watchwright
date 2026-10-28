import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WwEvent } from "../src/events/log.js";
import { keyWithModifiers, relativeUrl, stepOfAction, targetOfLocator } from "../src/plugins/record/actions.js";
import { candidatesOf, roleOf, sameTarget, withAlternatives, type ElementInfo } from "../src/plugins/record/candidates.js";
import { canOpenWindow } from "../src/plugins/record/plugin.js";
import type { RecordEntry } from "../src/plugins/record/session.js";
import { outermostLine } from "../src/plugins/record/upto.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

describe("recorder actions as steps", () => {
  it("maps locator chains onto targets", () => {
    expect(targetOfLocator({ kind: "role", body: "button", options: { name: "Save", exact: false, attrs: [] } })).toEqual({ role: "button", name: "Save" });
    expect(targetOfLocator({ kind: "role", body: "checkbox", options: { name: "Done", exact: true, attrs: [{ name: "checked", value: true }] } })).toEqual({ role: "checkbox", name: "Done", exact: true, checked: true });
    expect(targetOfLocator({ kind: "test-id", body: "total" })).toEqual({ testId: "total" });
    expect(targetOfLocator({ kind: "default", body: "#cb" })).toBe("#cb");
    expect(targetOfLocator({ kind: "text", body: "Hello", options: { exact: true } })).toEqual({ text: "Hello", exact: true });
    expect(
      targetOfLocator({
        kind: "role",
        body: "listitem",
        options: { attrs: [] },
        next: { kind: "has-text", body: "B Del", options: { exact: false }, next: { kind: "role", body: "button", options: { attrs: [] } } },
      }),
    ).toEqual({ role: "button", within: { role: "listitem", hasText: "B Del" } });
    expect(targetOfLocator({ kind: "test-id", body: "item", next: { kind: "nth", body: "1" } })).toEqual({ testId: "item", nth: 1 });
    expect(targetOfLocator({ kind: "frame-thing", body: "x" })).toBeNull();
  });

  it("turns each action into the matching step", () => {
    const loc = { kind: "role", body: "textbox", options: { name: "Email", attrs: [] } };
    const target = { role: "textbox", name: "Email" };
    expect(stepOfAction({ name: "navigate", url: "http://site.test/form?x=1" }, "http://site.test/")).toEqual({ name: "goto", args: { url: "/form?x=1" } });
    expect(stepOfAction({ name: "navigate", url: "about:blank" }, null)).toBeNull();
    expect(stepOfAction({ name: "openPage", url: "about:blank" }, null)).toBeNull();
    expect(stepOfAction({ name: "click", locator: loc, clickCount: 1, button: "left" }, null)).toEqual({ name: "click", args: { target } });
    expect(stepOfAction({ name: "click", locator: loc, clickCount: 2, button: "right", position: { x: 10.4, y: 3.6 } }, null)).toEqual({ name: "dblclick", args: { target, button: "right", position: { x: 10, y: 4 } } });
    expect(stepOfAction({ name: "fill", locator: loc, text: "ada" }, null)).toEqual({ name: "fill", args: { target, value: "ada" } });
    expect(stepOfAction({ name: "press", locator: loc, key: "a", modifiers: 2 }, null)).toEqual({ name: "press", args: { target, key: "Control+a" } });
    expect(stepOfAction({ name: "check", locator: loc }, null)).toEqual({ name: "check", args: { target } });
    expect(stepOfAction({ name: "select", locator: loc, options: ["l"] }, null)).toEqual({ name: "select", args: { target, option: "l" } });
    expect(stepOfAction({ name: "select", locator: loc, options: ["a", "b"] }, null)?.args.option).toEqual(["a", "b"]);
    expect(stepOfAction({ name: "click", selector: "internal:text=x", clickCount: 1 }, null)).toEqual({ name: "click", args: { target: "internal:text=x" } });
    expect(stepOfAction({ name: "assertText", locator: loc }, null)).toBeNull();
  });

  it("writes keys and URLs the way steps do", () => {
    expect(keyWithModifiers("Enter")).toBe("Enter");
    expect(keyWithModifiers("A", 2 | 8)).toBe("Control+Shift+A");
    expect(relativeUrl("http://a.test/x#y", "http://a.test/app/")).toBe("/x#y");
    expect(relativeUrl("http://b.test/x", "http://a.test/")).toBe("http://b.test/x");
    expect(relativeUrl("http://b.test/x", null)).toBe("http://b.test/x");
  });
});

describe("stopping a code test at the cursor", () => {
  it("reads the line of the outermost frame in the test file", () => {
    const stack = [
      "Error",
      "    at Object.onApiCallBegin (/srv/ww/dist/plugins/record/upto.js:50:21)",
      "    at helper (/packs/demo/tests/home.ts:30:11)",
      "    at async body (/packs/demo/tests/home.ts:12:5)",
      "    at async file:///packs/demo/tests/home.ts:14:3",
      "    at async RecordSession.runCodeUpTo (/srv/ww/dist/plugins/record/session.js:300:7)",
    ].join("\n");
    expect(outermostLine(stack, "/packs/demo/tests/home.ts")).toBe(14);
    expect(outermostLine(stack, "/packs/demo/tests/other.ts")).toBeNull();
    if (process.platform === "win32") expect(outermostLine("    at async file:///C:/packs/t.ts:7:3\n    at async C:\\packs\\t.ts:9:3", "C:\\packs\\t.ts")).toBe(9);
  });
});

describe("candidate targets", () => {
  const info = (over: Partial<ElementInfo>): ElementInfo => ({
    tag: "div",
    type: null,
    role: null,
    testId: null,
    ariaLabel: null,
    labels: [],
    placeholder: null,
    alt: null,
    title: null,
    text: "",
    id: null,
    name: null,
    href: false,
    box: { x: 0, y: 0, width: 10, height: 10 },
    value: null,
    checked: null,
    ...over,
  });

  it("knows the roles tags imply", () => {
    expect(roleOf(info({ tag: "button" }))).toBe("button");
    expect(roleOf(info({ tag: "a", href: true }))).toBe("link");
    expect(roleOf(info({ tag: "a" }))).toBeNull();
    expect(roleOf(info({ tag: "input", type: "checkbox" }))).toBe("checkbox");
    expect(roleOf(info({ tag: "input" }))).toBe("textbox");
    expect(roleOf(info({ tag: "h2" }))).toBe("heading");
    expect(roleOf(info({ tag: "div", role: "tab extra" }))).toBe("tab");
  });

  it("offers test id, role, label, placeholder, text and readable ids, best first", () => {
    expect(candidatesOf(info({ tag: "button", testId: "save", text: "Save", id: "save-btn" }))).toEqual([{ testId: "save" }, { role: "button", name: "Save" }, { text: "Save" }, "#save-btn"]);
    expect(candidatesOf(info({ tag: "input", labels: ["Email"], placeholder: "you@site", name: "email", id: "r123" }))).toEqual([
      { role: "textbox", name: "Email" },
      { label: "Email" },
      { placeholder: "you@site" },
      'input[name="email"]',
    ]);
    // Long text and generated ids aren't offered.
    expect(candidatesOf(info({ text: "x".repeat(80), id: "ember12345" }))).toEqual([]);
  });

  it("keeps the first target and adds the others once", () => {
    expect(sameTarget({ role: "button", name: "A" }, { name: "A", role: "button" })).toBe(true);
    expect(withAlternatives({ role: "button", name: "A" }, [{ name: "A", role: "button" }, "#a"])).toEqual([{ role: "button", name: "A" }, "#a"]);
  });

  it("opens a window only where there is a screen", () => {
    expect(canOpenWindow({}, "win32")).toBe(true);
    expect(canOpenWindow({}, "linux")).toBe(false);
    expect(canOpenWindow({ DISPLAY: ":0" }, "linux")).toBe(true);
  });
});

const run = hasChromium || requireBrowsers ? describe : describe.skip;

let site: { url: string; close(): Promise<void> };
const harnesses: Harness[] = [];
const VIEWPORT = { width: 800, height: 600 };

/** Where an element is on the fixture page at the recording's viewport (the layout is the same in any Chromium). */
async function centerOf(url: string, selector: string): Promise<{ x: number; y: number }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(url);
    const box = (await page.locator(selector).boundingBox())!;
    return { x: box.x + 5, y: box.y + box.height / 2 };
  } finally {
    await browser.close();
  }
}

run("recording", { timeout: 90_000 }, () => {
  beforeAll(async () => {
    site = await startSite();
  });
  afterAll(async () => {
    await site.close();
  });
  afterEach(async () => {
    for (const h of harnesses.splice(0)) await h.close();
    cleanTempDirs();
  });

  async function setup() {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const dir = tempDir("ww-pack-");
    const key = `rec-${Math.random().toString(36).slice(2, 8)}`;
    writeFiles(dir, {
      "pack.yaml": `name: Record fixture\nsite: { key: ${key}, baseURL: "${site.url}" }\nbrowser: { viewport: { width: ${VIEWPORT.width}, height: ${VIEWPORT.height} } }\n`,
      "tests/form.yaml": "id: R1\ntitle: Send the form\nsteps:\n  - goto: /form\n  - check: { label: I agree }\n",
      "tests/slow.yaml": "id: S1\ntitle: Take a while\nsteps:\n  - goto: /\n  - wait: 2500\n",
      // Record from here at line 6: the goto and the first fill run, the second fill doesn't.
      "tests/code.ts": [
        'import { test } from "watchwright";',
        'test("C1", { title: "Code" }, async ({ page, h }) => {',
        '  await h.goto("/form");',
        "  const email = page.getByLabel(\"Email\");",
        "",
        '  await email.fill("first");',
        '  await email.fill("second");',
        '  await h.click("#send");',
        "});",
      ].join("\n"),
    });
    const added = await h.api<{ id: string }>("POST", "/packs", { path: dir });
    return { h, packId: added.data.id };
  }

  const stepsOf = (e: WwEvent) => e.data.step as RecordEntry;

  it("records clicks and typing as steps, with other targets and the spot clicked, after running the steps above", async () => {
    const { h, packId } = await setup();
    const started = await h.api<{ id: string; status: string }>("POST", "/record", { packId, testId: "R1", replay: 2 });
    expect(started.status).toBe(201);
    const id = started.data.id;
    await h.waitFor((e) => e.runId === id && e.type === "record.status" && e.data.status === "recording", 30_000);
    // The steps above ran: the checkbox is ticked already, and they aren't recorded.
    const replayed = await h.waitFor((e) => e.runId === id && e.type === "record.replay-step", 1000);
    expect(replayed.data.title).toBeTruthy();

    const email = await centerOf(new URL("/form", site.url).href, "#email");
    expect((await h.api("POST", `/record/${id}/input`, { type: "click", ...email })).status).toBe(200);
    await h.api("POST", `/record/${id}/input`, { type: "key", key: "a" });
    await h.api("POST", `/record/${id}/input`, { type: "key", key: "b" });
    const send = await centerOf(new URL("/form", site.url).href, "#send");
    await h.api("POST", `/record/${id}/input`, { type: "click", ...send });
    await h.waitFor((e) => e.runId === id && e.type === "record.step" && stepsOf(e).name === "click" && JSON.stringify(stepsOf(e).args).includes("Send"), 10_000);

    const state = (await h.api<{ steps: RecordEntry[]; pages: unknown[] }>("GET", `/record/${id}`)).data;
    const names = state.steps.map((s) => s.name);
    expect(names).toEqual(["click", "fill", "click"]);
    const [clickEmail, fill, clickSend] = state.steps as [RecordEntry, RecordEntry, RecordEntry];
    expect(fill.args.value).toBe("ab");
    expect(clickEmail.targets[0]).toEqual(clickEmail.args.target);
    expect(clickEmail.targets).toContainEqual({ label: "Email" });
    expect(clickEmail.targets).toContainEqual("#email");
    expect(clickEmail.spot).toEqual({ x: 5, y: expect.any(Number) as number });
    // The fill on the same element shares the click's targets.
    expect(fill.targets).toContainEqual("#email");
    expect(clickSend.args.target).toEqual({ role: "button", name: "Send" });
    expect(clickSend.targets).toContainEqual("#send");

    // Check: the element under a point, with its text.
    const heading = await centerOf(new URL("/form", site.url).href, "h1");
    const picked = await h.api<{ targets: unknown[]; info: { text: string } }>("POST", `/record/${id}/pick`, heading);
    expect(picked.data.targets[0]).toEqual({ role: "heading", name: "Form" });
    expect(picked.data.info.text).toBe("Form");
    // A move answers with the element now under the pointer, for the live view's outline.
    const moved = await h.api<{ hover: { box: { width: number }; tag: string; target: unknown } | null }>("POST", `/record/${id}/input`, { type: "move", ...heading });
    expect(moved.data.hover).toMatchObject({ tag: "h1", target: { role: "heading", name: "Form" } });
    expect(moved.data.hover!.box.width).toBeGreaterThan(0);
    expect((await h.api<{ hover: unknown }>("POST", `/record/${id}/input`, { type: "key", key: "Shift" })).data.hover).toBeNull();
    // A list item: its shared test id narrowed by its text, and the whole list for a count check.
    const green = await centerOf(new URL("/form", site.url).href, "li:nth-child(2)");
    const item = await h.api<{ targets: unknown[]; groups: { target: unknown; count: number }[] }>("POST", `/record/${id}/pick`, green);
    expect(item.data.targets[0]).toEqual({ testId: "color", hasText: "Green" });
    expect(item.data.groups).toContainEqual({ target: { testId: "color" }, count: 3 });

    const added = await h.api<RecordEntry>("POST", `/record/${id}/steps`, { name: "expect", args: { target: { role: "heading", name: "Form" }, text: "Form" } });
    expect(added.status).toBe(201);
    expect((await h.api("POST", `/record/${id}/steps`, { name: "nope" })).error?.code).toBe("bad_step");
    const changed = await h.api<RecordEntry>("POST", `/record/${id}/steps/${clickEmail.id}`, { args: { ...clickEmail.args, target: "#email", position: clickEmail.spot } });
    expect(changed.data.args).toMatchObject({ target: "#email", position: clickEmail.spot });
    expect((await h.api("DELETE", `/record/${id}/steps/${clickSend.id}`)).status).toBe(200);

    const stopped = await h.api<{ status: string; steps: RecordEntry[] }>("POST", `/record/${id}/stop`);
    expect(stopped.data.status).toBe("ended");
    expect(stopped.data.steps.map((s) => s.name)).toEqual(["click", "fill", "expect"]);
    expect((await h.api("POST", `/record/${id}/input`, { type: "key", key: "a" })).error?.code).toBe("not_recording");
  });

  it("runs a code test up to the cursor's line before recording", async () => {
    const { h, packId } = await setup();
    const started = await h.api<{ id: string }>("POST", "/record", { packId, testId: "C1", line: 6 });
    expect(started.status).toBe(201);
    const id = started.data.id;
    const ready = await h.waitFor((e) => e.runId === id && e.type === "record.status" && e.data.status === "recording", 30_000);
    expect(ready.data.message).toBeNull();
    const email = await centerOf(new URL("/form", site.url).href, "#email");
    const picked = await h.api<{ info: { value: string } }>("POST", `/record/${id}/pick`, email);
    expect(picked.data.info.value).toBe("first");
    await h.api("POST", `/record/${id}/stop`);
    // `line` is for code tests, `replay` for YAML ones.
    expect((await h.api("POST", "/record", { packId, testId: "R1", line: 3 })).error?.code).toBe("bad_test");
    expect((await h.api("POST", "/record", { packId, testId: "C1", replay: 1 })).error?.code).toBe("bad_test");
  });

  it("holds the site: a run of it waits for the recording, and a recording waits for a run", async () => {
    const { h, packId } = await setup();
    const rec = (await h.api<{ id: string }>("POST", "/record", { packId })).data.id;
    await h.waitFor((e) => e.runId === rec && e.type === "record.status" && e.data.status === "recording", 30_000);
    const runId = (await h.api<{ id: string }>("POST", "/runs", { packId, tests: ["S1"] })).data.id;
    await new Promise((r) => setTimeout(r, 800));
    expect((await h.api<{ status: string }>("GET", `/runs/${runId}`)).data.status).toBe("queued");
    await h.api("POST", `/record/${rec}/stop`);
    await h.waitFor((e) => e.runId === runId && e.type === "run.started", 10_000);

    const second = (await h.api<{ id: string; status: string; message: string | null }>("POST", "/record", { packId })).data;
    const waiting = await h.waitFor((e) => e.runId === second.id && e.type === "record.status", 5000);
    expect(waiting.data.status).toBe("waiting");
    await engineOf(h).settled(runId);
    await h.waitFor((e) => e.runId === second.id && e.type === "record.status" && e.data.status === "recording", 30_000);
    await h.api("POST", `/record/${second.id}/stop`);
  });

  it("refuses what it can't do", async () => {
    const { h, packId } = await setup();
    expect((await h.api("POST", "/record", { packId: "00000000" })).status).toBe(404);
    expect((await h.api("POST", "/record", { packId, testId: "nope", replay: 1 })).error?.code).toBe("bad_test");
    expect((await h.api("GET", "/record/00000000")).status).toBe(404);
    const list = await h.api<{ canWindow: boolean; recordings: unknown[] }>("GET", "/record");
    expect(typeof list.data.canWindow).toBe("boolean");
  });
});
