import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkDocument, parseTestFile } from "../src/plugins/packs/yaml/parse.js";
import { PACK_SHAPE } from "../src/plugins/packs/yaml/pack-shape.js";
import { firstNumber } from "../src/plugins/packs/yaml/run.js";
import { packSchema, testFileSchema } from "../src/plugins/packs/yaml/schema.js";
import { STEPS, summarize } from "../src/plugins/packs/yaml/steps.js";
import { describeTarget } from "../src/plugins/packs/yaml/targets.js";
import { lit, locatorCode, testsToCode } from "../src/plugins/packs/yaml/to-code.js";
import { stepsReference } from "../src/plugins/packs/yaml/reference.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness } from "./helpers/harness.js";

const EXAMPLE = fileURLToPath(new URL("../../../examples/todomvc", import.meta.url));

const problemsOf = (text: string) => parseTestFile(text).problems.map((p) => `${p.line}:${p.col} ${p.message}`);

describe("YAML test files", () => {
  it("reads one test, short and long step forms, flat fields and comments", () => {
    const { value, problems } = parseTestFile(`id: T1
title: Add
runs: { by: lang, de: 2, default: 1 }
steps:
  - goto: /
  # Type the todo.
  - fill: { target: { placeholder: What? }, value: 42 }
  - click: "#save"
    timeout: 300
  - click: { role: button, name: Save }
  - click: { target: "#x", done: { text: Saved } }
  - reload
  - press: Enter
`);
    expect(problems).toEqual([]);
    const t = value[0]!;
    expect(t.id).toBe("T1");
    expect(t.meta).toEqual({ title: "Add", runs: { by: "lang", de: 2, default: 1 } });
    expect(t.steps.map((s) => [s.name, s.args, s.line])).toEqual([
      ["goto", { url: "/" }, 5],
      ["fill", { target: { placeholder: "What?" }, value: 42 }, 7],
      ["click", { target: "#save", timeout: 300 }, 8],
      ["click", { target: { role: "button", name: "Save" } }, 10],
      ["click", { target: "#x", done: { text: "Saved" } }, 11],
      ["reload", {}, 12],
      ["press", { key: "Enter" }, 13],
    ]);
    expect(t.steps[1]!.comment).toBe("Type the todo.");
  });

  it("reads several tests with shared section and tags", () => {
    const { value, problems } = parseTestFile(`section: S
tags: [smoke]
tests:
  - id: A
    steps: [reload]
  - id: B
    section: Other
    steps: [back]
`);
    expect(problems).toEqual([]);
    expect(value.map((t) => [t.id, t.meta.section, t.meta.tags])).toEqual([
      ["A", "S", ["smoke"]],
      ["B", "Other", ["smoke"]],
    ]);
  });

  it("names every problem with its line, column and a likely fix", () => {
    expect(
      problemsOf(`id: T1
titel: x
steps:
  - fil: x
  - goto
  - click: { target: a, timout: 3 }
  - expect: { target: a, visible: true, text: b }
  - expect: { text: b }
  - expect: { url: /, target: a }
  - expect: { target: a, visible: false }
  - click: { role: button, label: x }
  - wait: soon
  - goto: /
    reload: true
  - waitFor: { target: a, state: gone }
  - if: { then: [reload] }
  - expect: { target: a, text: { regex: "(" } }
  - 42
`),
    ).toEqual([
      `2:1 test has no "titel". Did you mean "title"?`,
      `4:5 "fil" isn't a step. Did you mean "fill"?`,
      `5:5 goto needs a value: "- goto: …".`,
      `6:25 click has no "timout". Did you mean "timeout"?`,
      `7:5 expect checks one thing at a time, not visible and text. Use one expect step for each.`,
      `8:5 text needs a target.`,
      `9:5 url checks the page, so it takes no target.`,
      `10:5 Write \`not: true\` instead of \`visible: false\`.`,
      `11:12 click.target: A target has one of role, label, placeholder, text, alt, title, testId, css, not role and label.`,
      `12:11 wait.ms should be a whole number.`,
      `14:5 One step per list item: put "reload" in its own "- " item.`,
      `15:34 waitFor.state is one of visible, hidden, attached, detached.`,
      `16:5 if needs one condition: has, hasNot or equals.`,
      `17:32 expect.text: the regex doesn't parse (Invalid regular expression: /(/: Unterminated group).`,
      `18:5 A step is a name with its value, such as \`- click: { role: button, name: Save }\`.`,
    ]);
  });

  it("accepts variables where numbers and yes/no go, and reports YAML syntax errors", () => {
    expect(problemsOf(`id: T\nsteps:\n  - wait: "\${params.ms}"\n  - expect: { target: a, count: "\${saved.n}" }\n`)).toEqual([]);
    expect(problemsOf(`id: T\nsteps:\n  - goto: [\n`)[0]).toMatch(/^4:1 /);
    expect(problemsOf(`- just a list`)).toEqual(["1:1 A test file is a map: `id`, `title`, `steps`, … (or `tests:` with a list of them)."]);
    expect(problemsOf(`tests:\n  - id: A\n    steps: [reload]\n  - id: A\n    steps: [reload]\n`)).toEqual([`4:5 Two tests have the id "A".`]);
  });

  it("checks pack.yaml", () => {
    const { problems } = checkDocument(`name: P\nsite: { key: "bad key!" }\nbrowser: { name: safari }\ncollectors: [consoleErrors, { responses: { match: /api/ } }, logs]\n`, PACK_SHAPE, "pack");
    expect(problems.map((p) => `${p.line}:${p.col} ${p.message}`)).toEqual([
      `2:14 pack.site.key "bad key!" isn't valid here.`,
      `3:18 pack.browser.name is one of chromium, firefox, webkit.`,
      `4:62 pack.collectors[2] is one of consoleErrors, failedRequests, responses.`,
    ]);
  });
});

describe("steps", () => {
  it("summarize in plain words", () => {
    expect(summarize({ name: "fill", args: { target: { label: "Email" }, value: "a@b.c" } })).toBe('Fill label "Email" with "a@b.c"');
    expect(summarize({ name: "expect", args: { target: { testId: "count" }, text: "1 item left" } })).toBe('Check test id "count" reads "1 item left"');
    expect(summarize({ name: "expect", args: { target: "h1", not: true, visible: true } })).toBe("Check h1 is not visible");
    expect(summarize({ name: "expect", args: { url: { regex: "/x$" } } })).toBe("Check the URL is //x$/");
    expect(describeTarget({ role: "checkbox", name: "Toggle", within: { testId: "todo-item" }, first: true })).toBe('checkbox "Toggle" (first) in test id "todo-item"');
  });

  it("each has a doc line and fields with docs", () => {
    for (const s of STEPS) {
      expect(s.doc.length, s.name).toBeGreaterThan(10);
      if (s.short) expect(s.fields[s.short], s.name).toBeDefined();
    }
  });
});

describe("JSON Schemas", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });

  it("compile, and accept the example pack's files", () => {
    const testSchema = ajv.compile(testFileSchema());
    const pack = ajv.compile(packSchema());
    expect(pack(parse(readFileSync(path.join(EXAMPLE, "pack.yaml"), "utf8"))), JSON.stringify(pack.errors)).toBe(true);
    for (const f of readdirSync(path.join(EXAMPLE, "tests"))) {
      const ok = testSchema(parse(readFileSync(path.join(EXAMPLE, "tests", f), "utf8")));
      expect(ok, `${f}: ${JSON.stringify(testSchema.errors?.slice(0, 3))}`).toBe(true);
    }
  });

  it("reject a step that doesn't exist", () => {
    const testSchema = ajv.compile(testFileSchema());
    expect(testSchema({ id: "T", steps: [{ fil: "x" }] })).toBe(false);
    expect(testSchema({ id: "T", steps: ["reload", { click: "#a", timeout: 3 }] })).toBe(true);
  });
});

describe("to code", () => {
  it("writes literals with variables as template literals", () => {
    expect(lit("plain")).toBe('"plain"');
    expect(lit("${params.lang}")).toBe("params.lang");
    expect(lit("Hi ${params.who}, ${saved.n} and `x`")).toBe('`Hi ${params.who}, ${h.load("n")} and \\`x\\``');
    expect(lit("${env.PASSWORD}")).toBe("process.env.PASSWORD");
    expect(lit({ a: 1, "b-c": [true] })).toBe('{ a: 1, "b-c": [true] }');
  });

  it("writes locators", () => {
    expect(locatorCode({ role: "button", name: "Save", exact: true })).toBe('page.getByRole("button", { name: "Save", exact: true })');
    expect(locatorCode({ text: { regex: "^Done$", flags: "i" }, within: { testId: "list" }, nth: 1 })).toBe('page.getByTestId("list").getByText(/^Done$/i).nth(1)');
    expect(locatorCode({ css: "li", hasText: "milk", frame: "#app" })).toBe('page.locator("#app").contentFrame().locator("li").filter({ hasText: "milk" })');
  });

  it("writes a test file with only the imports it needs", () => {
    const { value } = parseTestFile(`id: T1
title: Add
steps:
  # Start here.
  - goto: /
  - metric: { name: n, target: "#n" }
  - if:
      has: "#banner"
      then: [{ click: "#close" }]
      else: [{ note: no banner }]
`);
    expect(testsToCode(value)).toBe(`import { firstNumber, test } from "watchwright";

test("T1", { title: "Add" }, async ({ page, h }) => {
  // Start here.
  await h.goto("/");
  h.metric("n", firstNumber(await page.locator("#n").evaluate((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : (el as HTMLElement).innerText))));
  if (await h.has(page.locator("#banner"))) {
    await h.click(page.locator("#close"));
  } else {
    h.note("no banner");
  }
});
`);
  });
});

describe("firstNumber", () => {
  it("reads numbers the way people write them", () => {
    expect(firstNumber("Total: 1,234.50 EUR")).toBe(1234.5);
    expect(firstNumber("1.234,5 €")).toBe(1234.5);
    expect(firstNumber("3 items left")).toBe(3);
    expect(firstNumber("took 12,5 s")).toBe(12.5);
    expect(firstNumber("-4 degrees")).toBe(-4);
    expect(firstNumber("10 000 rows")).toBe(10000);
    expect(() => firstNumber("none")).toThrow(/No number/);
  });
});

describe("the docs site", () => {
  it("has the YAML steps page as the step list writes it (pnpm --filter watchwright steps-reference)", () => {
    const page = readFileSync(fileURLToPath(new URL("../../site/reference/yaml-steps.md", import.meta.url)), "utf8");
    expect(page).toBe(stepsReference());
  });
});

describe("the yaml-schema action", () => {
  it("serves both schemas", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    try {
      const test = await h.api<{ title: string }>("GET", "/packs/yaml-schema");
      expect(test.data.title).toBe("Watchwright YAML test file");
      const pack = await h.api<{ title: string }>("GET", "/packs/yaml-schema?kind=pack");
      expect(pack.data.title).toBe("Watchwright pack.yaml");
      expect((await h.api("GET", "/packs/yaml-schema?kind=nope")).status).toBe(400);
    } finally {
      await h.close();
      cleanTempDirs();
    }
  });
});
