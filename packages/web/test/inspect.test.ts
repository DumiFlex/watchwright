import { describe, expect, it } from "vitest";
import { changedPart, diffLines, hunks } from "../src/diff";
import { highlight } from "../src/highlight";
import { checkState, leaves, pathsTo, toggleNode, treeKey, visibleRows, type TreeNode } from "../src/tree";

const kinds = (line: { kind: string; text: string }[]) => line.filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text.trim()}`);

describe("highlight", () => {
  it("colors TypeScript", () => {
    const [l1, l2] = highlight('const n = 42; // the answer\nawait page.goto("https://x.test/");', "ts");
    expect(kinds(l1!)).toEqual(["keyword:const", "plain:n =", "number:42", "plain:;", "comment:// the answer"]);
    expect(kinds(l2!)).toEqual(["keyword:await", "plain:page.", "fn:goto", "plain:(", 'string:"https://x.test/"', "plain:);"]);
  });
  it("keeps multi-line comments and template strings on their lines", () => {
    const lines = highlight("/* one\ntwo */ x = `a\nb`", "js");
    expect(lines).toHaveLength(3);
    expect(kinds(lines[1]!)).toEqual(["comment:two */", "plain:x =", "string:`a"]);
    expect(kinds(lines[2]!)).toEqual(["string:b`"]);
  });
  it("colors JSON keys apart from string values", () => {
    expect(kinds(highlight('{"ok": true, "n": -1.5, "s": "x"}', "json")[0]!)).toEqual(["plain:{", 'key:"ok"', "plain::", "literal:true", "plain:,", 'key:"n"', "plain::", "number:-1.5", "plain:,", 'key:"s"', "plain::", 'string:"x"', "plain:}"]);
  });
  it("leaves plain text alone", () => {
    expect(highlight("a\nb", "text")).toEqual([[{ kind: "plain", text: "a" }], [{ kind: "plain", text: "b" }]]);
  });
});

describe("diff", () => {
  const a = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine";
  const b = "one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\nnine\nten";
  it("marks kept, removed and added lines with their numbers", () => {
    const d = diffLines(a, b);
    expect(d.filter((l) => l.kind !== "same")).toEqual([
      { kind: "del", text: "three", a: 3, b: null },
      { kind: "add", text: "THREE", a: null, b: 3 },
      { kind: "add", text: "ten", a: null, b: 10 },
    ]);
    expect(d.find((l) => l.text === "nine")).toEqual({ kind: "same", text: "nine", a: 9, b: 9 });
  });
  it("handles empty sides", () => {
    expect(diffLines("", "a\nb").map((l) => l.kind)).toEqual(["add", "add"]);
    expect(diffLines("a", "").map((l) => l.kind)).toEqual(["del"]);
  });
  it("folds unchanged lines far from a change", () => {
    const h = hunks(diffLines(a, b), 1);
    expect(h.map((x) => ("skipped" in x ? `skip ${x.skipped}` : x.lines.map((l) => l.text).join(",")))).toEqual(["one,two,three,THREE,four", "skip 4", "nine,ten"]);
  });
  it("finds the changed middle of a line", () => {
    expect(changedPart("expect total 59.90", "expect total 64.90")).toEqual({ a: ["expect total ", "59", ".90"], b: ["expect total ", "64", ".90"] });
  });
});

describe("tree", () => {
  const tree: TreeNode[] = [
    { id: "shop", label: "shop", children: [
      { id: "search", label: "Search", children: [{ id: "S1", label: "S1" }, { id: "S2", label: "S2" }] },
      { id: "C1", label: "C1 Guest checkout" },
    ] },
    { id: "A1", label: "A1 Sign in" },
  ];
  it("shows rows under open branches only", () => {
    expect(visibleRows(tree, new Set()).map((r) => r.node.id)).toEqual(["shop", "A1"]);
    const rows = visibleRows(tree, new Set(["shop", "search"]));
    expect(rows.map((r) => `${r.node.id}@${r.depth}`)).toEqual(["shop@1", "search@2", "S1@3", "S2@3", "C1@2", "A1@1"]);
    expect(rows[4]).toMatchObject({ parent: "shop", index: 2, setSize: 2 });
  });
  it("works out a branch's checked state from its leaves", () => {
    expect(leaves(tree[0]!)).toEqual(["S1", "S2", "C1"]);
    expect(checkState(tree[0]!, new Set(["S1"]))).toBe("some");
    expect(checkState(tree[0]!, new Set(["S1", "S2", "C1"]))).toBe("on");
    expect(toggleNode(tree[0]!, ["S1", "A1"]).sort()).toEqual(["A1", "C1", "S1", "S2"]);
    expect(toggleNode(tree[0]!, ["S1", "S2", "C1", "A1"])).toEqual(["A1"]);
  });
  it("moves like an ARIA tree", () => {
    const open = new Set(["shop"]);
    const rows = visibleRows(tree, open);
    expect(treeKey(rows, 1, "ArrowRight", open)).toEqual({ focus: 1, open: "search" });
    expect(treeKey(rows, 0, "ArrowRight", open)).toEqual({ focus: 1 });
    expect(treeKey(rows, 2, "ArrowLeft", open)).toEqual({ focus: 0 });
    expect(treeKey(rows, 0, "ArrowLeft", open)).toEqual({ focus: 0, close: "shop" });
    expect(treeKey(rows, 0, "End", open)).toEqual({ focus: 3 });
  });
  it("opens the way to matches", () => {
    expect([...pathsTo(tree, (n) => n.label.startsWith("S2"))].sort()).toEqual(["search", "shop"]);
  });
});
