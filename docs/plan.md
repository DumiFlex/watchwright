# Step 1 plan: engine, store, live view, HTTP API

Status: done (2026-10-27). PRs 2 to 5 below landed together in one PR to `dev` (#14). Item 6 was checked on Windows with Firefox: the engine tests pass, and a live run saved its video, trace (with DOM snapshots) and screenshots. This is the plan for the first step of the build order. It turns the research into concrete pieces, names what is in and out of step 1, and lists the changes to the research design that came out of reading the bench robot's code again.

## 1. What step 1 delivers

At the end of step 1 a person can:

1. Start `watchwright serve` once. It stays up, opens its own SQLite store, and serves the web app and the API on `http://127.0.0.1:7420`.
2. Point it at a test pack folder (any site). The server lists the pack's tests, their metadata and parameters.
3. Start a run from the HTTP API or from a minimal "runs" page in the web app: pack, chosen tests, parameter values.
4. Watch it live: screencast frames over a WebSocket into a `<canvas>`, with the current test, step, log and queue.
5. Pause, resume, retry, skip, "stop after this test" and "stop now", from the page or the API. A test that breaks pauses the run and waits for Retry / Skip (with a time limit).
6. Fix a test file while the run is going: the next attempt uses the new code.
7. Kill the server mid-run, start it again, and resume the run where it stopped. Redo only the attempts that broke.
8. Read every result through the API: status, findings, flags, metrics, kept texts, screenshots, collector files, video and trace, in a versioned JSON shape.

Not in step 1 (each has its own step): the full web app (results, review, compare, export: step 2), the Wildcard pack (step 3), quality of life: adding packs without typing paths, remembered choices, notifications and more (the QoL step, after step 3, [docs/plans/step-qol.md](plans/step-qol.md)), YAML tests, editor, record (step 4, [docs/plans/step-4.md](plans/step-4.md)), CLI beyond `serve`, MCP, skill (step 5, [docs/plans/step-5.md](plans/step-5.md)), cost and budgets (step 6). The API is shaped for steps 2 and 5 from the start so they add no new engine concepts.

## 2. Changes to the research design

Reading `run.js`, `lib.js` and `tests.js` again with the design in mind, these are the places where I'd change or pin down the note. Each is reflected in the rest of this plan.

1. **One event log is the spine.** Today the live page polls `status.json`, and `results.json` is rewritten after each run. Instead, everything that happens (run queued, attempt started, step, log line, shot saved, flag, paused, resumed, finished) is one row in an append-only `events` table with a growing sequence number. The WebSocket streams it, the web app rebuilds state from it, the future CLI `wait` and MCP `wait_for_event` read "everything after cursor N" with a bounded wait, and resume after a crash reads it. One mechanism instead of four.
2. **Pause happens at step boundaries, and the page says so.** Playwright has no hook before each action, and a pause in the middle of `page.click` is not possible. So a pause request takes effect at the next boundary: every `h.*` helper call, every `h.step(title, fn)` and every attempt boundary. The live page shows "pausing at the next step" until it lands. "Stop now" doesn't wait: it closes the browser context, and the attempt is filed as `stopped`.
3. **Hot reload needs a bundler under ESM.** The robot reloads by clearing `require.cache`, which only works for CommonJS. Packs will be ESM and TypeScript. Before each attempt the engine checks the pack's file stamps; on a change it bundles the pack with esbuild into one file and imports it under a new URL. A pack that fails to build keeps the old code and logs why (same rule as today). This also gives TypeScript packs for free.
4. **Words: a run has attempts.** The note uses "run" for the whole thing and for one execution of one test (`run-1`, `run-2`). Plan vocabulary: a **run** is a pack + chosen tests + parameter values; an **attempt** is one execution of one test inside a run (`W1` with `runs: 3` makes attempts 1, 2, 3). A retry replaces an attempt's result but keeps the old one in history.
5. **Outcome is a closed set; flag kinds come from the pack.** The robot hard-codes `ROBOT_FLAGS`. Instead an attempt ends as `passed`, `failed` (an `expect` failed or the test reported a finding), `broken` (the harness or the test code went wrong: a `StepError`, a missing element, an exception), `skipped` or `stopped`. Flags are free strings that the pack declares with a kind: `flags: { "no-card": "robot", "fix-changed-nothing": "finding" }`. A robot-kind flag makes the attempt `broken`, which is what `redo` picks up.
6. **`inside` is explicit on both sides.** W4 runs in W3's panel because W3's body calls it. Keep that: the child declares `inside: "W3"`, and the parent calls `await t.child("W4")` where the child belongs. The engine uses `inside` to pull the parent in when only the child is chosen, to refuse to run the child alone, and to file the child's results under the child.
7. **`runs` names its parameter.** `runs: { q9: 3, haiku: 1 }` silently assumes "model". Use `runs: { by: "model", q9: 3, haiku: 1, default: 1 }`, or a plain number, or a function of the parameters.
8. **One active run per site, the rest queue.** The Wildcard pack changes global app state (the AI model, the library), so two runs against the same site would break each other. A pack names its site key; runs for the same key queue. A model matrix is a batch: several runs queued one after the other.
9. **Live view, video and trace come from the same screencast.** Playwright allows one screencast per page, and `screencast.start({ path, onFrame })` does video and frames in one call (one size and fps for both). Each attempt restarts it with a new video path. Traces use `tracing.startChunk` / `stopChunk` per attempt, DOM snapshots on and screenshots off (the screencast already has the pictures), kept by default only for `broken` and `failed` attempts, since a 40-minute trace is large.
10. **The live view follows the active page.** Tests open popups and new tabs. The engine starts a screencast on every page of the run's context and streams the one that last had an action or was last opened, with a tab strip in the viewer.
11. **Localhost is not enough on its own.** Any website open in the same browser can send requests to `127.0.0.1:7420`, and a DNS-rebinding page can even read the answers. The server checks the `Host` header on every request and the `Origin` header on every state-changing request and every WebSocket upgrade. Binding to a LAN address needs a token (later, see section 10).
12. **Resume is a property of the store, not a flag.** On boot, a run left `running` becomes `interrupted`. "Resume" continues it: attempts already `passed`/`failed` are kept, the rest run. "Redo broken" queues only `broken` attempts plus what they `need`. Both are API calls, not command-line flags.
13. **The results shape is versioned from day one.** Every result document carries `schemaVersion: 1`, so agents in step 5 can rely on it and later changes are additive.
14. **Built for expansion (Dumi, 2026-10-26).** Testing is the first capability, not the only one: scraping, crawling, monitoring and more of Playwright's features come later. So the core knows about browser sessions, jobs, events, artifacts and actions, and "a test" is one kind of job that a plugin adds. Section 3 has the details.

Things in the note I would keep as they are: the in-process engine on the Playwright library, the `h` helper split into a generic core and pack helpers, collectors, per-attempt folders on disk, Retry / Skip with a time limit, `needs` declared per test, and packs living in the repo of the site they test.

## 3. Built for expansion

Watchwright starts as a test harness, but the base has to take new capabilities (scraping, crawling, monitoring, visual diffs, accessibility checks, network mocking, anything else Playwright can do) without reworking what is there. Four rules make that work.

**1. Everything is a plugin, including what ships.** A plugin has a name and can bring store migrations, API routes, event types, actions, job kinds, `h` helpers, collectors and web app pages. The core only hosts plugins. The built-in pieces use the same contract (`core` now; `packs`, `runs`, `live` in step 1), so the seam is exercised from day one and a later plugin has nothing a built-in one lacks. The skeleton already has this: `definePlugin`, per-plugin migrations in the store (`schema_migrations` is keyed by plugin and id), and plugin routes mounted under `/api/v1`. Plugin-owned tables are named `<plugin>_…` (the core's are not prefixed).

**2. Layers, each unaware of the ones above it.**

| Layer | Knows about | Doesn't know about |
|---|---|---|
| Browser session | Playwright browser, context, pages, screencast, tracing, video | jobs, tests, packs |
| Job runner | queue, site locks, pause and stop, attempts, hot reload, events, artifacts | what a job kind does inside an attempt |
| Job kinds | `test` first (outcomes, `needs`, `inside`, `expect`); later `scrape`, `crawl`, `monitor` | the transport (HTTP, CLI, MCP) |
| Actions | named operations with JSON Schema input and output | which door called them |
| Doors | HTTP API, WebSocket, web app; CLI and MCP in step 5 | job internals |

A scrape job then reuses sessions, the live view, pause, the queue, the store and the doors as they are. It only adds what is new to it: a job kind whose attempts produce records instead of pass or fail, and a `datasets` table.

**3. One action registry feeds every door.** Each operation (start a run, pause, list packs, get results, later `scrape_page`) is declared once with a name, a JSON Schema for its input and output, and a handler. The HTTP route, the CLI command and the MCP tool are generated from that declaration. A new capability gets all three doors, with validation and docs, by declaring its actions. This is what keeps the project agent-first as it grows.

**4. Open sets, not closed enums, at the seams.** Event types are namespaced strings (`run.started`, `attempt.finished`, `scrape.record`), artifacts have a free `kind` with a content type, job kinds are registered by name, and the web app's navigation is built from what plugins add. Results carry `schemaVersion`. Adding something new never means editing a switch statement in the core.

What stays out of step 1: no plugin is loaded from outside the repo yet (third-party plugins need a trust story, like packs), and no capability other than testing is built. The seams above are built and tested; the features behind them come in their own steps, each with a research note first.

## 4. Repository layout

A pnpm workspace with two packages:

```
packages/
  watchwright/        the npm package: server, engine, store, CLI, pack API
    src/
      core/           plugin contract and host, the core plugin (health, live channel)
      cli/            `watchwright serve` (more commands in step 5)
      server/         Fastify app: plugin mounting, request guard, static web app
      store/          SQLite (better-sqlite3), per-plugin migrations, file layout
      session/        browser sessions: launch, pages, screencast, tracing, video   (step 1)
      jobs/           queue, site locks, attempts, pause control, hot reload        (step 1)
      actions/        the action registry and its HTTP mapping                       (step 1)
      plugins/        built-in plugins: packs, runs, live, and the `test` job kind  (step 1)
    test/             Vitest: unit tests and engine tests against a local fixture site
  web/                Vue 3 + Vite app, built into packages/watchwright/dist/web
docs/
```

Pack authors import from the one published package: `import { pack, test } from "watchwright"`.

Choices (proposed, easy to swap before the engine lands):

| Need | Choice | Why |
|---|---|---|
| Runtime | Node 22 or newer | Current LTS line; Playwright 1.64 and better-sqlite3 13 support it. |
| Language | TypeScript, strict, ESM | Same as the other projects. |
| HTTP + WebSocket | Fastify 5 + `@fastify/websocket` + `@fastify/static` | Small, typed routes, JSON schema validation for the API. |
| SQLite | `better-sqlite3` 13 | Mature, synchronous (simple transactions), prebuilt binaries for Windows. `node:sqlite` is still marked experimental. |
| Browser | `playwright` 1.64 (library) | Screencast with `onFrame` + `path`, `showActions`, `showChapter`, tracing chunks. |
| Pack bundling | esbuild | Hot reload under ESM, TypeScript packs. |
| Web | Vue 3.5, Vite 8 | Same as the other projects. |
| Tests | Vitest | Same runner for server and web. |

## 5. Pack and test API (step 1 subset)

```ts
// my-site/pack.ts
import { pack } from "watchwright";

export default pack({
  name: "My site smoke",
  site: { key: "my-site", baseURL: "http://127.0.0.1:3000/" },
  browser: { name: "firefox", viewport: { width: 1600, height: 960 } },
  params: { lang: { choices: ["en", "de"], default: "en" } },
  flags: { "no-card": "robot", "slow-answer": "finding" },
  tests: "./tests/**/*.ts",
  setup: async ({ page, h, params }) => { /* once per run, before the first test */ },
  collectors: [consoleErrors(), failedRequests(), responses({ match: "/api/" })],
});

// my-site/tests/home.ts
import { test } from "watchwright";

test("H1", { title: "Home loads", section: "H", runs: 2 }, async ({ h, expect }) => {
  await h.goto("/");
  await expect(h.page.getByRole("heading", { level: 1 })).toBeVisible();
  await h.shot("home");
});

test("H2", { title: "Search", needs: ["H1"] }, async ({ h }) => {
  await h.step("type a query", async () => { await h.fill("search", "boots"); });
  await h.keepText("results", "#results");
});
```

Test metadata: `title`, `section`, `tags`, `runs`, `needs` (test ids whose saved state this test uses), `inside` (parent test id), `timeout`.

The core `h` helper in step 1 (ported from `Bot`, minus the Wildcard parts): `goto`, `click` (with the `done` check and the Firefox "click landed but timed out" handling), `fill`, `press`, `has`, `step`, `idle` (generic: network quiet + optional app busy check from the pack), `shot`, `scrollShots`, `keepText`, `log`, `note`, `flag`, `metric`, `save`. The bench-specific ones (`panel`, `chat`, `applyCard`, AI in-flight tracking) move to the Wildcard pack in step 3, and the pack extends `h` with them.

## 6. Engine

**Lifecycle.** The server owns one `Engine`. `POST /runs` validates and inserts a `queued` run. The scheduler starts the oldest queued run whose site key is free. A run: build the pack, launch the browser (one per run), new context, run `setup`, then attempts in order.

**Order.** The test list is the pack's file order, then `needs` and `inside` pull in what's required (the same rules as the robot's `pickTests`, minus the hand-kept tables). Cycles and unknown ids are errors at pack load, shown on the pack page.

**An attempt.** Create the attempt folder, start the trace chunk and the screencast (with video path), run the body with `{ page, h, expect, params, attempt, last, child }`, classify the outcome, stop screencast and trace, run collectors' `flush`, write `result.json` and the attempt row, emit events. `last` is true on a test's final attempt (state later tests need is kept only then, as today).

**Pause control.** States: `running → pausing → paused → running`. Triggers: a person or agent presses Pause; or an attempt ends `broken` and the run has `pauseOnBroken` (default on). While paused: Retry (rerun this attempt), Skip (keep the broken result, go on), Resume (after a manual pause), Stop. A file change in the pack while paused after a break triggers Retry by itself (as today). No answer for `pauseLimit` minutes (default 20) means Skip.

**Hot reload.** Before each attempt: compare pack file stamps; on change, bundle and import; on failure, keep the old module and emit a `pack.reload_failed` event.

**Stop.** "After this test" finishes the current attempt (including `inside` children) and ends the run `stopped`. "Now" closes the context; the attempt is `stopped`.

**Crash and resume.** On boot, runs left `running`/`paused` become `interrupted`. `POST /runs/:id/resume` makes the run `queued` again with a pointer to where it was; the scheduler skips attempts already decided.

## 7. Live view

- **Capture.** `page.screencast.start({ onFrame, path, size, quality })` per page (there is no `fps` option; the browser decides the rate). Frames are JPEG `Buffer`s with `timestamp`, `viewportWidth`, `viewportHeight`. In a quick check in this sandbox (Chromium, 1280×800, quality 70) frames came at about 38 fps, 7.6 KB each, and kept flowing across a navigation. Firefox and WebKit cap at 25 fps per the docs. Firefox is the one that matters on the PC: test it there in the first engine PR.
- **Fan-out.** The server keeps the latest frame per page. Each viewer gets frames over its WebSocket as binary messages with a small header (page id, timestamp, size). Backpressure: if a viewer's socket buffer is over a limit, that viewer skips frames until it drains, and only ever gets the newest. No viewers, no forwarding (capture still runs for the video).
- **Annotations.** `showActions()` on by default (click points and action titles in the picture). `h.step` titles go through `showChapter` when the pack asks for it. Robot problems show as a red overlay banner via `showOverlay`.
- **Viewer.** A `<canvas>` that draws the newest frame, shows frame age and fps, and a tab strip when the run has more than one page. "Mark" (save the current frame with a note) is step 2.

## 8. Store

SQLite file `watchwright.db` in the data folder, WAL mode, migrations numbered `001_…` and recorded in `schema_migrations`.

All of these belong to built-in plugins and arrive through their migrations.

| Table | Holds |
|---|---|
| `packs` | id, path, name, site key, last load status and error |
| `runs` | id, pack id, chosen tests, params (JSON), status (`queued`, `running`, `pausing`, `paused`, `finished`, `stopped`, `interrupted`, `failed_to_start`), started by (`web`, `api`, an agent's name), times |
| `attempts` | id, run id, job kind (`test` for now), test id, attempt number, status, flags, metrics (JSON), times, error, folder |
| `artifacts` | id, attempt id, kind (open set: `shot`, `text`, `file`, `video`, `trace`, `collector`, …), content type, name, relative path, size, created |
| `events` | seq (autoincrement), time, run id, attempt id, type (namespaced string), payload (JSON) |

Files live next to the database, readable by people and agents without the API:

```
<data>/runs/<run id>/<test id>/attempt-<n>/
  01-home.png  results.txt  video.webm  trace.zip  result.json  collectors/…
```

Data folder: `--data <path>`, else `WATCHWRIGHT_DATA`, else `%LOCALAPPDATA%\Watchwright` on Windows, `~/Library/Application Support/Watchwright` on macOS, `$XDG_DATA_HOME/watchwright` (or `~/.local/share/watchwright`) on Linux.

## 9. HTTP and WebSocket API

All routes under `/api/v1`, generated from the action registry (section 3) except `/health`, `/files` and the WebSocket. JSON in and out. Success: `{ "data": … }`; error: `{ "error": { "code", "message", "detail"? } }`.

| Method and path | Does |
|---|---|
| `GET /health` | server up, version, data folder, loaded plugins and their schema versions |
| `GET /packs`, `POST /packs` (add by path), `GET /packs/:id` | packs, with tests, params, flag kinds, load errors |
| `POST /packs/:id/reload` | rebuild now |
| `GET /runs`, `POST /runs`, `GET /runs/:id` | list, start, one run with its attempts |
| `POST /runs/:id/pause`, `/resume`, `/retry`, `/skip`, `/stop?when=after\|now`, `/redo-broken` | control |
| `GET /runs/:id/attempts/:attemptId` | one attempt's result document (`schemaVersion: 1`) |
| `GET /files/*` | artifact files from the data folder only |
| `GET /events?after=<seq>&wait=<s>` | events after a cursor, waiting up to `wait` seconds (max 110) when there are none |
| `WS /live` | subscribe to events (JSON text messages) and frames for a run (binary messages) |

The WebSocket and `GET /events` share one event shape: `{ seq, time, type, runId?, attemptId?, data }`.

## 10. Safety

- Bind `127.0.0.1` only in step 1. `--host 0.0.0.0` is refused until token auth lands (a startup token printed once and kept in the data folder, sent as a bearer header or cookie).
- `Host` must be `127.0.0.1`, `localhost` or `[::1]` with the server's port. `Origin`, when present, must be the server's own origin on state-changing requests and WebSocket upgrades.
- Files are served from the data folder only, with path normalisation.
- Pack code is trusted code that runs on the machine (the README says so plainly). Packs come from folders the person adds.
- Collectors redact `Authorization`, `Cookie` and `Set-Cookie` headers before saving.

## 11. How step 1 is tested

- **Unit:** store migrations, event log cursor and bounded wait, test ordering (`needs`, `inside`, cycles), outcome classification, request guard.
- **Engine:** a tiny fixture site served by the test itself, and a fixture pack against it, run headless in Chromium and Firefox: attempts, pause and retry, hot reload, stop, crash and resume, artifacts on disk, frames arriving over the WebSocket.
- **CI:** GitHub Actions on Ubuntu and Windows: lint, typecheck, unit tests, build. Engine tests with browsers on Ubuntu first, Windows once they are stable.
- **On the PC:** a short run of the fixture pack in Firefox on Dumi's machine before step 1 is called done, with screenshots of the live page.

## 12. Pull requests within step 1

1. Skeleton (this PR): workspace, plugin contract, server with `/health` and the request guard, store with per-plugin migrations, web app shell, CI, docs.
2. Action registry with JSON Schema validation and HTTP mapping; event log, `GET /events` with bounded wait, WebSocket events.
3. Pack loading (esbuild), test metadata and ordering, `GET /packs`.
4. Browser sessions, then the job runner (queue, site locks, attempts, pause, stop, hot reload, resume, redo) and the `test` job kind (outcomes, `h` core, artifacts, collectors).
5. Live view: screencast capture, frame fan-out, viewer canvas, a minimal runs page to start and control a run.
6. Video and trace per attempt, Firefox check on the PC, step 1 sign-off.

Each PR ships with tests and, where the page changes, screenshots.

## 13. Answered questions

Dumi answered these on 2026-10-26:

1. Testing comes first. It must be complete and polished before any other capability is built, so step 1 builds only testing while keeping the plugin seams open.
2. The second pack (step 4) targets a public demo app, such as the Playwright TodoMVC demo.
3. Keep Fastify, better-sqlite3 and port 7420.
4. `watchwright serve` opens the web page on start; `--no-open` turns that off.
5. Thread work goes to the `dev` branch; `dev` merges to `main` only when everything works.
