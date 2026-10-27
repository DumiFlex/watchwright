# Research note: the step 1 engine

Status: written 2026-10-26, before building the engine. [docs/plan.md](../plan.md) has the design; this note records what was checked against the real libraries before writing code, and the decisions that came out of it.

## 1. What was checked

Each item was run in a scratch project with `playwright@1.64.1` and `esbuild@0.28` on Node 22, headless Chromium.

### Screencast

- `page.screencast.start({ onFrame, path, size, quality })` exists and returns a `Disposable`. **There is no `fps` option**, contrary to section 7 of the plan: the browser decides the frame rate (frames come when the page paints). The viewer shows the measured rate instead of a configured one.
- Frames are JPEG `Buffer`s with `timestamp`, `viewportWidth` and `viewportHeight`. On a mostly static page with a few clicks and a navigation: about 11 frames per second, 9.5 KB each at quality 70. A busy page gives more (the plan's earlier check measured 38 fps on an animated page).
- `stop()` then `start()` again on the same page works, so each attempt can get its own video file.
- A second page in the same context can run its own screencast at the same time. The live view can therefore follow popups and new tabs.
- `showActions()` and `showChapter()` draw into the frames and the video. `showOverlay(html)` returns a `Disposable` that removes it.
- **Video needs Playwright's own ffmpeg build** of the matching version. With a mismatched ffmpeg, `start({ path })` succeeds but `stop()` throws `ENOENT` on the temp file. A machine without the right ffmpeg must still be able to watch and run tests, so the engine treats video as optional: if video can't start or save, it logs a `video.unavailable` event and keeps the frames.

### Tracing

- `context.tracing.start({ snapshots: true, screenshots: false })` once per run, then `startChunk()` / `stopChunk({ path })` per attempt gives one small trace file per attempt (4 to 5 KB for a short attempt). Chunks without a `path` are discarded, which is how "keep traces only for broken and failed attempts" works: the engine decides the path after the outcome is known.

### expect outside the test runner

- `import { expect } from "playwright/test"` works without the Playwright test runner, including web-first assertions on locators (`toBeVisible`, `toHaveText`) with their auto-retry. No extra package is needed: `playwright` ships the `playwright/test` entry.
- A failed assertion throws an `Error` that carries a `matcherResult` property. That is how the engine tells a **failed** attempt (an assertion did not hold) from a **broken** one (anything else threw).

### Hot reload under ESM

- esbuild can bundle a pack (its `pack.ts` plus every test file matched by its `tests` globs) from a generated entry file, with TypeScript and the pack's own npm dependencies included.
- An `onResolve` hook maps the bare `watchwright` import (and `playwright`, `playwright/test`) to the running server's own module files as absolute `file://` URLs marked external. The bundle then registers its tests into the same module instance the engine reads, so `test(...)` calls at the top of a test file reach the engine.
- The metafile lists every input file, which gives the exact set of files to stamp for change detection, including helper files the tests import.
- The bundle is written into the data folder (`cache/packs/<pack id>/<build>.mjs`) and imported by file URL. A new build has a new file name, so Node's module cache never returns stale code.

## 2. Decisions

1. **Registration through a collector.** `pack()` and `test()` push into the collector of the build that is currently importing. Imports of builds are serialised, so two packs loading at once can't mix their tests.
2. **Outcome classification.** `passed` when the body returns and no finding-kind flag was raised; `failed` when an assertion threw (`matcherResult`) or a finding-kind flag was raised; `broken` for any other exception, a robot-kind flag or a timeout; `stopped` when "stop now" closed the context; `skipped` when the test was not run (a `need` broke, or a person pressed Skip before it started). Info-kind flags change nothing. A flag the pack didn't declare counts as a finding and logs a warning.
3. **Retries keep history.** Each execution of an attempt is its own row; the newest one for a (run, test, attempt number) is marked current. The API returns current attempts and can list the history.
4. **Pause points.** Every `h` helper call, every `h.step` and every attempt boundary calls the run's checkpoint. The test's time limit does not count time spent paused.
5. **Frames are not stored.** Only the newest frame per page is kept in memory, for viewers that join late. Viewers get binary WebSocket messages: a 4-byte big-endian header length, a JSON header (`runId`, `pageId`, `timestamp`, `width`, `height`), then the JPEG. A viewer whose socket has more than 1 MB queued skips frames until it drains.
6. **One browser per run, one context per run.** Attempts share the context so state carries from test to test, as the bench robot does today. "Stop now" closes the context.
7. **Plugins talk through typed services.** The `packs` plugin provides the pack registry, the `runs` plugin uses it, and the `live` plugin gets frames from the engine through the frame hub. A service is looked up by a typed key, so plugins don't import each other's internals.
8. **Actions are declared once.** Each action has a name (`runs.start`), an HTTP method and path, a JSON Schema for its input, and a handler. The server builds the Fastify route and its validation from that, and step 5 will build CLI commands and MCP tools from the same list.

## 3. What this note leaves to later steps

Firefox and WebKit screencast rates, and video on Windows, can't be checked in this sandbox (no Firefox build that matches 1.64 can be downloaded here). CI runs the engine tests in Chromium and Firefox on Ubuntu, and the last PR of step 1 checks Firefox on the PC, as the plan says.
