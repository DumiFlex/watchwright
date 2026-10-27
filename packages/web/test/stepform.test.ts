import { describe, expect, it } from "vitest";
import { controlOf, expectCheck, fieldText, fieldValue, parseMatch, targetOf, targetParts, withCheck } from "../src/stepform";
import { STEP_BY_NAME } from "../src/yamlsteps";

describe("step forms", () => {
  it("splits a target into a kind and a value, and puts it back with its filters", () => {
    expect(targetParts("#save")).toEqual({ kind: "selector", value: "#save", name: "", exact: false, extra: {} });
    const t = { role: "button", name: { regex: "^Save", flags: "i" }, within: { testId: "form" }, first: true };
    const parts = targetParts(t);
    expect(parts).toMatchObject({ kind: "role", value: "button", name: "/^Save/i", extra: { within: { testId: "form" }, first: true } });
    expect(targetOf(parts)).toEqual(t);
    expect(targetOf({ ...targetParts({ label: "Email" }), kind: "placeholder" })).toEqual({ placeholder: "Email" });
    expect(targetOf({ kind: "text", value: "Done", name: "", exact: true, extra: {} })).toEqual({ text: "Done", exact: true });
  });

  it("reads text, numbers, lists and regexes from boxes", () => {
    expect(parseMatch("/a+/")).toEqual({ regex: "a+" });
    expect(parseMatch("a/b")).toBe("a/b");
    const select = STEP_BY_NAME.get("select")!.fields.option!;
    expect(controlOf(select)).toBe("list");
    expect(fieldValue("red", "list", select)).toBe("red");
    expect(fieldValue("red, blue", "list", select)).toEqual(["red", "blue"]);
    expect(fieldText(["red", "blue"], "list")).toBe("red, blue");
    const timeout = STEP_BY_NAME.get("click")!.fields.timeout!;
    expect(fieldValue("2000", "number", timeout)).toBe(2000);
    expect(fieldValue("${params.ms}", "number", timeout)).toBe("${params.ms}");
    expect(fieldValue("", "number", timeout)).toBeUndefined();
  });

  it("switches an expect step's check, keeping its target", () => {
    expect(expectCheck({ target: "a", text: "x" })).toBe("text");
    expect(withCheck({ target: "a", text: "x", timeout: 5 }, "count")).toEqual({ target: "a", timeout: 5, count: 1 });
    expect(withCheck({ target: "a", text: "x" }, "url")).toEqual({ url: "" });
    expect(withCheck({ target: "a", not: true }, "visible")).toEqual({ target: "a", not: true, visible: true });
  });
});
