import { describe, expect, it } from "vitest";
import { duplicateStep, insertStep, moveStep, readTests, removeStep, replaceStep, stepAtLine, updateStep } from "../src/stepsdoc";

const FILE = `# The first test.
id: T1
title: Add a todo
steps:
  # Start clean.
  - goto: /todomvc/   # the demo
  - fill: { target: { placeholder: What needs to be done? }, value: Buy milk }
  - press: Enter
  - click: "#save"
    timeout: 300
  - reload
  - if:
      has: { role: dialog }
      then:
        - click: { role: button, name: Close }   # the banner
  - expect: { target: { testId: todo-title }, text: Buy milk }
`;

describe("the Steps view's model", () => {
  it("reads steps with their fields, lines and comments, and steps inside steps", () => {
    const [t] = readTests(FILE)!;
    expect(t!.id).toBe("T1");
    expect(t!.steps.steps.map((s) => [s.name, s.line, s.endLine, s.summary])).toEqual([
      ["goto", 6, 6, "Go to /todomvc/"],
      ["fill", 7, 7, 'Fill placeholder "What needs to be done?" with "Buy milk"'],
      ["press", 8, 8, "Press Enter"],
      ["click", 9, 10, "Click #save"],
      ["reload", 11, 11, "Reload the page"],
      ["if", 12, 15, "If dialog shows"],
      ["expect", 16, 16, 'Check test id "todo-title" reads "Buy milk"'],
    ]);
    expect(t!.steps.steps[0]!.comment).toBe("Start clean.");
    expect(t!.steps.steps[3]!.args).toEqual({ target: "#save", timeout: 300 });
    const inner = t!.steps.steps[5]!.lists;
    expect(inner.map((l) => [l.field, l.path, l.steps.map((s) => s.summary)])).toEqual([
      ["then", ["steps", 5, "if", "then"], ['Click button "Close"']],
      ["else", ["steps", 5, "if", "else"], []],
    ]);
    expect(stepAtLine([t!], 15)?.summary).toBe('Click button "Close"');
    expect(stepAtLine([t!], 10)?.name).toBe("click");
    expect(readTests("steps: [\n")).toBeNull();
  });

  it("edits one field and keeps everything else as written", () => {
    const out = updateStep(FILE, ["steps", 1], { target: { placeholder: "What needs to be done?" }, value: "Buy bread" });
    expect(out).toBe(FILE.replace("value: Buy milk }", "value: Buy bread }"));
    // A short value stays short; its comment stays.
    expect(updateStep(FILE, ["steps", 0], { url: "/other/" })).toBe(FILE.replace("goto: /todomvc/   #", "goto: /other/ #"));
    // Flat fields change where they are.
    expect(updateStep(FILE, ["steps", 3], { target: "#save", timeout: 500 })).toBe(FILE.replace("timeout: 300", "timeout: 500"));
    expect(updateStep(FILE, ["steps", 3], { target: "#save" })).toBe(FILE.replace("\n    timeout: 300", ""));
  });

  it("writes a short step with fields when it needs them, and back", () => {
    const more = updateStep(FILE, ["steps", 2], { key: "Enter", target: "#new" });
    expect(more).toContain("  - press: { key: Enter, target: \"#new\" }\n");
    expect(updateStep(FILE, ["steps", 4], {})).toBe(FILE);
    const nested = updateStep(FILE, ["steps", 5, "if", "then", 0], { target: { role: "button", name: "Dismiss" } });
    expect(nested).toContain("        - click: { role: button, name: Dismiss } # the banner\n");
    // The if's own field changes, its steps stay.
    const has = updateStep(FILE, ["steps", 5], { has: { role: "alertdialog" }, then: [] });
    expect(has).toContain("      has: { role: alertdialog }\n      then:\n        - click: { role: button, name: Close }");
  });

  it("adds, removes, duplicates, moves and swaps steps", () => {
    const added = insertStep(FILE, ["steps"], 1, "wait", { ms: 500 });
    expect(readTests(added)![0]!.steps.steps.map((s) => s.name).slice(0, 3)).toEqual(["goto", "wait", "fill"]);
    expect(added).toContain("  - goto: /todomvc/   # the demo\n  - wait: 500\n");
    expect(insertStep(FILE, ["steps", 5, "if", "else"], 0, "reload")).toContain("      else:\n        - reload\n");
    expect(insertStep(FILE, ["steps"], 99, "fill")).toContain('  - fill: { target: "", value: "" }\n');

    const removed = removeStep(FILE, ["steps", 2]);
    expect(removed).not.toContain("press: Enter");
    expect(removed).toContain("# Start clean.");

    const dup = duplicateStep(FILE, ["steps", 0]);
    expect(dup.match(/goto: \/todomvc\//g)).toHaveLength(2);
    expect(dup.match(/# Start clean\./g)).toHaveLength(1);

    const moved = moveStep(FILE, ["steps"], 6, 0);
    expect(readTests(moved)![0]!.steps.steps.map((s) => s.name)).toEqual(["expect", "goto", "fill", "press", "click", "reload", "if"]);
    expect(moved).toContain("# The first test.");

    const swapped = replaceStep(FILE, ["steps", 3], "dblclick");
    expect(swapped).toContain("  - dblclick: { target: \"#save\", timeout: 300 }\n");
  });

  it("reads files with several tests", () => {
    const tests = readTests("section: S\ntests:\n  - id: A\n    steps: [reload]\n  - id: B\n    steps:\n      - back\n")!;
    expect(tests.map((t) => [t.id, t.path, t.line, t.steps.path, t.steps.steps.map((s) => s.name)])).toEqual([
      ["A", ["tests", 0], 3, ["tests", 0, "steps"], ["reload"]],
      ["B", ["tests", 1], 5, ["tests", 1, "steps"], ["back"]],
    ]);
  });
});
