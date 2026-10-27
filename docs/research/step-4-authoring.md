# Step 4 research: YAML tests, an editor and Record

Notes from reading Playwright 1.64 and trying things in the cloud sandbox (2026-10-27), before writing [docs/plans/step-4.md](../plans/step-4.md). Step 4 is the authoring step in the build order ([docs/plan.md](../plan.md), section 1): tests without code, editing a pack on the web page, and recording steps by clicking through a site.

## 1. What other tools do

| Tool | Steps without code | Editing | Recording |
|---|---|---|---|
| **Playwright codegen** (`npx playwright codegen`) | No: it writes code (JS, Python, Java, C#) or JSONL. | The inspector shows the code; you copy it into your own files. | Opens a headed browser and an inspector window on the machine. Locators prefer role, label, placeholder, text, test id, then CSS. Has assert modes (visible, text, value, aria snapshot). |
| **promptfoo browser provider** | A YAML step list: `navigate`, `click`, `type`, `extract`, `screenshot`, `wait`, CSS selectors only. | In the config file. | None. |
| **Maestro** (mobile) | YAML flows: `tapOn`, `inputText`, `assertVisible`, `runFlow`; very readable. | Maestro Studio: a live device view, click an element to get a command. | Studio records taps into YAML. |
| **WrightTest** | Step lists edited in a web UI. | Web form per step. | Records in a noVNC browser inside the UI. |
| **Checkly / Ghost Inspector / Rainforest** | Step forms in a web UI (Ghost Inspector, Rainforest); Checkly is code-first. | Web forms. | A browser extension records into steps. |

What carries over: a YAML step list is readable when each step is one verb with its target (Maestro, promptfoo); a person wants to see the page while picking an element (Maestro Studio, WrightTest); and recorded steps are only useful with good locators (role and label first, as codegen does), not CSS paths.

## 2. Recording without codegen's windows

Codegen as a separate process would open two windows on the PC and hand us code we'd have to parse back. Playwright has a better seam: `browserContext._startRecording({ language }, { actionAdded, actionUpdated, signalAdded })`, the internal call that Playwright's own `playwright-cli` uses (`coreBundle.js`, `ProgrammaticRecorderApp`). With `language: "jsonl"` every action comes back as structured JSON:

```json
{"name":"fill","text":"Eggs","locator":{"kind":"role","body":"textbox","options":{"attrs":[],"exact":false,"name":"What needs to be done?"}}, "selector":"internal:role=textbox[name=\"What needs to be done?\"i]", "signals":[], "pageGuid":"page@…"}
```

Tried in the sandbox (headless Chromium 1243):

- Recording works **headless**, and it records input sent with `page.mouse.click(x, y)` and `page.keyboard.type(…)`. So a person can record by clicking and typing on the live view in the web page: the web app sends the input, the page gets it, and the recorder writes the step. No window opens on the machine, it works the same on a remote server, and it can be tested in CI.
- Typing merges: `fill "A"` → `actionUpdated` `"Ad"` → `"Ada"`, so the last step is replaced, not appended.
- Locators come as `{ kind, body, options }` with kinds `role`, `text`, `label`, `placeholder`, `test-id`, `alt`, `title`, `default` (CSS) and chain links (`nth`, `has-text`, `frame`). That maps one to one onto a YAML target.
- Navigation arrives as `openPage` and `navigate`, popups as `openPage` with a new `pageGuid`.
- `page.pickLocator()` is public in 1.64. Started before a forwarded click, it resolves with the clicked element's locator (`getByTestId('item')`). That gives "Check this element" while recording.

Risks: `_startRecording` starts with an underscore, so a Playwright update can change it. Watchwright pins Playwright to an exact version already; a test drives the recorder in CI so an update that breaks it fails there, and Record says plainly that it needs a newer Watchwright instead of failing quietly. Firefox: not tried here (no Firefox in the sandbox); it is part of the PC check.

## 3. The editor

| Option | Size (min+gz, rough) | Themeable from CSS variables | Notes |
|---|---|---|---|
| **CodeMirror 6** | 120 to 180 KB with JS/TS, YAML, JSON, Markdown | Yes: themes are CSS, so tokens from `src/style.css` work in every look and mode | Mobile friendly (contenteditable), lint and autocomplete APIs, used by Playwright's own trace viewer and recorder. |
| Monaco | 800 KB+ plus workers | Its own theme format, would need a mapping per look | Desktop only, heavy. |
| A textarea + our highlighter | tiny | yes | No undo history worth the name, no lint markers, no autocomplete. |

CodeMirror 6, loaded in its own chunk only on the editor page. YAML is parsed with `yaml` (eemeli), which keeps comments and positions, both on the server (loading) and in the web app (lint as you type, and the Steps view editing the file without losing comments).

## 4. The YAML test format

Goals: a test that reads like a list of what a person does; every step maps to one `h` call, so pausing, the step timeline, logs and the live view behave exactly like code tests; targets in the same words Playwright uses (`role`, `label`, `text`, …); anything a YAML file can't say is a code test, and a YAML test can call a pack's helpers.

Checked against the pack API: every core `h` helper has a step, `expect` covers the Playwright matchers people use most (visible, hidden, text, value, count, checked, enabled, URL, title), and test metadata (`id`, `title`, `section`, `description`, `tags`, `runs`, `needs`, `inside`, `timeout`, `review`) is the same as in code.

A JSON Schema for the format ships with the package. It drives the loader's checks, the editor's hints, and `# yaml-language-server: $schema=…` in VS Code, and step 5 hands it to agents.

## 5. Sources

- Playwright 1.64.1 `playwright-core/lib/coreBundle.js`: `ProgrammaticRecorderApp`, `JsonlLanguageGenerator`, `BrowserContextDispatcher.startRecording`; `types.d.ts` for `page.pickLocator()`.
- Playwright docs: codegen, locators, `LocatorAssertions`.
- promptfoo browser provider docs; Maestro docs (flows, Studio); CodeMirror 6 docs (theming, lint); `yaml` package docs (Document API, source tokens).
- Sandbox checks: `_startRecording` with `jsonl` on headless Chromium, with locator clicks and with raw mouse and keyboard input; `pickLocator()` resolved by a raw mouse click.
