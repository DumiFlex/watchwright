# Step 2 plan: the web app

Status: built. All eight PRs below are merged into `dev`; the Firefox sign-off run on Windows passed on 2026-10-27. [docs/plan.md](../plan.md) holds the base design from step 1 (plugins, engine, store, API), and this plan builds on it. Section 8 records the answers to the questions it raised.

## 1. What step 2 delivers

Step 1 left a working engine with one plain page: a pack list, a start form and a run page with the live view, the queue, a result panel and the log. Step 2 turns that into the app a person uses every day. At the end of step 2 a person can:

1. **Find their way.** A top bar with Runs, Packs and Compare, and pages with their own addresses, so a link to a run, an attempt or a comparison can be shared and reopened.
2. **Start a run** from a New run page: pick a pack, pick tests by section, tag or search (with what each choice pulls in shown before starting), set parameters, set attempts per test, and the run options (pause on broken, pause limit, trace, video).
3. **Watch a run live** on a reworked run page: the live view large, the current test and step, the queue (skip a test that hasn't started, move it up or down), the log with filters, the pause bar, and a **Mark** button that saves the current frame with a note.
4. **Read the results** of every attempt on its own page: screenshots in a gallery with a full-size viewer, scroll-shot sets as one tall strip, kept texts, flags (robot problems apart from findings), metrics, notes, collector records as a table, the video in a themed player, and the Playwright trace opened in the trace viewer served by Watchwright itself.
5. **Review** each attempt with the rubric the pack defines: scores and notes saved in the store, by person or agent.
6. **Compare** the same tests across runs side by side (a model matrix is several runs with different parameter values): status, metrics, scores, screenshots and texts per cell.
7. **Export** reviews as Markdown.
8. **Tidy up**: delete old runs and their files.

Every page action is an action in the registry (`docs/plan.md`, section 3), so agents get the same through the HTTP API now and the CLI and MCP in step 5. No page uses a browser default control (the kit in `packages/web/src/components/`).

Not in step 2: YAML tests, the editor and Record (step 4), the CLI beyond `serve` and MCP (step 5), costs (step 6), an AI judge (later), pixel diffs between screenshots (a later visual-diff capability).

## 2. What was checked

### The Playwright trace viewer can be served from our own origin

`playwright-core` ships the trace viewer as a static app (`lib/vite/traceViewer/`, 1.7 MB: `index.html`, a service worker `sw.bundle.js`, assets). Served under one path on a local HTTP server and opened as `index.html?trace=<url of trace.zip>`, it loaded a trace and showed the actions, the DOM snapshots before and after each action, the call log, console and network tabs (checked headless in Chromium with Playwright 1.64.1).

So "Open trace" needs no `npx playwright show-trace` process and no upload to trace.playwright.dev: the server serves the viewer from the installed `playwright-core` at `/api/v1/trace-viewer/` and the trace from `/api/v1/files/…`, both on the same origin, so the request guard holds as it is. The viewer opens in a new tab and keeps Playwright's own look; it is Playwright's tool, not part of our pages, so the themed-controls rule applies to the link that opens it, not to the viewer. The service worker needs a secure context, which `http://127.0.0.1` is in Chromium and Firefox. Firefox on the PC is checked in the PR that adds it.

### Video needs a themed player

A `<video controls>` element draws the browser's own controls, which the project rules out. The player is a `<video>` without `controls` plus kit pieces: play and pause, a seek bar (`RangeSlider`), time, speed (0.5× to 4×), frame step, full screen, keyboard keys (space, arrows, `,` `.`). WebM files written while recording sometimes report `duration` as `Infinity` until the end is read; the player handles that (seek far ahead once to make the browser find the end, then come back) instead of trusting `duration`. Playwright's ffmpeg build can't be downloaded in the sandbox where this note was written, so this is tested in CI (which installs it) and on the PC.

### Pages that load fast with large runs

A 40-minute bench attempt can have hundreds of screenshots and a long log. The attempt page loads images lazily, the gallery shows thumbnails from the same files at a fixed height (no thumbnail files are made), and the log and collector tables render only the rows on screen once they pass a few hundred. Run lists page by cursor (`before=<createdAt>`), not offset.

## 3. Pages

Routes stay hash based (`#/…`), since the server serves one `index.html` and hash routes need no server changes.

| Route | Page |
|---|---|
| `#/` | **Runs**: active runs first (live thumbnail, current test, pause state), then finished runs with filters (pack, status, started by, date) and counts. |
| `#/new` (`?pack=`) | **New run**: pack, tests, parameters, attempts per test, options. Shows the planned order before starting. |
| `#/runs/:id` | **Run**: live view while active; afterwards a results overview (tests × attempts grid with status, flags, scores). |
| `#/runs/:id/attempts/:attemptId` | **Attempt**: everything one attempt saved, its review, and next/previous attempt. |
| `#/packs`, `#/packs/:id` | **Packs**: add, reload, problems, tests with their metadata, parameters, flags and rubric. |
| `#/compare?runs=a,b,c` | **Compare**: tests down the side, runs across the top. |
| `#/kit` | The control kit (as today). |

At phone width the top bar folds into a menu button, grids become lists, and the live view sits above the queue.

## 4. Server work

All of it goes into plugins (`AGENTS.md`, Conventions). New actions, with their routes:

| Action | Route | Plugin |
|---|---|---|
| `runs.list` gains filters and a cursor | `GET /runs?pack=&status=&before=&limit=` | runs |
| `runs.delete` | `DELETE /runs/:id` (refused while active; removes rows and the run folder) | runs |
| `runs.queue-skip`, `runs.queue-move` | `POST /runs/:id/queue/skip`, `/queue/move` (only entries not started yet; `needs` still respected, a move that would break them is refused) | runs |
| `runs.mark` | `POST /runs/:id/mark` `{ note }`: saves the newest frame of the active page as a `mark` artifact on the running attempt, with the note | runs (frame from the `live` hub service) |
| `runs.start` gains `runs` (attempts per test, overrides the pack) and `trace`/`video` | `POST /runs` | runs |
| `reviews.get`, `reviews.put` | `GET/PUT /runs/:id/attempts/:attemptId/review` | reviews (new) |
| `reviews.list` | `GET /reviews?run=&pack=&test=` | reviews |
| `reviews.export` | `GET /runs/:id/export.md`, `GET /compare/export.md?runs=` | reviews |
| `runs.compare` | `GET /compare?runs=a,b,c` | reviews (reads runs through the `runs` service) |
| — | `GET /trace-viewer/*` (static, from `playwright-core`) | runs (a route, not an action) |

**Rubric in the pack.** `pack({ rubric: [...] })`, loaded and shown by the `packs` plugin. Each criterion is a 1 to 5 scale, named choices or yes/no (section 8):

```ts
rubric: [
  { id: "correct", title: "Correct", scale: 5 },                // 1 to 5
  { id: "follows", title: "Follows the request", scale: 5 },
  { id: "ui", title: "UI problems", choices: ["none", "minor", "major"] },
  { id: "usable", title: "Would use it", yesNo: true },
],
```

A pack without a rubric gets one criterion, `overall` (1 to 5), plus the note. A test can add or drop criteria with `review: { add: [...], drop: ["ui"] }` in its metadata.

**The `reviews` plugin.** Table `reviews` (id, run id, attempt id, test id, reviewer, scores JSON, note, created and updated times). One review per attempt per reviewer: the web app is `web`, an agent uses its client name (`x-watchwright-client`, as `startedBy` does today). Scores are checked against the rubric the attempt's run used (the rubric is copied into the run's plan when it starts, so a later rubric change doesn't break old reviews). Events: `review.saved`.

**Compare.** For a list of 2 to 6 runs of the same pack, the server lines up the current attempts by test id and attempt number and returns, per cell: status, flags, metrics, scores, the first screenshot of each name and the kept texts. Runs of different packs are refused with a clear error. The page lets you pick which screenshot name or text to show across the row.

**Export.** Markdown, one section per test, then per attempt: status, flags, metrics, the scores as a small table, the note, and links to screenshots. A run export and a compare export use the same writer. The zip export holds the same Markdown with its screenshots next to it, linked by relative paths.

**Storage.** `reviews` gets its own migration 1. `runs` gets migration 2 only if the queue edits need a column (they may fit in the existing `plan` JSON). Results keep `schemaVersion: 1`; new fields (marks, the review) are additive.

## 5. Web app work

- **Router** with the routes above and a `useRoute` composable; the current `parseRoute` grows into it, with tests for every route.
- **New components** for the kit (each shown at `#/kit`, themed for every look and mode): `TabBar`, `Dialog` (confirm and form dialogs, focus trapped), `Lightbox` (full-size image viewer with next/previous and zoom), `VideoPlayer`, `DataTable` (sorting, sticky header, rows rendered on screen only), `ScoreInput` (the 1 to 5 scale as themed buttons), `SearchField`, `Menu` (for the top bar at phone width).
- **Live run page**: viewer larger, the Mark button with a note dialog, queue actions (skip, move) on rows not started yet, log filters (level, test), elapsed time per test.
- **Attempt page**: sections in tabs (Shots, Texts, Log, Collectors, Video, Trace) with the review panel beside them on wide screens and below on phones. Keys: `j`/`k` next and previous attempt, `1`–`5` for the focused score.
- **Compare page**: run picker (pack first, then runs, with their parameter values shown so a model matrix reads well), the grid, a row detail drawer with screenshots side by side.
- Screenshots for every changed page in light, dark and phone width, for the Movement look, in each PR.

## 6. Docs site

`packages/site` gains guide pages for the web app (start, watch, review, compare, export) and reference pages for the new routes and the `rubric` pack field. Pages for things built later in step 2 carry `::: info Planned` until they land.

## 7. Pull requests within step 2

Each targets `dev`, with tests, docs and screenshots.

1. This plan.
2. Router, top bar, Runs page with filters and paging, Packs pages, run delete. New kit components it needs (`TabBar`, `Dialog`, `Menu`, `SearchField`).
3. New run page: test picking by section, tag and search, planned order preview, attempts per test, options.
4. Live run page: layout, queue skip and move, Mark, log filters.
5. Attempt page: gallery and `Lightbox`, scroll sets, texts, collectors in `DataTable`, `VideoPlayer`, the served trace viewer. Firefox check on the PC.
6. Reviews: `rubric` in the pack API, the `reviews` plugin, the review panel with `ScoreInput`, the run results grid with scores.
7. Compare and export.
8. Step 2 sign-off: a short run on the PC in Firefox, screenshots of every page, docs pass.

## 8. Answered questions

Dumi answered these on 2026-10-27:

1. **Rubric scoring:** the pack picks per criterion: a 1 to 5 scale, named choices, or yes/no. A pack without a rubric gets one `overall` criterion (1 to 5).
2. **What gets a review:** each attempt. Compare and export group reviews by test and show averages.
3. **Export:** Markdown, plus a zip of the Markdown and the screenshots it links.
