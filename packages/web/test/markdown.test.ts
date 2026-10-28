import { describe, expect, it } from "vitest";
import { findReadme, packImageUrl, resolveRelative, safeHref } from "../src/markdown";
import { outline, parseMarkdown, textOf, type Element, type ElementContent, type Root } from "../src/markdown-parse";

// A compact view of the tree: tag[.class][ attr=value…](children), text as "…".
function show(n: Root | ElementContent): string {
  if (n.type === "text") return JSON.stringify(n.value);
  if (n.type !== "element" && n.type !== "root") return "";
  const kids = n.children.map((c) => show(c as ElementContent)).filter((c) => c && !/^"(\\n)+"$/.test(c));
  if (n.type === "root") return kids.join(" ");
  const { className, ...rest } = n.properties;
  const cls = Array.isArray(className) ? className.map((c) => `.${c}`).join("") : "";
  const at = Object.entries(rest).map(([k, v]) => ` ${k}=${Array.isArray(v) ? v.join(",") : String(v)}`).join("");
  return `${n.tagName}${cls}${at}(${kids.join(" ")})`;
}
const md = (s: string) => show(parseMarkdown(s));
const first = (s: string) => parseMarkdown(s).children.find((c): c is Element => c.type === "element");

describe("raw HTML", () => {
  it("reads <details> and <summary>, with Markdown inside", () => {
    expect(md("<details><summary>Answer schema</summary>\n\n- **one**\n\n</details>")).toBe('details(summary("Answer schema") ul(li(strong("one"))))');
  });

  it("keeps safe inline tags", () => {
    expect(md("Press <kbd>Ctrl</kbd>+<kbd>K</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <mark>this</mark><br>next")).toBe(
      'p("Press " kbd("Ctrl") "+" kbd("K") ", H" sub("2") "O, x" sup("2") ", " mark("this") br() "next")',
    );
  });

  it("keeps sizes and alignment on images and paragraphs", () => {
    expect(md('<p align="center"><img src="logo.png" width="120" alt="Logo"></p>')).toBe("p align=center(img src=logo.png width=120 alt=Logo())");
  });

  it("drops script, styles, frames, handlers and unsafe links", () => {
    const out = md(
      '<script>alert(1)</script><style>p{color:red}</style>\n\n<iframe src="https://x.dev"></iframe><img src="a.png" onerror="alert(1)" style="x"> <a href="javascript:alert(1)">go</a> <a href="https://a.dev" onclick="x">ok</a>',
    );
    expect(out).not.toMatch(/alert|color|iframe|onerror|onclick|style|javascript/);
    expect(out).toContain("img src=a.png()");
    expect(out).toContain('a("go")');
    expect(out).toContain('a href=https://a.dev("ok")');
  });

  it("drops comments and keeps entities as characters", () => {
    expect(md("a <!-- hidden --> &copy; &#8594;")).toBe('p("a " " © →")');
  });

  it("leaves HTML in code as text", () => {
    expect(md("`<b>x</b>`")).toBe('p(code("<b>x</b>"))');
  });
});

describe("GitHub Flavored Markdown", () => {
  it("reads tables with alignment", () => {
    expect(md("| a | b |\n|:-|-:|\n| 1 | `x\\|y` |")).toBe('table(thead(tr(th align=left("a") th align=right("b"))) tbody(tr(td align=left("1") td align=right(code("x|y")))))');
  });

  it("reads task lists", () => {
    expect(md("- [x] done\n- [ ] todo")).toBe('ul.contains-task-list(li.task-list-item(input type=checkbox checked=true disabled=true() " done") li.task-list-item(input type=checkbox disabled=true() " todo"))');
  });

  it("reads strikethrough, autolinks and reference links", () => {
    expect(md("~~old~~ www.a.dev and https://b.dev/x. [ref][r]\n\n[r]: https://c.dev")).toBe(
      'p(del("old") " " a href=http://www.a.dev("www.a.dev") " and " a href=https://b.dev/x("https://b.dev/x") ". " a href=https://c.dev("ref"))',
    );
  });

  it("reads footnotes with ids for both directions", () => {
    const out = md("Text[^1].\n\n[^1]: The note.");
    expect(out).toContain("a href=#fn-1 id=fnref-1");
    expect(out).toContain("section.footnotes");
    expect(out).toContain("li id=fn-1");
    expect(out).toContain("a.data-footnote-backref href=#fnref-1");
  });

  it("reads nested lists", () => {
    expect(md("1. one\n   - a\n     - b\n2. two")).toBe('ol(li("one\\n" ul(li("a\\n" ul(li("b"))))) li("two"))');
  });

  it("reads fenced code with its language", () => {
    expect(md("```json\n{}\n```")).toBe('pre(code.language-json("{}\\n"))');
  });
});

describe("alerts", () => {
  it("turns a quote marked [!NOTE] and friends into an alert", () => {
    expect(md("> [!WARNING]\n> Mind the gap.")).toBe('div.md-alert.md-alert-warning(p.md-alert-title("Warning") p("Mind the gap."))');
    expect(md("> [!tip]\n>\n> - a")).toBe('div.md-alert.md-alert-tip(p.md-alert-title("Tip") ul(li("a")))');
  });

  it("leaves other quotes alone", () => {
    expect(md("> [!NOTE] same line")).toBe('blockquote(p("[!NOTE] same line"))');
    expect(md("> [!NOTE]")).toBe('blockquote(p("[!NOTE]"))');
    expect(md("> [!OTHER]\n> x")).toBe('blockquote(p("[!OTHER]\\nx"))');
  });
});

describe("headings", () => {
  it("gets GitHub's ids, unique per document", () => {
    expect(md("# Run the bench (fast!)\n\n## Run the bench (fast!)\n\n### Ünïcode  words")).toBe(
      'h1 id=run-the-bench-fast("Run the bench (fast!)") h2 id=run-the-bench-fast-1("Run the bench (fast!)") h3 id=ünïcode--words("Ünïcode  words")',
    );
  });

  it("lists headings for an outline, inside quotes, lists and details too", () => {
    expect(outline(parseMarkdown("# A\n\n> ## B\n\n- ### C\n\n<details>\n\n#### D\n\n</details>\n\nx[^1]\n\n[^1]: y"))).toEqual([
      { level: 1, text: "A", id: "a", line: 1 },
      { level: 2, text: "B", id: "b", line: 3 },
      { level: 3, text: "C", id: "c", line: 5 },
      { level: 4, text: "D", id: "d", line: 9 },
    ]);
  });

  it("keeps line positions for the editor's cursor", () => {
    const tree = parseMarkdown("intro\n\n```ts\nx\n```\n\n<details><summary>S</summary>\n\nbody\n\n</details>");
    const lines = tree.children.filter((c): c is Element => c.type === "element").map((c) => [c.tagName, c.position?.start.line]);
    expect(lines).toEqual([
      ["p", 1],
      ["pre", 3],
      ["details", 7],
    ]);
    expect(textOf(first("Hi *there* ![pic](a.png)") as Element)).toBe("Hi there pic");
  });
});

describe("helpers", () => {
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

  it("finds the README at the top of a folder", () => {
    expect(findReadme(["pack.ts", "docs/README.md", "readme.txt", "README.md"])).toBe("README.md");
    expect(findReadme(["Readme.markdown", "README"])).toBe("Readme.markdown");
    expect(findReadme(["README", "readme.txt"])).toBe("README");
    expect(findReadme(["docs/README.md", "pack.ts", "README.json"])).toBeNull();
  });

  it("builds the address of an image in a pack", () => {
    expect(packImageUrl("a9ef9e79", "docs/guide.md", "../img/a b.png")).toBe("/api/v1/packs/a9ef9e79/image?path=img%2Fa%20b.png");
    expect(packImageUrl("a9ef9e79", "README.md", "../x.png")).toBeNull();
  });
});
