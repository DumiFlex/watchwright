import { describe, expect, it } from "vitest";
import { keyOf, pagePoint } from "../src/liveinput";
import { insertCodeSteps, insertYamlSteps, targetLabel, yamlSpot } from "../src/recording";

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
