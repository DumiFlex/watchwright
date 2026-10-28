import { describe, expect, it } from "vitest";
import { rangeAt, yamlCompletions, yamlHover } from "../src/yamlhints";

/** Completions with the cursor at `|`. */
function at(textWithCursor: string, explicit = false) {
  const pos = textWithCursor.indexOf("|");
  const r = yamlCompletions(textWithCursor.replace("|", ""), pos, explicit);
  return r ? { from: r.from, labels: r.options.map((o) => o.label), applies: r.options.map((o) => o.apply) } : null;
}

describe("YAML hints", () => {
  it("offers steps on a list item, and test keys under tests:", () => {
    const r = at("id: T\nsteps:\n  - cl|");
    expect(r?.labels).toContain("click");
    expect(r?.applies).toContain("reload");
    expect(r?.applies).toContain("click: ");
    expect(r?.from).toBe(17);
    expect(at("tests:\n  - |")?.labels).toContain("id");
    expect(at("id: T\nsteps:\n  - if:\n      then:\n        - |")?.labels).toContain("goto");
  });

  it("offers a step's fields in a flow map and below the step, without the ones set", () => {
    expect(at("steps:\n  - click: { target: a, |")?.labels).toEqual(["done", "button", "position", "timeout", "role", "name", "exact", "checked", "disabled", "expanded", "pressed", "selected", "level", "includeHidden", "label", "placeholder", "text", "alt", "title", "testId", "css", "nth", "first", "last", "hasText", "hasNotText", "has", "within", "frame"]);
    expect(at("steps:\n  - fill: { |")?.labels).toEqual(["target", "value"]);
    expect(at("steps:\n  - click: \"#a\"\n    ti|")?.labels).toEqual(["done", "button", "position", "timeout"]);
    expect(at("steps:\n  - fill:\n      target: a\n      |", true)?.labels).toEqual(["value"]);
  });

  it("offers target keys inside a target, and roles and enum values as values", () => {
    expect(at("steps:\n  - fill: { target: { |")?.labels).toContain("placeholder");
    expect(at("steps:\n  - click: { role: bu|")?.labels).toContain("button");
    expect(at("steps:\n  - clear: |")?.labels).toEqual(["cookies", "storage", "all"]);
    expect(at("steps:\n  - waitFor: { target: a, state: |")?.labels).toEqual(["visible", "hidden", "attached", "detached"]);
    expect(at("steps:\n  - expect: { target: a, visible: |")?.labels).toEqual(["true", "false"]);
  });

  it("offers the file's keys at the top, and nothing in comments", () => {
    expect(at("id: T\nti|")?.labels).toEqual(["title", "section", "description", "tags", "runs", "needs", "inside", "timeout", "review", "steps", "tests"]);
    expect(at("steps:\n  # cl|")).toBeNull();
  });

  it("shows a step's docs on hover", () => {
    const text = "steps:\n  - fill: { target: a, value: b }\n";
    const h = yamlHover(text, text.indexOf("fill") + 2);
    expect(h?.title).toBe("fill");
    expect(h?.fields.map((f) => f.name)).toEqual(["target", "value"]);
    expect(yamlHover(text, text.indexOf("value") + 1)).toBeNull();
  });

  it("finds the word a problem points at", () => {
    const text = "id: T\nsteps:\n  - clik: a\n";
    expect(rangeAt(text, 3, 5)).toEqual({ from: 17, to: 22 });
    expect(rangeAt(text, 9, 1)).toEqual({ from: text.length, to: text.length });
  });
});
