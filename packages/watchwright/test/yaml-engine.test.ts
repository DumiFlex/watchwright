import { cpSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import type { ResultDocument } from "../src/plugins/runs/results.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// YAML tests and pack.yaml in real runs against the fixture site, and the TodoMVC example pack
// against the fixture copy of its app.

const run = hasChromium || requireBrowsers ? describe : describe.skip;
const EXAMPLE = fileURLToPath(new URL("../../../examples/todomvc", import.meta.url));

let site: { url: string; close(): Promise<void> };
const harnesses: Harness[] = [];

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

function packYaml(extra = ""): string {
  return `name: YAML fixture
site: { key: yaml-${Math.random().toString(36).slice(2, 8)}, baseURL: "${site.url}" }
browser: { viewport: { width: 800, height: 600 } }
params: { who: { default: ada } }
flags: { slow: finding, oops: robot }
${extra}`;
}

async function addPack(h: Harness, dir: string) {
  const added = await h.api<{ id: string; error: string | null; problems: string[]; tests: { id: string; file: string; line: number | null }[] }>("POST", "/packs", { path: dir });
  expect(added.status).toBe(201);
  return added.data;
}

async function harness(): Promise<Harness> {
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  return h;
}

async function runToEnd(h: Harness, body: Record<string, unknown>): Promise<RunDetail> {
  const res = await h.api<{ id: string }>("POST", "/runs", body);
  expect(res.error).toBeUndefined();
  const runId = res.data.id;
  await h.waitFor((e) => e.runId === runId && (e.type === "run.finished" || e.type === "run.failed_to_start"), 45_000);
  await engineOf(h).settled(runId);
  return (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
}

const byTest = (d: RunDetail) => Object.fromEntries(d.attempts.map((a) => [`${a.testId}#${a.number}`, a.status]));
const docOf = async (h: Harness, d: RunDetail, testId: string) => (await h.api<ResultDocument>("GET", `/runs/${d.id}/attempts/${d.attempts.find((a) => a.testId === testId)!.id}`)).data;

run("YAML tests", { timeout: 90_000 }, () => {
  it("runs YAML steps through h: actions, checks, keeping, shapes and variables", async () => {
    process.env.WW_TEST_SECRET = "s3cret-value";
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": packYaml(`setup:
  - info: { key: Mode, value: "yaml \${params.who}" }`),
      "photo.txt": "a file to upload",
      "tests/form.yaml": `section: Form
tests:
  - id: Y1
    title: Fill the form
    steps:
      - goto: /form
      - fill: { target: { label: Email }, value: "\${params.who}@example.com" }
      - check: { label: I agree }
      - select: { target: { label: Size }, option: Large }
      - upload: { target: { label: Photo }, files: photo.txt }
      - click:
          target: { role: button, name: Send }
          done: { text: Sent, exact: false }
      - expect: { target: "#out", text: Sent ada@example.com l yes photo.txt }
      - metric: { name: Total, target: "#price", unit: EUR }
      - keepText: { name: out, target: "#out" }
      - save: { key: email, target: { label: Email } }
      - fill: { target: { label: Email }, value: "\${env.WW_TEST_SECRET}" }
      - note: "attempt \${attempt} of \${attempts}"
  - id: Y2
    title: Shapes
    needs: [Y1]
    steps:
      - goto: /
      - step:
          title: Count to three
          steps:
            - repeat:
                until: { text: "Count: 3" }
                steps:
                  - click: "#inc"
      - expect: { target: "#n", text: "3" }
      - if:
          has: { role: heading, name: Fixture home }
          then:
            - note: "has the heading"
          else:
            - flag: oops
      - if:
          equals: ["\${params.who}", ada]
          then:
            - log: who is ada
      - expect: { url: / }
      - expect: { title: Fixture home }
      - expect: { target: { role: link, name: Other page }, visible: true }
      - expect: { target: "#missing", not: true, visible: true }
      - click: { role: link, name: Other page }
      - expect: { url: { regex: "/other$" } }
      - back
      - wait: 10
      - shot: { name: home, fullPage: true }
      - keepText: { name: saved, text: "\${saved.email}" }
`,
    });
    const h = await harness();
    const pack = await addPack(h, dir);
    expect(pack.error).toBeNull();
    expect(pack.tests.map((t) => [t.id, t.file, t.line])).toEqual([
      ["Y1", "tests/form.yaml", 3],
      ["Y2", "tests/form.yaml", 20],
    ]);
    const d = await runToEnd(h, { packId: pack.id, pauseOnBroken: false });
    expect(byTest(d)).toEqual({ "Y1#1": "passed", "Y2#1": "passed" });
    expect(d.info).toMatchObject({ Mode: "yaml ada" });
    const y1 = await docOf(h, d, "Y1");
    expect(y1.metrics.Total).toEqual({ value: 1234.5, unit: "EUR" });
    expect(y1.texts.out).toBe("Sent ada@example.com l yes photo.txt");
    expect(y1.notes).toEqual(["attempt 1 of 1"]);
    // Every step shows in the timeline with its plain summary.
    expect(y1.steps.map((s) => s.title)).toContain('Fill label "Email" with "${params.who}@example.com"');
    expect(JSON.stringify(y1)).not.toContain("s3cret-value");
    const y2 = await docOf(h, d, "Y2");
    expect(y2.texts.saved).toBe("ada@example.com");
    expect(y2.notes).toEqual(["has the heading"]);
    expect(y2.log.map((l) => l.message)).toContain("who is ada");
    expect(y2.steps.filter((s) => s.depth === 1).map((s) => s.title)).toContain("Repeat until text \"Count: 3\" shows");
    expect(y2.artifacts.some((a) => a.kind === "shot")).toBe(true);
  });

  it("fails on a check, breaks on a missing element, and points at the YAML line", async () => {
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": packYaml(),
      "tests/bad.yaml": `tests:
  - id: B1
    steps:
      - goto: /
      - expect: { target: h1, text: Nope, timeout: 300 }
  - id: B2
    steps:
      - goto: /
      - click: { target: "#nothing-here", timeout: 300 }
  - id: B3
    steps:
      - skip: not today
  - id: B4
    steps:
      - fill: { target: h1, value: "\${env.WW_NOT_SET_ANYWHERE}" }
`,
    });
    const h = await harness();
    const pack = await addPack(h, dir);
    const d = await runToEnd(h, { packId: pack.id, pauseOnBroken: false });
    expect(byTest(d)).toEqual({ "B1#1": "failed", "B2#1": "broken", "B3#1": "skipped", "B4#1": "broken" });
    const b1 = await docOf(h, d, "B1");
    expect(b1.error?.kind).toBe("assertion");
    expect(b1.error?.stack).toContain(`\n    at expect (${path.join(dir, "tests", "bad.yaml")}:5:9)\n`);
    const b2 = await docOf(h, d, "B2");
    expect(b2.error?.kind).toBe("step");
    expect(b2.error?.message).toMatch(/Couldn't click/);
    expect(b2.error?.stack).toContain(`bad.yaml:9:9`);
    expect((await docOf(h, d, "B4")).error?.message).toMatch(/WW_NOT_SET_ANYWHERE isn't set/);
  });

  it("runs children, calls a code pack's helpers, and picks up a fixed YAML file while paused", async () => {
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.ts": `import { pack } from "watchwright";
export default pack({
  name: "Mixed",
  site: { key: "mixed-${Math.random().toString(36).slice(2, 8)}", baseURL: ${JSON.stringify(site.url)} },
  helpers: (h) => ({ async bump(times: number) { for (let i = 0; i < times; i++) await h.click("#inc"); } }),
});`,
      "tests/a.ts": `import { test } from "watchwright"; test("C0", async ({ h }) => { h.note("code first"); });`,
      "tests/b.yaml": `tests:
  - id: P1
    steps:
      - goto: /
      - use: { helper: bump, args: [2] }
      - expect: { target: "#n", text: "2" }
      - child: K1
  - id: K1
    inside: P1
    steps:
      - expect: { target: "#n", text: "2" }
      - note: in the parent's page
  - id: X1
    steps:
      - goto: /
      - click: { target: "#gone", timeout: 200 }
      - click: "#inc"
`,
    });
    const h = await harness();
    const pack = await addPack(h, dir);
    expect(pack.tests.map((t) => t.id)).toEqual(["C0", "P1", "K1", "X1"]);
    const d = await runToEnd(h, { packId: pack.id, tests: ["C0", "P1"] });
    expect(byTest(d)).toEqual({ "C0#1": "passed", "P1#1": "passed", "K1#1": "passed" });
    expect((await docOf(h, d, "K1")).notes).toEqual(["in the parent's page"]);

    // A broken YAML step pauses the run; saving the fixed file retries it.
    const res = await h.api<{ id: string }>("POST", "/runs", { packId: pack.id, tests: ["X1"], pauseOnBroken: true });
    const runId = res.data.id;
    const paused = await h.waitFor((e) => e.type === "run.paused" && e.runId === runId);
    expect(paused.data.reason).toBe("broken");
    const file = path.join(dir, "tests", "b.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(`      - click: { target: "#gone", timeout: 200 }\n`, ""));
    const later = new Date(Date.now() + 2000);
    utimesSync(file, later, later);
    await h.waitFor((e) => e.runId === runId && e.type === "run.finished", 45_000);
    await engineOf(h).settled(runId);
    const d2 = (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
    expect(byTest(d2)).toEqual({ "X1#1": "passed" });
  });

  it("refuses a pack whose YAML has problems, naming file, line and column", async () => {
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": packYaml(),
      "tests/typo.yaml": `id: T1\nsteps:\n  - goto: /\n  - fil: { target: h1, value: x }\n  - click: { role: button, label: Save }\n`,
    });
    const h = await harness();
    const pack = await addPack(h, dir);
    expect(pack.error).toMatch(/YAML tests aren't valid/);
    expect(pack.problems).toEqual([
      `tests/typo.yaml:4:5 "fil" isn't a step. Did you mean "fill"?`,
      "tests/typo.yaml:5:12 click.target: A target has one of role, label, placeholder, text, alt, title, testId, css, not role and label.",
    ]);
  });

  it("turns a YAML test file into code that runs the same", async () => {
    const dir = tempDir("ww-pack-");
    cpSync(EXAMPLE, dir, { recursive: true });
    writeFileSync(path.join(dir, "pack.yaml"), readFileSync(path.join(dir, "pack.yaml"), "utf8").replace("https://demo.playwright.dev/", site.url));
    const h = await harness();
    const pack = await addPack(h, dir);
    const res = await h.api<{ file: string }>("POST", `/packs/${pack.id}/convert`, { file: "tests/editing.yaml" });
    expect(res.error).toBeUndefined();
    expect(res.data.file).toBe("tests/editing.ts");
    const code = readFileSync(path.join(dir, "tests", "editing.ts"), "utf8");
    expect(code).toContain(`await h.fill(page.getByPlaceholder("What needs to be done?"), "Water the plants");`);
    expect(code).toContain(`await page.getByRole("checkbox", { name: "Toggle Todo" }).check();`);
    const d = await runToEnd(h, { packId: pack.id, tests: ["E1", "E2", "E3", "E4"] });
    expect(byTest(d)).toEqual({ "E1#1": "passed", "E2#1": "passed", "E3#1": "passed", "E4#1": "passed" });
  });
});

run("the TodoMVC example pack", { timeout: 120_000 }, () => {
  it("passes against the fixture copy of the app", async () => {
    const dir = tempDir("ww-pack-");
    cpSync(EXAMPLE, dir, { recursive: true });
    writeFileSync(path.join(dir, "pack.yaml"), readFileSync(path.join(dir, "pack.yaml"), "utf8").replace("https://demo.playwright.dev/", site.url));
    const h = await harness();
    const pack = await addPack(h, dir);
    expect(pack.error).toBeNull();
    expect(pack.tests.map((t) => t.id)).toEqual(["A1", "A2", "A3", "A4", "E1", "E2", "E3", "E4", "F1", "F2", "F3"]);
    const d = await runToEnd(h, { packId: pack.id, pauseOnBroken: false });
    const statuses = byTest(d);
    expect(Object.entries(statuses).filter(([, s]) => s !== "passed")).toEqual([]);
    expect(Object.keys(statuses)).toHaveLength(11);
    expect((await docOf(h, d, "A2")).metrics["Items left"]).toEqual({ value: 3, unit: null });
  });
});
