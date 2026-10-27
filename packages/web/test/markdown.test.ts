import { describe, expect, it } from "vitest";
import { inlines, outline, parseMarkdown, resolveRelative, safeHref, slugify, type Block } from "../src/markdown";

const one = (md: string): Block => {
  const b = parseMarkdown(md);
  expect(b).toHaveLength(1);
  return b[0]!;
};

describe("blocks", () => {
  it("reads ATX and setext headings with unique ids and line numbers", () => {
    const b = parseMarkdown("# Hello world\n\ntext\n\n## Hello world\n\nTitle\n=====\n");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "h", "h"]);
    expect(b[0]).toMatchObject({ level: 1, id: "hello-world", line: 1 });
    expect(b[2]).toMatchObject({ level: 2, id: "hello-world-1", line: 5 });
    expect(b[3]).toMatchObject({ level: 1, id: "title", line: 7 });
  });

  it("drops closing hashes and needs a space after the marks", () => {
    expect(one("## Setup ##")).toMatchObject({ t: "h", c: [{ t: "text", v: "Setup" }] });
    expect(one("#nope")).toMatchObject({ t: "p" });
  });

  it("joins paragraph lines and splits on blank lines", () => {
    const b = parseMarkdown("one\ntwo\n\nthree");
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ t: "p", c: [{ t: "text", v: "one two" }] });
  });

  it("reads fenced code with its language and keeps the body verbatim", () => {
    expect(one("```TS\nconst a = 1;\n# not a heading\n```")).toEqual({ t: "code", lang: "ts", v: "const a = 1;\n# not a heading", line: 1 });
    expect(one("~~~\nx\n~~~")).toMatchObject({ t: "code", lang: "", v: "x" });
  });

  it("runs an unclosed fence to the end", () => {
    expect(one("```\na\nb")).toMatchObject({ t: "code", v: "a\nb" });
  });

  it("reads indented code", () => {
    expect(one("    npm i\n    pnpm i")).toMatchObject({ t: "code", v: "npm i\npnpm i" });
  });

  it("reads rules and quotes", () => {
    const b = parseMarkdown("> quoted\nlazy\n\n---\n\n* * *");
    expect(b.map((x) => x.t)).toEqual(["quote", "hr", "hr"]);
    expect(b[0]).toMatchObject({ c: [{ t: "p", c: [{ t: "text", v: "quoted lazy" }] }] });
  });

  it("reads bullet and ordered lists, tight and loose", () => {
    const tight = one("- a\n- b\n  - nested");
    expect(tight).toMatchObject({ t: "list", ordered: false, tight: true });
    if (tight.t !== "list") throw new Error();
    expect(tight.items).toHaveLength(2);
    expect(tight.items[1]!.c.map((c) => c.t)).toEqual(["p", "list"]);

    expect(one("3. a\n\n4. b")).toMatchObject({ t: "list", ordered: true, start: 3, tight: false });
  });

  it("starts a new list when the marker changes", () => {
    expect(parseMarkdown("- a\n+ b").map((b) => b.t)).toEqual(["list", "list"]);
  });

  it("reads task list items", () => {
    const l = one("- [ ] todo\n- [x] done\n- plain");
    if (l.t !== "list") throw new Error();
    expect(l.items.map((i) => i.checked)).toEqual([false, true, null]);
    expect(l.items[0]!.c[0]).toMatchObject({ c: [{ t: "text", v: "todo" }] });
  });

  it("reads tables with alignment, escaped pipes and pipes in code", () => {
    const t = one("| Name | Size |  Note |\n|:-----|-----:|:----:|\n| a \\| b | 2 | `x|y` |\n| short |");
    if (t.t !== "table") throw new Error();
    expect(t.align).toEqual(["left", "right", "center"]);
    expect(t.rows[0]![0]).toEqual([{ t: "text", v: "a | b" }]);
    expect(t.rows[0]![2]).toEqual([{ t: "code", v: "x|y" }]);
    expect(t.rows[1]).toHaveLength(3);
  });

  it("does not take a line with a pipe for a table without a rule row", () => {
    expect(one("a | b\nc")).toMatchObject({ t: "p" });
  });

  it("keeps raw HTML as text", () => {
    expect(one("<script>alert(1)</script>")).toMatchObject({ t: "p", c: [{ t: "text", v: "<script>alert(1)</script>" }] });
  });

  it("handles CRLF line ends", () => {
    expect(parseMarkdown("# A\r\n\r\nb").map((b) => b.t)).toEqual(["h", "p"]);
  });
});

describe("inlines", () => {
  it("reads emphasis, strong, both and strikethrough", () => {
    expect(inlines("*a* **b** ***c*** ~~d~~")).toEqual([
      { t: "em", c: [{ t: "text", v: "a" }] },
      { t: "text", v: " " },
      { t: "strong", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "strong", c: [{ t: "em", c: [{ t: "text", v: "c" }] }] },
      { t: "text", v: " " },
      { t: "del", c: [{ t: "text", v: "d" }] },
    ]);
  });

  it("leaves underscores inside words alone", () => {
    expect(inlines("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
    expect(inlines("_yes_")).toEqual([{ t: "em", c: [{ t: "text", v: "yes" }] }]);
  });

  it("does not open emphasis before a space", () => {
    expect(inlines("2 * 3 * 4")).toEqual([{ t: "text", v: "2 * 3 * 4" }]);
  });

  it("reads code spans, which hide other marks", () => {
    expect(inlines("run `a *b* c` now")).toEqual([
      { t: "text", v: "run " },
      { t: "code", v: "a *b* c" },
      { t: "text", v: " now" },
    ]);
    expect(inlines("`` a ` b ``")).toEqual([{ t: "code", v: "a ` b" }]);
  });

  it("reads links with titles, nested brackets and parentheses", () => {
    expect(inlines('[the [docs]](https://x.dev/a_(b) "Docs")')).toEqual([
      { t: "link", href: "https://x.dev/a_(b)", title: "Docs", c: [{ t: "text", v: "the [docs]" }] },
    ]);
  });

  it("reads images", () => {
    expect(inlines("![a cat](cat.png)")).toEqual([{ t: "img", src: "cat.png", alt: "a cat" }]);
  });

  it("drops unsafe link targets but keeps the text", () => {
    expect(inlines("[click](javascript:alert(1))")).toEqual([{ t: "text", v: "click" }]);
    expect(inlines("![x](data:image/png;base64,AAA)")).toEqual([{ t: "text", v: "x" }]);
  });

  it("reads autolinks and bare links without trailing punctuation", () => {
    expect(inlines("<https://a.dev>")).toEqual([{ t: "link", href: "https://a.dev", c: [{ t: "text", v: "https://a.dev" }] }]);
    expect(inlines("see www.a.dev/x.")).toEqual([
      { t: "text", v: "see " },
      { t: "link", href: "https://www.a.dev/x", c: [{ t: "text", v: "www.a.dev/x" }] },
      { t: "text", v: "." },
    ]);
  });

  it("reads escapes and hard breaks", () => {
    expect(inlines("\\*not\\*")).toEqual([{ t: "text", v: "*not*" }]);
    expect(inlines("a  \nb\\\nc")).toEqual([{ t: "text", v: "a" }, { t: "br" }, { t: "text", v: "b" }, { t: "br" }, { t: "text", v: "c" }]);
  });
});

describe("helpers", () => {
  it("slugifies like GitHub", () => {
    expect(slugify("Run the bench (fast!)")).toBe("run-the-bench-fast");
    expect(slugify("Ünïcode  words")).toBe("ünïcode--words");
  });

  it("lists headings for an outline, inside quotes and lists too", () => {
    expect(outline(parseMarkdown("# A\n\n> ## B\n\n- ### C"))).toEqual([
      { level: 1, text: "A", id: "a", line: 1 },
      { level: 2, text: "B", id: "b", line: 3 },
      { level: 3, text: "C", id: "c", line: 5 },
    ]);
  });

  it("keeps only safe hrefs", () => {
    expect(safeHref("docs/a.md")).toBe("docs/a.md");
    expect(safeHref("#top")).toBe("#top");
    expect(safeHref("MAILTO:a@b.c")).toBe("MAILTO:a@b.c");
    expect(safeHref("vbscript:x")).toBeNull();
    expect(safeHref("  ")).toBeNull();
  });

  it("resolves relative links from a file", () => {
    expect(resolveRelative("README.md", "tests/a.yaml")).toBe("tests/a.yaml");
    expect(resolveRelative("docs/guide.md", "../README.md#use")).toBe("README.md");
    expect(resolveRelative("docs/guide.md", "./b%20c.md")).toBe("docs/b c.md");
    expect(resolveRelative("docs/guide.md", "/top.md")).toBe("top.md");
    expect(resolveRelative("README.md", "../outside.md")).toBeNull();
    expect(resolveRelative("README.md", "#anchor")).toBeNull();
    expect(resolveRelative("README.md", "https://a.dev")).toBeNull();
  });
});
