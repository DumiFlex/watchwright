# Research: full Markdown in the preview

Status: built in `fix/markdown-html-gfm`.

## The question

The Markdown preview (a pack's README, the editor's preview, `.md` files on an attempt's Files tab) is a small hand-written reader in `packages/web/src/markdown.ts`. It covers CommonMark's common blocks and some of GitHub's additions, and it shows every bit of raw HTML as text. A README that folds a long part away with `<details><summary>…</summary>` shows the tags as text instead. What does it take to read Markdown the way GitHub shows it, without opening the page to script from a pack file?

## What the reader lacks

Checked against GitHub Flavored Markdown and what GitHub renders on top of it:

| Feature | Before |
| --- | --- |
| Raw HTML (`<details>`, `<summary>`, `<kbd>`, `<sub>`, `<sup>`, `<br>`, `<img width>`, `<p align>`, comments) | Shown as text |
| Markdown inside an HTML block (a list inside `<details>`) | Not read |
| Footnotes (`[^1]`) | Shown as text |
| Alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) | A plain quote with `[!NOTE]` in it |
| Reference links (`[text][ref]` with `[ref]: url`) | Shown as text |
| Entities (`&copy;`, `&#8594;`) | Shown as text |
| Heading ids | Close to GitHub's, but not the same for repeats and some punctuation |
| Lazy lines, nesting edge cases, emphasis rules | Approximate |
| Tables, task lists, strikethrough, autolinks, nested lists | Read |

Patching each of these into the hand-written reader would mean writing a CommonMark parser. The edge cases are where hand-written readers break, and every miss shows up as a README that looks wrong.

## Options

1. **markdown-it** with plugins, rendering an HTML string, cleaned by DOMPurify and set with `v-html`. Fast and well known, but the result is a string: code blocks could no longer be our `CodeView`, links and images could not go through the view's resolvers without walking the DOM afterwards, and AGENTS.md's web-app rule (draw with Vue, no `innerHTML`) would break.
2. **unified**: `remark-parse` + `remark-gfm` (micromark, the reference CommonMark parser with GFM) → `remark-rehype` → `rehype-raw` (parses the raw HTML with parse5, so Markdown inside `<details>` works) → `rehype-sanitize` (GitHub's own allow list). The result is a syntax tree (hast) with line positions, which the view draws with Vue's `h()`, as it does now. GitHub's renderer works the same way on the server (parse, then sanitize with an allow list).
3. **Keep the hand-written reader** and add what's missing. Smallest bundle, but see above.

## Decision

Option 2.

- **Safety.** Raw HTML goes through `rehype-sanitize` with GitHub's schema: no `<script>`, `<style>`, `<iframe>`, `<form>`, event handlers or `style` attributes; links keep `http`, `https`, `mailto` and relative targets. The view still never sets `innerHTML`, and our own `safeHref` check stays on every link and image. Ids from the file (headings, footnotes, `id`/`name` attributes) get the view's prefix, so they can't clobber page globals or the app's own ids.
- **Everything GitHub reads**: CommonMark, tables, task lists, strikethrough, autolinks, footnotes, the safe HTML tags, and alerts (a small step after sanitizing turns a quote that starts with `[!NOTE]` into an alert box). Headings get GitHub's ids (`github-slugger`), so `#anchor` links from GitHub work here too. No visible anchor icon: the app routes by the URL's hash, so an anchor can't become a link to copy.
- **Drawn in our style, every look.** Task boxes stay our own box (not the browser's checkbox), `<summary>` gets a Lucide chevron instead of the browser's triangle, footnote back links use an icon instead of `↩`, and alerts, `<kbd>`, `<details>` and footnotes take their colors from the theme tokens.
- **Kept**: code blocks in `CodeView`, pack links opening in the editor, pack images through the image route, the side-by-side cursor following (positions come from the tree), click a block to jump the editor.
- **Size.** The reader and parse5 add about 100 kB gzipped, and the main bundle gets about 1.5 kB smaller without the old reader. They load on first use (a dynamic import), so pages without Markdown don't pay for them.

Not included: math (`$…$`), Mermaid diagrams and emoji shortcodes (`:tada:`). Each is a plugin away if packs need them.
