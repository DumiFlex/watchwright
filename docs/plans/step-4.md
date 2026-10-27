# Step 4 plan: YAML tests, an editor and Record

Status: agreed (2026-10-27), being built. [docs/plan.md](../plan.md) holds the base design, [step-2.md](step-2.md) the web app, [step-qol.md](step-qol.md) the quality-of-life step. The research behind this plan is in [docs/research/step-4-authoring.md](../research/step-4-authoring.md).

Steps 1 to 3 made Watchwright run, show and review tests written in TypeScript. This step lets people write tests without code, edit a pack on the web page, and record steps by clicking through their site in the live view. A second pack, for a public demo app and written entirely in YAML, shows that none of it is tied to one site.

Everything here is general. Nothing is for one site or one pack.

## 1. What step 4 delivers

At the end of step 4 a person can:

1. **Write a test as a YAML step list** next to code tests in any pack, or make a whole pack with no code at all (`pack.yaml`). YAML tests run in the same engine: pause, retry, hot reload, the step timeline, shots, review and compare work as for code tests.
2. **Edit a pack on the web page**: a file tree and an editor (CodeMirror) with colors from the theme, hints and problems as you type, save with hot reload at the next attempt, and a guard when the file changed on disk.
3. **See and edit a YAML test as steps**: a list of its steps in plain words, each opened in a form made from the kit's controls, reordered by dragging. The Steps view and the source are the same file, and comments survive.
4. **Run the test being edited** from the editor, with a live view docked beside it.
5. **Record**: click and type on the live view of a recording browser, and the steps appear in the test as you go, with good locators (role, label, text first). Add checks by pointing at an element. Start recording from the middle of a test: the steps above the cursor run first.
6. **Turn a YAML test into code** when it outgrows YAML.
7. **Use the second pack**: a TodoMVC pack for the Playwright demo app, in YAML, in `examples/todomvc/`.

Not in step 4: agents writing tests (`try_steps`, `validate_test`, MCP: step 5; the file and record actions added here are in the action registry, so step 5 only exposes them), taking over a *running* test from the live view (later, docs/plan.md step 7; Record uses the same input path, but only on its own browser), and visual or snapshot assertions.

## 2. YAML tests

### 2.1 Files

YAML test files live with the code tests. The default test glob becomes `tests/**/*.{ts,mts,js,mjs,yaml,yml}`; a pack with its own `tests` globs adds YAML files by listing them. A file holds one test, or several under `tests:`.

```yaml
# tests/add-todo.yaml
id: T1
title: Add a todo
section: Todos
description: A new todo shows at the bottom of the list and counts as left to do.
tags: [smoke]
runs: 2
steps:
  - goto: /todomvc/
  - fill: { target: { placeholder: What needs to be done? }, value: Buy milk }
  - press: Enter
  - expect: { target: { testId: todo-title }, text: Buy milk }
  - expect: { target: { testId: todo-count }, containsText: 1 item left }
  - shot: one-todo
```

Metadata is the same as in code: `id`, `title`, `section`, `description`, `tags`, `runs` (a number or `{ by, …, default }`; a function needs code), `needs`, `inside`, `timeout`, `review`.

### 2.2 Targets

A target is a Playwright selector string (`"#save"`, `"text=Save"`, `"[data-test=save]"`) or a map in Playwright's words:

| Key | Same as |
|---|---|
| `role` + `name` (and `exact`, `checked`, `level`, …) | `getByRole` |
| `label`, `placeholder`, `text`, `alt`, `title`, `testId` | `getByLabel` … `getByTestId` (with `exact`) |
| `css` | `locator(css)` |
| `nth`, `first`, `last`, `hasText`, `has`, `within` | `nth()`, `filter()`, a parent target to search inside |
| `frame` | a target inside an iframe |

These are the locator kinds the recorder produces, so a recorded step and a hand-written one look the same.

### 2.3 Steps

Each step is one verb and maps to one `h` call (so it is a pause point and shows in the log and timeline):

| Group | Steps |
|---|---|
| Go | `goto`, `back`, `reload` |
| Act | `click` (with `done`: a target that must appear), `dblclick`, `fill`, `type` (key by key), `press`, `check`, `uncheck`, `select`, `hover`, `upload` (files next to the pack), `scroll` |
| Wait | `wait` (ms), `waitFor` (a target and a state), `idle` |
| Check | `expect`: `visible`, `hidden`, `text`, `containsText`, `value`, `count`, `checked`, `enabled`, `disabled`, `url`, `title`, each with `not` and `timeout`. A failed check fails the attempt, like `expect` in code |
| Keep | `shot`, `scrollShots`, `keepText`, `note`, `log`, `flag`, `metric` (a number, or one read from an element), `save` (a value or an element's text), `info` |
| Shape | `step` (a titled group of steps), `if` (`has` / `not` a target, with `then` and `else`), `repeat` (`times`, or `until` a target shows), `child` (run an `inside` child here), `skip` (with a reason), `use` (call one of the pack's own helpers by name, with arguments) |

Values can use `${params.lang}`, `${saved.key}`, `${attempt}`, `${last}` and `${env.NAME}`. Values read from `env` are masked as `•••` in logs and results, so a password can come from the environment without landing in a result file.

### 2.4 A pack without code

`pack.yaml` (found after `pack.ts`, `pack.js` …) holds the pack options that don't need code: `name`, `description`, `site`, `browser` (name, viewport, headless, and the plain-data context options such as locale, colorScheme, timezone), `params`, `flags`, `tests`, `run`, `rubric`, and the built-in collectors by name (`consoleErrors`, `failedRequests`, `responses: { match }`). It adds `setup` (steps run once per run) and `beforeEach` / `afterEach` (steps around each attempt). Hooks, custom collectors, helpers and an `idle` check need a code pack; a code pack's YAML tests can call its helpers with `use`.

### 2.5 Loading, checks and hot reload

- The loader parses YAML files with `yaml` (comments and positions kept), checks them against the JSON Schema, and builds `TestDefinition`s whose body runs the steps through `h`. Problems name the file, line and column: `tests/add-todo.yaml:6:5 "fil" isn't a step. Did you mean "fill"?`
- YAML files are part of the pack's stamp, so a saved change is picked up at the next attempt, and a file that doesn't load keeps the old version with the reason logged, as for code.
- A step that fails shows its line in the attempt page's code view, as a code test's failing line does now.
- The schema ships in the package (`watchwright/schema/test.json`, `pack.json`) and on the docs site, for VS Code and for agents.

### 2.6 To code

"Convert to code" writes the same test as a `.ts` file (each step becomes its `h` or `expect` call, comments carried over), and removes the YAML file only after the new file loads. The converter is the same one Record uses for code tests (section 4).

## 3. The editor

A new **Edit** tab on the pack page (`#/packs/:id/edit/<file>`), from the pack page, from a test's row ("Edit test") and from an attempt page ("Edit this test", opened at the failing line).

- **Files.** The pack folder's text files as a tree (TS/JS, YAML, JSON, Markdown, text), hiding `node_modules`, `.git` and build output. New file, new test (YAML or code, from a template), rename and delete (with a confirm). At phone width the tree is a drawer.
- **Editor.** CodeMirror 6 in its own chunk, loaded only on this page. Colors, fonts and the selection come from the theme tokens, so every look and mode works. Undo, search, bracket matching, Ctrl+S to save, an unsaved mark on the file and a guard when leaving with changes.
- **Hints and problems.** YAML tests: step and key completion from the schema, problems underlined as you type, the docs of a step on hover. Code: after a save, the pack's build errors and load problems show at their lines. A problem list under the editor jumps to each one.
- **Steps view** for YAML tests: a list of steps with an icon and a plain summary each ("Fill *What needs to be done?* with *Buy milk*"), a form per step built from the kit (the target as a kind menu + fields), add, duplicate, delete and drag to reorder. Switching between Steps and Source keeps the cursor on the same step. Edits go through `yaml`'s document model, so comments and formatting the person wrote stay.
- **Saving.** Atomic writes. Each file is saved with the stamp it was opened with; if the file changed on disk since, the page shows both and lets the person reload or overwrite. A save while a run uses the pack is fine: the run takes the change at its next attempt, as hot reload does now.
- **Run this test.** Starts a run of the test (and what it `needs`) with the last values used for this pack, and docks the run's live view beside the editor. Pause, Retry and Stop are there too; after a broken attempt, fixing the step and saving retries it (the existing hot reload rule).

The server side is a new `editor` plugin with actions in the registry (`packs.files`, `packs.file`, `packs.file-save`, `packs.file-create`, `packs.file-rename`, `packs.file-delete`, `packs.check-yaml`). It only touches files inside the pack folder (resolved with `realpath`, so links can't lead out), only text files under 1 MB, and goes through the request guard like every change.

## 4. Record

**Record** in the editor (a YAML test or a code test) or "New recording" on the pack page.

1. **A recording browser.** A browser session with the pack's browser, viewport and context options, opened at the cursor's page or the site's base URL. It takes the pack's site lock: a run of the same site waits for the recording to end, and Record waits (and says so) while such a run is going, because both would change the same app.
2. **Record from here.** With the cursor inside a test, the steps above it run first (shown live), then recording starts from that state. On a code test this runs the code up to the cursor's line through the normal engine, then hands over the page.
3. **Clicking on the live view.** The recording browser streams to a live view on the page, the same viewer as a run. Clicks, double clicks, typing, keys, scrolling and drag on the view are sent to the page (scaled to the viewport), and a "Recording" state is clear on the view. Playwright's recorder turns them into steps with role, label and text locators first (research, section 2). A phone can record too: taps are clicks, and a text field opens the phone's keyboard.
4. **Steps as you go.** Recorded steps appear in a list beside the view as they happen (typing merges into one `fill`). Each can be removed or edited before it lands.
5. **Tools.** **Check**: point at an element, pick what to check (visible, text, value, checked, count), and an `expect` step is added with the element's current text or value filled in. **Shot**: adds a `shot` step. **Note**, **Wait for**: the same, by pointing. New tabs and popups show as tabs on the view, as in runs.
6. **Done.** The steps go into the file at the cursor: YAML steps in a YAML test, `h` calls in a code test. Nothing is written until Done, and Cancel throws them away.
7. **A window instead.** When the server runs on a machine with a screen, "Record in a window" opens the recording browser headed on that machine instead of the live view, for people who'd rather click in a real browser. The steps still arrive on the page.

The `record` plugin owns record sessions, their actions (`record.start`, `record.input`, `record.check`, `record.stop`) and events (`record.step`, `record.step-updated`, `record.ended`). Frames go through the live hub as for a run. Recording uses Playwright's internal `_startRecording` (research, section 2); an engine test drives it in CI so a Playwright update that changes it fails there.

As built (PR 4): "New recording" on the pack page makes a YAML test with no steps and opens it in the editor with Record started. On a code test, Record from here runs the test until its first Playwright call below the cursor's line (a listener on Playwright's client instrumentation reads each call's stack), so code that doesn't touch the page may run a little further. Each recorded step also keeps the other targets that pick out the same element, switchable before Done, and a click can keep the spot clicked as `position` (for canvases and pickers). Check can also count the elements like the one picked.

## 5. The second pack: TodoMVC

`examples/todomvc/` in this repo: `pack.yaml` and YAML tests for the Playwright demo app (https://demo.playwright.dev/todomvc), about a dozen tests in three sections (adding, editing and completing, filters and counts), with `needs` between them, a rubric, and the built-in collectors. It is the example the docs use, and the starter pack (QoL step) gets a "YAML" choice that writes a small version of it. CI runs the same tests against a local copy of a todo app (served by the test), so CI doesn't depend on the internet.

## 6. Docs site

- Guide: "YAML tests" (format, targets, variables, a pack without code), "Editing a pack", "Recording".
- Reference: "YAML steps" with every step and its fields (a test checks each step in the schema has a section), "pack.yaml", and the new HTTP routes.
- The test packs guide links YAML and code side by side, and the TodoMVC pack is the example.

## 7. How step 4 is tested

- **Unit:** the YAML schema and loader (every step, targets, variables and masking, problems with positions, did-you-mean), YAML to code, the jsonl-to-step mapping, the files API (paths outside the pack, links out, binary and big files, stale saves), the Steps view's edits keeping comments.
- **Engine:** YAML tests run against the fixture site in Chromium (and Firefox where installed): pass, fail on `expect`, broken on a missing element, pause and retry after a saved fix, `needs`, `inside` with `child`, `use` with a pack helper, `pack.yaml` with `setup`. Recording: forwarded clicks and typing give the expected steps, Check gives an `expect`, Record from here runs the steps above the cursor first.
- **Web:** component tests for the Steps view, the target form and the record step list.
- **Screenshots** in light, dark and phone width for the editor, the Steps view, problems, Run this test, Record (live view with the step list, Check), and Convert to code, checked for spacing before they go in the PR.
- **On the PC:** Record in Firefox (the live view and the window), the TodoMVC pack against the real demo app, and editing a file while a run uses it. Only when no bench is running, on a spare port with a temporary data folder.

## 8. Pull requests within step 4

1. This plan and the research note.
2. YAML tests: schema, loader, steps, variables, `pack.yaml`, YAML to code, the TodoMVC pack, the YAML starter, docs.
3. The editor: files API, the Edit tab with CodeMirror, hints and problems, the Steps view, Run this test, docs.
4. Record: record sessions, input from the live view, the step list and tools, Record from here, the window option, docs.
5. Sign-off after the PC check.

Each PR ships with tests and, where the page changes, screenshots.

## 9. Answered questions

Dumi answered on 2026-10-27 by taking every recommendation:

1. Build the Steps view (section 3) in this step.
2. Record on the live view in the web page by default, with "Record in a window" as the option.
3. The second pack is the Playwright TodoMVC demo.
