# Step 3 plan: the Wildcard Pipeline bench pack

Status: planned (2026-10-27). [docs/plan.md](../plan.md) holds the base design and [step-2.md](step-2.md) the web app. This step ports the bench robot into a Watchwright test pack, adds the few engine pieces the port shows are missing, and checks on the PC that the pack reproduces the robot's q9 runs.

## 1. What step 3 delivers

The bench robot (`scripts/bench-robot/` on the Wildcard Pipeline branch `claude/project-thread-fluwv9`: `run.js` 437 lines, `lib.js` 606, `tests.js` 673, `tests-meta.json` with 126 tests) clicks through the Wildcard Pipeline AI bench and saves screenshots, answer texts and the app's AI debug log for every run. At the end of step 3:

1. **The bench is a Watchwright pack** in the Wildcard Pipeline repo, `bench/`, next to the `data-test` ids it clicks (research note, section 5). Adding that folder in Watchwright's Packs page shows all 126 tests in 14 sections, with their prompts and what a good answer looks like.
2. **Starting a bench is a New run**: pick the model (q9, q35, q27, haiku, sonnet, opus, fable), optionally reset the library, include the web tests or not, pick sections or tests. Attempts per test follow the bench page's recommended runs for that model; Fable gets its subset.
3. **Everything the robot saved is in the attempt**: screenshots (panel, chat, page, scroll sets), answer texts, the AI debug log per call (Markdown and JSON, viewable in the attempt page), times as metrics (`Plan s`, `Build s`, `Fix s`, …), flags with the right kind.
4. **The robot's control flow maps onto the engine**: pause on a robot problem with Retry or Skip, hot reload of a fix, Stop, resume after a crash, redo broken (with what it needs). No hand-kept `NEEDS` table or `chain` field: tests declare `needs` and `inside`.
5. **Review** uses a bench rubric, and the model matrix is a Compare of the runs for each model.
6. **The pack is checked twice**: in the cloud sandbox against the real Wildcard Pipeline manager with a fake model (robot side only, every test), and on the PC against ComfyUI and LM Studio with q9 (a subset of every section, compared with the robot's last q9 results in `D:\wp-bench-runs\q9`).

Not in step 3: YAML tests, the editor, Record and a second pack (step 4), CLI and MCP (step 5), cost and budgets for cloud models (step 6). The pack only labels which model the app is set to; switching the app's model stays a manual step, as today.

## 2. What the port needs from Watchwright

The rule for this step (Dumi, 2026-10-27): Watchwright is a general tester that Wildcard Pipeline uses, not a tool built for it. Everything below is a general feature any pack can use, with no Wildcard names or rules in Watchwright. What is specific to Wildcard Pipeline (its `data-test` ids, its AI debug log, its backup API) stays in the pack.


Read side by side, most of the robot maps onto what step 1 and 2 built: `Bot.goto`/`click`/`fill`/`has`/`shot`/`scrollShots`/`keepText`/`note` are core `h` helpers, the pause loop is the engine's broken pause, `--resume` and `--redo` are actions, the live page is the run page. These parts don't map yet; each becomes a general feature, not a Wildcard special case.

| Robot | Gap | Watchwright change |
|---|---|---|
| `saveDebugs(before)` after each run: fetches the app's debug records made during the run and writes `debug-NN-<label>.md/.json` | Collectors only listen to browser events, and their records are filed under the top-level attempt | **Collector attempt hooks.** `beginAttempt(a)` and `endAttempt(a)` around every attempt (children too), with `a.page`, `a.record(entry)` and `a.file(name, data, type)`. Records a context listener collects while a child runs are filed under the child. |
| `t.as("W4", fn)`: the child runs inside the parent while `run <= child's runs` (P3 runs in P2's runs 1 and 2 of 3) | A child gets every attempt number its parent has | **A child's `runs` caps it.** `child(id)` in a parent attempt past the child's count does nothing and returns `"skipped"`. |
| `t.as("P12", fn, { once: true })` from any pack test: Fix all runs in the first pack whose check shows problems | `inside` names one parent | **`inside` takes a list.** Any listed parent can run the child; each child attempt number runs once, in whichever parent reaches it first. |
| A chained test whose parent never called it leaves no row | Nothing records that it didn't run | At the end of a run, a planned child attempt that never ran is filed `skipped` ("its parent didn't run it"). |
| `--runs 1` caps the recommended runs; tests with 0 runs for a model (the Fable subset, the optional web tests) are left out | The New run "attempts per test" override gives every test that many, including ones the pack set to 0 | The override no longer brings back a test the pack gave 0 attempts. |
| `t.img.sfw` / `--sfw`: reference images at a path on the PC | No way for a test to find files next to the pack, or to skip itself | **`packDir`** in the test and setup context, and **`h.skip(reason)`**: the attempt ends `skipped` with the reason. The image tests skip when `bench/images/sfw.png` (git-ignored) is missing. |
| `status.aiModel` ("lmstudio · qwen3.5-9b") at the top of the live page and in every `result.json` | A run can't carry facts it learns while running | **Run info.** `info(key, value)` in setup (and `h.info` in tests) saves a fact on the run, shown on the run page and in Compare and export column heads. |
| `tests-meta.json`: `where`, `steps`, `good` per test, read by a person scoring the answer | Tests have only a title | **`description`** in test metadata, shown on the attempt page above the review and in the pack's test list. |
| `--model q9` with the model's display name in the live page | A param's choices are bare values | **Choice labels.** `params.model.labels = { q9: "Qwen3.5 9B", … }`, shown in the New run select. |
| `debug-NN-*.md` files open in the live page | Other files are links in the summary | A **Files** tab on the attempt page shows text files (Markdown, JSON, text) in the code view. |

Two more come from the robot's own suggestion list (`/mnt/project-files` note, 2026-10-27), as general seams the pack fills in:

- **Attempt hooks.** `beforeAttempt` and `afterAttempt` in the pack, given the test's id and tags. The bench backs up the library before tests tagged `changes-library` and restores it after (suggestion 4).
- **`h.waitUntil(check, { progress, stallMs })`.** A wait that ends as `stalled` when the app stops making progress. The bench's AI wait uses it to file a `model-loop` finding instead of waiting 30 minutes (suggestion 6).

Also fixed while here: when the engine replaces a stuck browser context, collectors attach to the new context too (today they stay on the closed one).

## 3. Five general features from the robot's suggestions

Dumi chose (2026-10-27) to build these in step 3 as well. None of them is about Wildcard Pipeline:

1. **Add tests to a running run.** "Add tests" on the run page appends attempts to the queue (with what they need). Action `runs.queue-add`.
2. **Scrub back the live view.** The server keeps the last 30 seconds of frames per run; a scrubber under the live view shows any of them, with "back to live".
3. **Step timeline on the attempt page.** Each `h.step` and each helper call that took long (slow or forced clicks, long waits) with its start and length, as a timeline next to the video; a click seeks the video.
4. **Add to review from a shot.** "Add to review" on a screenshot puts a link to it in the attempt's review note.
5. **Compare with the last run.** On a run page, the tests whose status, flags, scores or metrics changed since the previous finished run of the same pack and params.

## 3b. The pack

```
bench/
  pack.ts             name, site, browser, params, flags, rubric, setup, collectors, helpers
  bench.ts            the h.* helpers ported from Bot (panel, chat, applyCard, aiIdle, …)
  shapes.ts           make, describe, edit, chat, organize, packBuilder (the shared test shapes)
  meta.ts             the 126 tests: title, section, prompt, where, steps, good, recommended runs
  tests/
    s-connection.ts   one file per section, each a list of test(...) calls
    w-wildcards.ts …  z-nsfw.ts, n-web.ts
  bench-library.json  the fixture library a reset imports
  images/README.md    where to put the SFW and NSFW reference images (git-ignored)
  README.md
```

- **Params.** `model` (choices q9 … fable, labelled, default q9), `reset` (back up, empty and import the fixture library; default off), `web` (the optional N tests; default off). Attempts per test: `runs: (p) => rec[p.model]`, 0 for N tests unless `web`, so the New run page shows the real plan.
- **Site and browser.** `site: { key: "wildcard-pipeline", baseURL: "http://127.0.0.1:8189/wp/" }`, Firefox, 1600×960, dark color scheme, the `wp-ai-debug` local storage switch set before each page loads, dialogs accepted.
- **Setup.** Reads the AI settings (refuses to start when the assistant is off), saves `AI model` as run info, resets the library when asked, turns "allow delete" and "auto apply" off, and warms the model up with two connection tests (the first loads it).
- **Helpers.** `h.panel`, `h.chat`, `h.chatShot`, `h.pageShots`, `h.applyCard`, `h.undoCard`, `h.answerAsk`, `h.choose`, `h.attach`, `h.api`, `h.aiConfig`, `h.setAiConfig`, `h.idOf`, `h.open`, `h.save` → `h.saveItem` (the core `save` keeps state), `h.aiIdle` (the robot's `idle`: AI requests in flight, the working marks, the "expect AI work after this click" wait). Request tracking hangs off the browser context, so it survives a hot reload and a replaced context.
- **The AI debug collector** (`aiDebug()`): `beginAttempt` notes the debug ids that exist, `endAttempt` saves each new record as `debug-NN-<label>.md` and `.json` files, records one row per call (route, label, seconds, calls, failed, tokens) and sets the metrics `AI calls` and `AI s`.
- **Flags.** Robot: `robot-step` is gone (a `StepError` already makes the attempt broken), `not-saved`, `no-card`. Findings: `deleted-while-off`, `fix-changed-nothing`, `problem-fix-did-nothing`, `build-blocked`. Info: `forced-click`, `research-skipped`, `dismissed-findings`. The robot counted `deleted-while-off` as a robot problem so `--redo` reran it; it is the app deleting an item while deleting is off, so it is a finding here.
- **Times** become metrics in seconds (`Plan s`, `Review s`, `Build s`, `Fix s`, `Change s`, `seconds`), so Compare and export show them per model.
- **Children.** W4 inside W3, W21 inside W20, C12 inside C1, P3 to P5 inside P2, P12 inside every pack-builder test (the first with check problems runs it). W21 runs only on W20's last attempt, as today: W20's body calls `child("W21")` only when `last`.
- **Rubric** (the reviewer's lens from the research note): Correct (1 to 5), Follows the request (1 to 5), Quality (1 to 5), UI problems (none, minor, major). Tests without an answer to judge (S1, the delete tests) drop what doesn't apply.

**Type checking.** Watchwright isn't on npm yet, so the Wildcard Pipeline repo can't install it to type-check `bench/`. Until it is, `bench/` is left out of that repo's ESLint and `tsc` runs, Watchwright type-checks it when it loads the pack (esbuild reports syntax errors, the run reports runtime ones), and the PR that adds it is type-checked against the Watchwright checkout by hand. Once Watchwright is published, `bench/` gets its own `package.json` with `watchwright` as a dev dependency and a CI job.

## 4. How it is checked

- **Watchwright unit and engine tests** for every change in section 2 (collector hooks with a child attempt, child caps, multi-parent children, unrun children, the override, `h.skip`, run info, `packDir`, choice labels, collectors after a context reset).
- **The sandbox dry run.** The Wildcard Pipeline API mounts on a plain aiohttp app (`wp_api.register_routes`, as its eval scripts do), so a small script serves the built manager and the API on a free port with an empty data folder, plus a fake OpenAI-style model that answers every AI route with a canned reply. The whole pack runs against it in Chromium (no Firefox in the sandbox). That proves the robot side (every page opens, every button exists, saves land, collectors write) but not answer quality. The script stays in `bench/dev/` for anyone without a GPU.
- **On the PC** (Firefox, ComfyUI and LM Studio on q9, through a Remote Control session, only when no bench is running): a short run with one or two tests from every section, then the same tests compared with the robot's last results in `D:\wp-bench-runs\q9`: the same steps reached, the same files saved, no new robot problems. The full q9 bench (hours) is Dumi's to start from the New run page when it suits.

## 5. Pull requests

1. This plan (Watchwright).
2. Watchwright: attempt hooks, `waitUntil`, collector attempt hooks, child caps, multi-parent `inside`, unrun children, the override fix, `packDir`, `h.skip`, run info, `description`, choice labels, the Files tab, collectors after a context reset. Tests, docs site pages, screenshots.
3. Watchwright: the five features of section 3, with screenshots.
4. Wildcard Pipeline: the `bench/` pack, the dev server with the fake model, README; `bench/` left out of the app's lint, type check and release zip. The old `scripts/bench-robot/` stays on its branch; it isn't merged.
5. Step 3 sign-off: the PC run, fixes it finds (in either repo), screenshots of a bench run in Watchwright, this plan marked done.

## 6. Choices made without asking

These follow the research note or the robot; say if any should change.

1. The pack lives in the Wildcard Pipeline repo (`bench/`), as the research note decided, not in the Watchwright repo.
2. Firefox, like the step 1 and 2 sign-offs on the PC (the robot's default was Chromium or Edge).
3. The rubric in section 3.
4. `deleted-while-off` is a finding, not a robot problem.
