import { describe, expect, it } from "vitest";
import { keyOf, pagePoint, screenRect } from "../src/liveinput";
import { recordingTestTemplate } from "../src/editfiles";
import { codeTestAt, insertCodeSteps, insertYamlSteps, targetLabel, yamlSpot } from "../src/recording";

const FILE = `section: Adding
tests:
  - id: A1
    title: Add a todo
    steps:
      - goto: /todomvc/
      - press: Enter
      # keep me
      - shot: one

  - id: A2
    title: Second
    steps:
      - goto: /
`;

describe("where recorded steps go", () => {
  it("finds the test and the place after the step the cursor is on", () => {
    expect(yamlSpot(FILE, 7)).toEqual({ testId: "A1", listPath: ["tests", 0, "steps"], index: 2 });
    expect(yamlSpot(FILE, 4)).toEqual({ testId: "A1", listPath: ["tests", 0, "steps"], index: 0 });
    expect(yamlSpot(FILE, 14)).toEqual({ testId: "A2", listPath: ["tests", 1, "steps"], index: 1 });
    expect(yamlSpot("id: T1\nsteps: []\n", 1)).toEqual({ testId: "T1", listPath: ["steps"], index: 0 });
    expect(yamlSpot("{ not yaml", 1)).toBeNull();
  });

  it("puts the steps in, in order, and leaves the rest of the file as it was", () => {
    const out = insertYamlSteps(FILE, { listPath: ["tests", 0, "steps"], index: 2 }, [
      { name: "click", args: { target: { role: "button", name: "Save" }, position: { x: 3, y: 4 } } },
      { name: "fill", args: { target: "#q", value: "milk" } },
    ]);
    expect(out).toBe(`section: Adding
tests:
  - id: A1
    title: Add a todo
    steps:
      - goto: /todomvc/
      - press: Enter
      - click: { target: { role: button, name: Save }, position: { x: 3, y: 4 } }
      - fill: { target: "#q", value: milk }
      # keep me
      - shot: one

  - id: A2
    title: Second
    steps:
      - goto: /
`);
  });

  it("writes them as code after the cursor's line, indented like it", () => {
    const code = `test("T1", async ({ page, h }) => {\n  await h.goto("/");\n});\n`;
    expect(insertCodeSteps(code, 2, [{ name: "click", args: { target: { role: "button", name: "Save" } } }])).toBe(
      `test("T1", async ({ page, h }) => {\n  await h.goto("/");\n  await h.click(page.getByRole("button", { name: "Save" }));\n});\n`,
    );
    expect(insertCodeSteps(code, 1, [{ name: "press", args: { key: "Enter" } }])).toBe(`test("T1", async ({ page, h }) => {\n  await h.press("Enter");\n  await h.goto("/");\n});\n`);
  });

  it("names targets for the menu", () => {
    expect(targetLabel("#q")).toBe("CSS #q");
    expect(targetLabel({ testId: "x", hasText: "milk" })).toBe('test id "x" with "milk"');
  });
});

describe("live view input", () => {
  const box = { left: 100, top: 50, width: 800, height: 600 };
  it("maps a point on the picture to the page, outside the bars only", () => {
    // A 1280x800 frame in an 800x600 box: scale 0.625, 500 tall, bars of 50 above and below.
    expect(pagePoint(box, { width: 1280, height: 800 }, { width: 1280, height: 800 }, 100, 100)).toEqual({ x: 0, y: 0 });
    expect(pagePoint(box, { width: 1280, height: 800 }, { width: 1280, height: 800 }, 500, 350)).toEqual({ x: 640, y: 400 });
    expect(pagePoint(box, { width: 1280, height: 800 }, { width: 1280, height: 800 }, 500, 60)).toBeNull();
    // A smaller screencast of a bigger page.
    expect(pagePoint(box, { width: 640, height: 400 }, { width: 1280, height: 800 }, 500, 350)).toEqual({ x: 640, y: 400 });
  });

  it("places a page box on the picture, cut to the page", () => {
    const size = { width: 800, height: 600 };
    // Scale 0.625 with 50 px bars above and below (as above), from a half-size screencast.
    expect(screenRect(size, { width: 640, height: 400 }, { width: 1280, height: 800 }, { x: 640, y: 400, width: 160, height: 80 })).toEqual({ left: 400, top: 300, width: 100, height: 50 });
    expect(screenRect(size, { width: 1280, height: 800 }, { width: 1280, height: 800 }, { x: -100, y: 0, width: 200, height: 800 })).toEqual({ left: 0, top: 50, width: 62.5, height: 500 });
    expect(screenRect(size, { width: 1280, height: 800 }, { width: 1280, height: 800 }, { x: 0, y: 900, width: 10, height: 10 })).toBeNull();
  });

  it("names keys the way Playwright does", () => {
    const k = (key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => keyOf({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
    expect(k("a")).toBe("a");
    expect(k("A", { shiftKey: true })).toBe("A");
    expect(k(" ")).toBe("Space");
    expect(k("Enter")).toBe("Enter");
    expect(k("Tab", { shiftKey: true })).toBe("Shift+Tab");
    expect(k("a", { ctrlKey: true })).toBe("Control+a");
    expect(k("A", { ctrlKey: true, shiftKey: true })).toBe("Control+Shift+a");
    expect(k("Shift", { shiftKey: true })).toBeNull();
  });
});

describe("code tests and new recordings", () => {
  it("finds the code test the cursor is in", () => {
    const text = ['import { test } from "watchwright";', "", 'test("A1", async () => {', "  await one();", "});", "test('A2', { title: \"x\" }, async () => {", "  await two();", "});"].join("\n");
    expect(codeTestAt(text, 4, ["A1", "A2"])).toBe("A1");
    expect(codeTestAt(text, 7, ["A1", "A2"])).toBe("A2");
    expect(codeTestAt(text, 1, ["A1", "A2"])).toBe("A1");
    expect(codeTestAt(text, 7, ["A1"])).toBe("A1");
    expect(codeTestAt("nothing here", 1, ["A1"])).toBeNull();
  });

  it("starts a new recording's test with no steps, and Record fills them in", () => {
    const t = recordingTestTemplate("T3", "Check out");
    const spot = yamlSpot(t.text, t.line);
    expect(spot).toEqual({ testId: "T3", listPath: ["steps"], index: 0 });
    // The empty list turns into a block list as the steps go in.
    expect(insertYamlSteps(t.text, spot!, [{ name: "click", args: { target: { role: "button", name: "Go" } } }, { name: "press", args: { key: "Enter" } }])).toBe(
      "id: T3\ntitle: Check out\nsteps:\n  - click: { role: button, name: Go }\n  - press: Enter\n",
    );
  });
});
