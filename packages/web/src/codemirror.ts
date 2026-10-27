// The editor page's code editor: CodeMirror 6 with the app's colors (all from the theme tokens,
// so every look and mode works), languages for pack files, problems from the page, and for YAML
// tests completion of steps, fields and values with the steps' docs on hover. Loaded only by
// CodeEditor.vue, in its own chunk.
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers, placeholder as placeholderExt } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { yamlCompletions, yamlHover } from "./yamlhints";

export type EditorLang = "code" | "yaml" | "json" | "markdown" | "text";

export interface EditorProblem {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface EditorOptions {
  text: string;
  lang: EditorLang;
  /** YAML test files get step completion and docs on hover. */
  steps?: boolean;
  readOnly?: boolean;
  label: string;
  placeholder?: string;
  onChange?(text: string): void;
  onSave?(): void;
  onCursor?(line: number): void;
}

export interface EditorHandle {
  text(): string;
  /** Replaces the whole text (keeping the cursor where it can) without calling onChange; undo takes it back. */
  setText(text: string): void;
  setProblems(problems: readonly EditorProblem[]): void;
  /** Puts the cursor on a line (from 1) and a column, and scrolls it into the middle. */
  goto(line: number, col?: number): void;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  destroy(): void;
}

const theme = EditorView.theme({
  "&": { color: "var(--text)", backgroundColor: "var(--surface)", fontSize: "13px", height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--text)", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--muted)", border: "none", borderRight: "var(--border-width) solid var(--line)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)", color: "var(--text)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)", outline: "var(--border-width) solid color-mix(in srgb, var(--accent) 50%, transparent)" },
  ".cm-nonmatchingBracket": { color: "var(--bad)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warn) 25%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warn) 45%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  ".cm-placeholder": { color: "var(--muted)" },
  // Panels (search), tooltips and the completion list, in the app's surfaces.
  ".cm-panels": { backgroundColor: "var(--raised)", color: "var(--text)", fontFamily: "var(--font-ui)" },
  ".cm-panels.cm-panels-top": { borderBottom: "var(--border-width) solid var(--line)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "var(--border-width) solid var(--line)" },
  ".cm-panel.cm-search": { padding: "8px 10px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" },
  ".cm-panel.cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--muted)" },
  ".cm-panel.cm-search [name=close]": { position: "static", marginLeft: "auto", color: "var(--muted)", fontSize: "18px", background: "transparent", border: "0", cursor: "pointer" },
  ".cm-textfield": {
    font: "inherit",
    fontSize: "13px",
    padding: "4px 8px",
    color: "var(--text)",
    backgroundColor: "var(--surface)",
    border: "var(--border-width) solid var(--line-strong)",
    borderRadius: "var(--radius-sm)",
  },
  ".cm-textfield:focus": { outline: "2px solid var(--accent)", outlineOffset: "-1px" },
  ".cm-button": {
    font: "inherit",
    fontSize: "12px",
    padding: "4px 10px",
    color: "var(--text)",
    backgroundImage: "none",
    backgroundColor: "var(--surface)",
    border: "var(--border-width) solid var(--line-strong)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  ".cm-button:hover": { backgroundColor: "var(--hover)" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", color: "var(--text)", border: "var(--border-width) solid var(--line)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-pop, 0 6px 24px rgb(0 0 0 / 0.18))", fontFamily: "var(--font-ui)" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", maxHeight: "16em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px 3px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "10px", fontFamily: "var(--font-ui)", fontSize: "12px" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent-text)", fontWeight: "600" },
  ".cm-completionInfo": { padding: "8px 10px", maxWidth: "340px", fontSize: "12.5px", lineHeight: "1.5" },
  ".cm-tooltip-hover": { padding: "8px 10px", maxWidth: "380px", fontSize: "12.5px", lineHeight: "1.5" },
  ".ww-hint-name": { fontFamily: "var(--font-mono)", fontWeight: "600", color: "var(--accent-text)" },
  ".ww-hint-fields": { margin: "6px 0 0", padding: "0", listStyle: "none", color: "var(--muted)" },
  ".ww-hint-fields code": { fontFamily: "var(--font-mono)", color: "var(--text)" },
  // Problems: a wavy underline in the status color, and a dot in the gutter.
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--bad)", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--warn)", textUnderlineOffset: "3px" },
  ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline dotted var(--muted)", textUnderlineOffset: "3px" },
  ".cm-diagnostic": { padding: "6px 10px", borderLeft: "3px solid var(--line-strong)" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--bad)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--warn)" },
  ".cm-gutter-lint": { width: "14px" },
  ".cm-lint-marker": { width: "8px", height: "8px", borderRadius: "50%", content: "none", margin: "6px 3px 0" },
  ".cm-lint-marker-error": { backgroundColor: "var(--bad)" },
  ".cm-lint-marker-warning": { backgroundColor: "var(--warn)" },
  ".cm-lint-marker-info": { backgroundColor: "var(--muted)" },
});

const colors = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: "var(--accent-text)" },
  { tag: [t.propertyName, t.attributeName, t.labelName, t.definition(t.propertyName)], color: "var(--accent-text)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.content], color: "var(--ok)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--warn)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--paused)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.heading], color: "var(--text)", fontWeight: "700" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "700" },
  { tag: [t.link, t.url], color: "var(--accent-text)", textDecoration: "underline" },
  { tag: [t.typeName, t.className], color: "var(--paused)" },
  { tag: [t.invalid], color: "var(--bad)" },
]);

function language(lang: EditorLang): Extension {
  switch (lang) {
    case "code":
      return javascript({ typescript: true });
    case "yaml":
      return yaml();
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "text":
      return [];
  }
}

function yamlTools(): Extension {
  return [
    autocompletion({ override: [(ctx: CompletionContext): CompletionResult | null => yamlCompletions(ctx.state.doc.toString(), ctx.pos, ctx.explicit) as CompletionResult | null], icons: false }),
    hoverTooltip((view, pos) => {
      const hint = yamlHover(view.state.doc.toString(), pos);
      if (!hint) return null;
      return {
        pos: hint.from,
        end: hint.to,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          const name = dom.appendChild(document.createElement("div"));
          name.className = "ww-hint-name";
          name.textContent = hint.title;
          dom.appendChild(document.createElement("div")).textContent = hint.doc;
          if (hint.fields.length) {
            const ul = dom.appendChild(document.createElement("ul"));
            ul.className = "ww-hint-fields";
            for (const f of hint.fields) {
              const li = ul.appendChild(document.createElement("li"));
              li.appendChild(document.createElement("code")).textContent = f.name;
              li.append(` ${f.doc}`);
            }
          }
          return { dom };
        },
      };
    }),
  ];
}

export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorHandle {
  const readOnly = new Compartment();
  let quiet = false;
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    lintGutter(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    syntaxHighlighting(colors),
    theme,
    language(opts.lang),
    readOnly.of([EditorState.readOnly.of(!!opts.readOnly), EditorView.editable.of(!opts.readOnly)]),
    EditorView.contentAttributes.of({ "aria-label": opts.label }),
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (opts.onSave?.(), true) },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !quiet) opts.onChange?.(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) opts.onCursor?.(u.state.doc.lineAt(u.state.selection.main.head).number);
    }),
  ];
  if (opts.placeholder) extensions.push(placeholderExt(opts.placeholder));
  if (opts.steps) extensions.push(yamlTools());
  else if (opts.lang !== "text") extensions.push(autocompletion({ icons: false }));
  const view = new EditorView({ parent, state: EditorState.create({ doc: opts.text, extensions }) });

  return {
    text: () => view.state.doc.toString(),
    setText(text) {
      if (text === view.state.doc.toString()) return;
      const head = Math.min(view.state.selection.main.head, text.length);
      quiet = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(head) });
      quiet = false;
    },
    setProblems(problems) {
      const len = view.state.doc.length;
      const list: Diagnostic[] = problems.map((p) => {
        const from = Math.max(0, Math.min(p.from, len));
        return { from, to: Math.max(from, Math.min(p.to, len)), severity: p.severity, message: p.message };
      });
      view.dispatch(setDiagnostics(view.state, list));
    },
    goto(line, col = 1) {
      const n = Math.max(1, Math.min(line, view.state.doc.lines));
      const l = view.state.doc.line(n);
      const pos = Math.min(l.to, l.from + Math.max(0, col - 1));
      view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    },
    setReadOnly(ro) {
      view.dispatch({ effects: readOnly.reconfigure([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

export type { Completion };
