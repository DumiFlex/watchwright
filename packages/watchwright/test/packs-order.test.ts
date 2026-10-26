import { describe, expect, it } from "vitest";
import type { TestDefinition, TestMeta } from "../src/plugins/packs/api.js";
import { glob, globToRegExp } from "../src/plugins/packs/glob.js";
import { attemptsFor, checkTests, planTests, resolveParams } from "../src/plugins/packs/order.js";
import { tempDir, writeFiles } from "./helpers/fixtures.js";

const t = (id: string, meta: TestMeta = {}): TestDefinition => ({ id, meta, body: async () => undefined, file: "tests/x.ts" });

describe("test order", () => {
  const pack = [t("A"), t("B", { needs: ["A"] }), t("W3"), t("W4", { inside: "W3", needs: ["C"] }), t("C"), t("D")];

  it("runs everything in declaration order when nothing is chosen", () => {
    // W3's child W4 needs C, so C moves up in front of W3.
    expect(planTests(pack, undefined)).toEqual({ order: ["A", "B", "C", "W3", "D"], children: new Map([["W3", ["W4"]]]) });
  });

  it("pulls in needs, parents and children", () => {
    expect(planTests(pack, ["B"]).order).toEqual(["A", "B"]);
    expect(planTests(pack, ["W4"]).order).toEqual(["C", "W3"]);
    expect(planTests(pack, ["W3"]).children.get("W3")).toEqual(["W4"]);
  });

  it("refuses an unknown test", () => {
    expect(() => planTests(pack, ["nope"])).toThrow(/no test "nope"/);
  });

  it("finds unknown ids, nested children and cycles", () => {
    expect(checkTests([t("A", { needs: ["Z"] }), t("B", { inside: "Y" })])).toEqual([
      'Test A needs "Z", which doesn\'t exist.',
      'Test B is inside "Y", which doesn\'t exist.',
    ]);
    expect(checkTests([t("P"), t("C", { inside: "P" }), t("G", { inside: "C" })])[0]).toMatch(/Only one level/);
    expect(checkTests([t("A", { needs: ["B"] }), t("B", { needs: ["A"] })])[0]).toMatch(/A → B → A/);
  });

  it("counts attempts from a number, a function or a table", () => {
    expect(attemptsFor(undefined, {})).toBe(1);
    expect(attemptsFor(3, {})).toBe(3);
    expect(attemptsFor((p) => (p.fast ? 1 : 2), { fast: false })).toBe(2);
    const runs = { by: "model", q9: 3, haiku: 1, default: 2 };
    expect(attemptsFor(runs, { model: "q9" })).toBe(3);
    expect(attemptsFor(runs, { model: "other" })).toBe(2);
    expect(() => attemptsFor(-1, {})).toThrow(/whole number/);
  });

  it("fills parameter defaults and checks values", () => {
    const defs = { lang: { choices: ["en", "de"], default: "en" }, n: { default: 2 }, on: { type: "boolean" as const, default: false } };
    expect(resolveParams(defs)).toEqual({ lang: "en", n: 2, on: false });
    expect(resolveParams(defs, { lang: "de", n: "5", on: "true" })).toEqual({ lang: "de", n: 5, on: true });
    expect(() => resolveParams(defs, { lang: "fr" })).toThrow(/one of: en, de/);
    expect(() => resolveParams(defs, { x: 1 })).toThrow(/no parameter "x"/);
    expect(() => resolveParams({ need: {} })).toThrow(/needs a value/);
    expect(() => resolveParams(defs, { n: "lots" })).toThrow(/must be a number/);
  });
});

describe("glob", () => {
  it("matches *, **, ? and braces", () => {
    const re = globToRegExp("tests/**/*.{ts,js}");
    expect(re.test("tests/a.ts")).toBe(true);
    expect(re.test("tests/deep/er/b.js")).toBe(true);
    expect(re.test("tests/a.tsx")).toBe(false);
    expect(globToRegExp("t?st.ts").test("test.ts")).toBe(true);
  });

  it("walks a folder, skipping node_modules and dot folders", () => {
    const dir = tempDir();
    writeFiles(dir, { "tests/a.ts": "", "tests/sub/b.ts": "", "tests/node_modules/x.ts": "", "tests/.hidden/y.ts": "", "other.ts": "" });
    expect(glob(dir, ["./tests/**/*.ts"])).toEqual(["tests/a.ts", "tests/sub/b.ts"]);
  });
});
