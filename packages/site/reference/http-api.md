# HTTP and WebSocket API

Everything the web page does goes through this API, so scripts and AI agents can do the same. All routes are under `http://127.0.0.1:7420/api/v1`.

- JSON in and out. Success is `{ "data": … }`. Failure is `{ "error": { "code", "message", "detail"? } }` with a snake_case `code` and a matching HTTP status.
- Requests must pass the [request guard](../guide/safety#who-can-reach-the-server): a loopback `Host` with the server's port, and for changes no `Origin` header or the server's own (scripts and agents send none).
- Send `x-watchwright-client: <name>` to be named as who started a run (default `api`).
- `GET /actions` lists every action with its JSON Schema input. The CLI and MCP server in a later step are built from the same list.

## Server

| Method and path | Does |
|---|---|
| `GET /health` | Whether the server is up, its version, its data folder and the loaded plugins with the newest store migration each one applied. |
| `GET /actions` | Every action with its method, path and JSON Schema input. |
| `POST /stop` | Stops the server, as Ctrl+C in its terminal does. It answers `{ stopping: true }` first. Runs going at the time become `interrupted` and can be resumed after it starts again. 409 `cant_stop` for a server that wasn't started by the `watchwright` command. |

## Packs

| Method and path | Does |
|---|---|
| `GET /packs` | Every pack with its tests (each with its `file`, `line` (where a YAML test starts in its file; null for code), `description`, `inside` (a list, empty for top-level tests) and the `rubric` it is scored on), params, flag kinds, the pack's own `rubric`, run settings (`run`: `pauseOnBroken`, `pauseLimitMinutes`, `trace`, `video`, defaults filled in) and load errors. |
| `POST /packs` `{ path }` | Adds a pack by its absolute folder (or pack file) path and loads it. Quotes around the path (Windows' "Copy as path"), `file://` addresses, `~` and either slash are accepted. A pack that doesn't load is still added, with its error. Adding the same folder again returns the pack already added. |
| `GET /packs/:id` | One pack. Every pack carries `path` (its pack file), `dir` (its folder) and `missing` (true when the pack file is gone). |
| `POST /packs/create` `{ path, name, baseURL, format? }` | Writes a starter pack into a folder, made when missing, and adds it: `pack.ts`, `tests/home.ts` and `README.md`, or with `format: "yaml"`, `pack.yaml`, `tests/home.yaml` and `README.md`. 201 with the pack. 400 `bad_starter` when the folder already has a pack or one of those files, or the address isn't `http(s)://`. |
| `POST /packs/:id/reload` | Builds it again now. |
| `GET /packs/yaml-schema?kind=test\|pack` | The JSON Schema of [YAML test files](../guide/yaml-tests) (`test`, the default) or of `pack.yaml` (`pack`). |
| `POST /packs/check-yaml` `{ text, kind? }` | Checks YAML text without saving it: a test file (`kind: "test"`, the default) or `pack.yaml` (`"pack"`). Returns `{ problems }`, each with `message`, `line`, `col` and the `from` and `to` offsets of the part it is about, and for a test file `tests: [{ id, line, steps }]`. |
| `POST /packs/:id/convert` `{ file }` | Writes the YAML test file `file` (relative to the pack folder) as a TypeScript file beside it, and removes the YAML file once the pack loads with the new one. Returns `{ file, pack }`. 400 `bad_pack` when the YAML has problems, the `.ts` file exists, or the new file doesn't load (the YAML file is put back). |
| `POST /packs/:id/move` `{ path }` | Points a pack whose folder moved at its new folder. It keeps its id and runs. 400 `bad_pack` when the folder has no pack file or another pack already uses it. |
| `POST /packs/discover` `{ path, depth? }` | Finds pack files in a folder and up to `depth` (default 4, at most 8) levels below it, skipping `node_modules`, `dist`, `build` and hidden folders, and not looking inside a pack. Returns `{ root, found: [{ dir, packFile, packId }], truncated }`; `packId` is set for packs already added. |
| `DELETE /packs/:id` | Forgets the pack (its files and past runs stay). |

## Editing files

The files of a pack's folder, as the [editor](../guide/editing) uses them. `path` is relative to the pack folder, with `/` between folders. A path outside the folder (`..`, an absolute path, a link that leads out) or inside `node_modules`, `.git`, `dist` and other build or tool folders is 400 `bad_path`. Only text files up to 1 MB are read or written: 400 `not_text` for others, 413 `too_big` over the size.

Every change returns the pack's state after it loads again, `pack: { status, error, problems }`, and adds an `editor.file_changed` event `{ packId, action, path }` (`action` is `save`, `create`, `rename` with `from`, or `delete`).

| Method and path | Does |
|---|---|
| `GET /packs/:id/files` | The pack's files: `{ files: [{ path, kind, size, big }], truncated }`, folders first. `kind` is `code`, `yaml`, `json`, `markdown` or `text`; `big` means too big to open. At most 2000 files. |
| `GET /packs/:id/file?path=` | One file: `{ path, kind, text, stamp }`. `stamp` names this version of the file. |
| `POST /packs/:id/file` `{ path, text, stamp? }` | Saves a file, written whole or not at all. With `stamp`, 409 `stale` when the file changed since that version, with the file on disk in `detail: { text, stamp }`; leave `stamp` out to overwrite. Returns `{ file: { path, stamp }, pack }`. |
| `POST /packs/:id/files` `{ path, text? }` | Makes a new file and its folders. 201 with `{ file, pack }`, 409 `exists` when it's already there. |
| `POST /packs/:id/file/rename` `{ from, to }` | Renames or moves a file inside the pack folder. Returns `{ from, to, pack }`; 409 `exists` when `to` is taken. |
| `DELETE /packs/:id/file?path=` | Deletes a file. Returns `{ deleted, pack }`. |
| `GET /packs/:id/image?path=` | An image file from the pack folder (`.png`, `.jpg`, `.gif`, `.webp`, `.avif`, `.svg`, `.bmp`, `.ico`, up to 20 MB), sent as the image itself, not JSON, for Markdown previews. The same path rules apply; other files are 400 `not_text`. SVG is sent with a sandboxing `Content-Security-Policy`, so its scripts never run. |

## Recording

[Recording](../guide/recording) opens a browser for a pack and turns what is done on its page into YAML steps. A recording has an 8-character id. Its events carry that id as `runId`, and its screencast goes through the [live WebSocket](#live-websocket) the same way, so a viewer subscribes to a recording as to a run. A recording holds its pack's site: runs of the site wait for it, and it waits (status `waiting`) for a run of the site to end. It ends by itself after 30 minutes without input.

A recording's state is `{ id, packId, testId, status, message, window, viewport, pages, activePage, steps }`. `status` is `waiting`, `starting`, `replaying` (running the steps before the cursor), `recording` or `ended`. Each step is `{ id, name, args, targets, spot }`: `args` are the YAML step's fields, `targets` every target that picks out the same element (the one in use first), and `spot` where a click landed inside the element, for `position`.

| Method and path | Does |
|---|---|
| `GET /record` | `{ canWindow, recordings }`. `canWindow` says whether this machine has a screen for `window: true`. |
| `POST /record` `{ packId, testId?, replay?, line?, url?, params?, window? }` | Starts a recording (201, its state). With `testId`, the pack's `beforeEach` runs first; with `replay`, also that YAML test's first `replay` steps; with `line`, also that code test's code up to that line (it stops at the first Playwright call below it). `url` is where to open (the site's base URL by default), `params` the parameter values for those steps. 400 `bad_test`, `bad_params`, `no_window`. |
| `GET /record/:id` | The recording's state. |
| `POST /record/:id/input` `{ type, … }` | Input for the active page, in page pixels: `click`, `dblclick`, `down`, `up` (`x`, `y`, `button?`, `clickCount?`), `move` (`x`, `y`), `wheel` (`x`, `y`, `deltaX`, `deltaY`), `key` (`key` in Playwright's form, `Shift+Tab`), `text` (`text`, typed into the focused field), `goto` (`url`), `back`, `reload`. A `move`, `up` or `wheel` answers with `hover`: the element now under the pointer (`box` in page pixels, `tag`, and its best `target`, not checked on the page), or null. 409 `not_recording` before recording starts or after it ends. |
| `POST /record/:id/pick` `{ x, y }` | The element at a point: `{ info, targets, groups }`. `info` has its `tag`, `text`, `value` and `checked`; `targets` pick out only it, best first; `groups` are targets it shares with elements like it, with their `count`. 404 `nothing_there`. |
| `POST /record/:id/page` `{ pageId }` | Makes one of `pages` the active page. |
| `POST /record/:id/steps` `{ name, args?, targets?, index? }` | Adds a step (201), at the end or at `index`. `targets` are other targets to offer for it. 400 `bad_step`. |
| `POST /record/:id/steps/:step` `{ name?, args? }` | Changes a step. A new `args.target` is added to its `targets`. |
| `DELETE /record/:id/steps/:step` | Removes a step. |
| `POST /record/:id/stop` | Ends the recording and closes its browser. Returns the state with the steps. |

Events: `record.started`, `record.status` `{ status, message }`, `record.replay-step` `{ title }`, `record.step` `{ step, index }`, `record.step-updated` `{ step }`, `record.step-removed` `{ id }`, `record.ended` `{ message, steps }` (`steps` is how many), and the `page.*` events of its pages.

## Settings

Preferences for the whole machine, the same for every browser and agent. Plugins declare them; the web app's Settings page edits them. The look and mode stay in each browser.

| Method and path | Does |
|---|---|
| `GET /settings` | `{ values, definitions }`: every setting's value (its default when never changed) and, for each, `key`, `title`, the JSON Schema of its value and its `default`. |
| `POST /settings` `{ values }` | Changes several settings at once, all or none; `null` puts one back to its default. Returns `{ values }`. 400 `unknown_setting` or `invalid_setting`. |

The settings so far:

- `settings.editor`: the editor that file links open in (`vscode`, `cursor`, `windsurf`, `idea`, `webstorm` or `none`; default `vscode`).
- `runs.newRunFrom`: what the New run page fills in when it opens: `latest` (the pack's latest run, the default) or `defaults` (the pack's defaults).

## Folders

A web page can't learn a folder's path from the browser, so the server lists folders on its machine for the web app's folder browser. It lists folder names and the marker files plugins ask about (a pack file), never other files or what's in them.

| Route | Does |
|---|---|
| `GET /folders?path=…&hidden=` | The folders inside a folder: `{ path, parent, sep, marks, folders: [{ name, path, marks }], truncated }`. `marks` says which markers a folder has, such as `{ "pack": "pack.ts" }`. Hidden and system folders and `node_modules` are left out unless `hidden=true`. At most 1000 folders. 404 `not_found`, 400 `not_a_folder` or `bad_path` (a relative path). |
| `GET /folders/places` | Where to start: `home`, `roots` (the drives on Windows, `/` elsewhere) and `recent`, the last ten folders packs were added or moved from (`{ path, usedAt, exists }`). |
| `DELETE /folders/recent?path=` | Forgets one recent folder, or all of them without `path`. |
| `POST /folders/open` `{ path }` | Shows a folder in Explorer, Finder or the desktop's file manager. Only pack folders (and the folders inside them) and the data folder; 403 `not_allowed` for anything else. |

## Runs

| Method and path | Does |
|---|---|
| `GET /runs?limit=&pack=&status=&before=&q=` | Runs, newest first, with counts. `pack` keeps one pack's runs, `status` a comma-separated list of statuses (`finished,stopped`). `q` searches: each word must appear in the run's id, label, pack name, values, facts or status, and a `name=value` word matches a value exactly (`lang=de`). For the next page, pass the `createdAt` of the last run as `before`. |
| `POST /runs` `{ packId, tests?, params?, pauseOnBroken?, pauseLimitMinutes?, attempts?, trace?, video?, label?, preset? }` | Queues a run. `tests` defaults to all; tests they need, and parents and children, join by themselves. `attempts` gives every test the same number of attempts instead of its own `runs`; `trace` (`problems`, `always`, `never`) and `video` override the pack's settings for this run. `label` names the run (up to 120 characters). `preset` starts from the pack's preset with that name; the other fields given override it (404 when the pack has no such preset). |
| `POST /runs/:id/again` | Queues a new run with the run's pack, tests, values, options and label (201). Queue edits made during the run aren't copied. |
| `POST /runs/:id/label` `{ label }` | Names a run; an empty label takes the name away. Runs carry `label` (empty when none). |
| `POST /runs/preview` (same body) | Plans the run without starting it: `plan` (every attempt in order), `attempts`, the resolved `params`, and `joined`: tests that run although they weren't chosen, with the reason (`needed`, `parent`, `inside`) and the tests that brought them in. |
| `GET /runs/:id?history=` | The run, its plan (every planned attempt with its status), current attempts, and `live` (state, current test and step, pages) while it runs. `info` holds the facts the run saved with `info(key, value)`. `history=true` adds earlier tries of retried attempts. |
| `GET /runs/:id/attempts/:attemptId` | One attempt's result document (`schemaVersion: 1`): status, error, flags, metrics, notes, kept texts, log, `steps` (`{ title, depth, startedAt, finishedAt, status }` for each `h.step`), artifacts with URLs. Shots from one `h.scrollShots` call carry the call's name as `set`. |
| `GET /runs/stats?days=&pack=&tz=&until=` | Runs at a glance: `days` (one entry per day, oldest first, `days` of them, default 14, at most 90) with `{ date, runs, passed, failed, broken, skipped, stopped, medianMs }`, and the same totals for the period (`current`) and the `days` days before it (`previous`). Runs count on the day they were made, attempts on the day they started; only top-level attempts that finished count, and `medianMs` is the median time of the passed and failed ones. `tz` is the caller's `Date.getTimezoneOffset()` (minutes behind UTC), so days are the caller's calendar days; `until` (YYYY-MM-DD) is the last day, today by default. `pack` keeps one pack's runs. |
| `GET /packs/:id/history?limit=` | Each test's last `limit` (default 20, at most 100) finished attempts across the pack's runs, oldest first, keyed by test id: `{ attemptId, runId, runLabel, number, try, status, startedAt, durationMs, params }`. Only the try that counts is listed; `try` above 1 means it was run again after it broke. `{}` for a pack with no runs. |
| `DELETE /runs/:id` | Deletes a run that isn't queued or going, with its attempts and its folder in the data folder. Its events stay in the event log. |
| `POST /runs/:id/pause` | Pauses at the next step. |
| `POST /runs/:id/resume` | Resumes a manual pause. For an `interrupted`, `stopped` or `failed_to_start` run, queues it to continue: passed, failed and skipped attempts are kept, the rest run. |
| `POST /runs/:id/retry`, `/skip` | Answers a pause on a broken attempt. |
| `POST /runs/:id/stop` `{ when: "after" \| "now" }` | `after` finishes the current test first; `now` ends at once and files the current attempt as `stopped`. A queued run is cancelled. |
| `POST /runs/:id/queue/skip` `{ testId, number?, undo? }` | Skips attempt `number` (default 1) of a test that hasn't started yet; `undo: true` takes the skip back. A skipped attempt is filed as `skipped` when its turn comes. The plan marks it with `skip: true`. |
| `POST /runs/:id/queue/move` `{ testId, direction: "up" \| "down" }` | Moves a test that hasn't started one place up or down, past the next test that hasn't started. Refused (400) when a test would run before a test it needs. Children move with their parent. |
| `POST /runs/:id/queue/add` `{ tests }` | Adds tests to a run that is going. They go at the end of the queue in the pack's order, with the tests they need that the run doesn't have yet. The pack is read again first, so a test written since the run started can be added. 400 when every test is already in the run, 409 once the run has gone through its queue. Emits `run.tests-added`. |
| `POST /runs/:id/mark` `{ note?, pageId?, at? }` | Saves the live view's newest frame (or, with `at`, the [rewind](#rewind) frame of `pageId` at that time) to the running attempt as a `mark` artifact named by the note, and adds the note to the attempt. Returns `{ attemptId, artifact }` (201). 409 `no_frame` before the first frame arrives. |
| `POST /runs/:id/redo-broken` | Runs only the broken attempts of a finished run again, with the tests they need. |
| `GET /files/runs/…` | Artifact files (the `url` in result documents). Only files inside the data folder's `runs/`. Answers `Range` requests (206), so videos can seek. |
| `GET /trace-viewer/index.html?trace=<url>` | Playwright's trace viewer, served from the installed `playwright-core`. Pass the full URL of an attempt's `trace` artifact; the viewer opens it without uploading it anywhere. |

## Presets

Named run choices, kept per pack: tests, values and options, the same fields as `POST /runs` takes.

| Method and path | Does |
|---|---|
| `GET /presets?pack=` | Presets, by pack and name: `{ id, packId, name, choices, createdAt, updatedAt }`. |
| `POST /presets` `{ packId, name, tests?, params?, pauseOnBroken?, pauseLimitMinutes?, attempts?, trace?, video? }` | Saves choices under a name (201). Saving a name the pack already has replaces that preset's choices. |
| `POST /presets/:id` `{ name }` | Renames a preset. 409 `conflict` when the pack has another preset with that name. |
| `DELETE /presets/:id` | Deletes a preset. |

## Reviews

A review is one reviewer's scores and note for one attempt. The reviewer is the client's name (`x-watchwright-client`, default `api`; the web page is `web`), so a person and an agent can each review the same attempt. A criterion is `{ id, title, description, kind }` with `kind` `scale` (and `scale`, the top score), `choices` (and `choices`) or `yesNo`.

| Method and path | Does |
|---|---|
| `GET /runs/:id/attempts/:attemptId/review` | `{ criteria, reviews }`: what the attempt's test is scored on, and every review of the attempt. |
| `POST /runs/:id/attempts/:attemptId/review` `{ scores?, note? }` | Saves the caller's review. `scores` maps criterion ids to a whole number on a scale, a choice's name, or `true`/`false`; `null` clears one, and criteria left out keep their score. `note` replaces the note when given. 400 `bad_score` for an unknown criterion or a score that doesn't fit it. |
| `GET /runs/:id/rubric` | The criteria for every test in the run, by test id. A run keeps the rubric its pack had when it started, so later changes to the pack don't change it. |
| `GET /reviews?run=&pack=&test=&reviewer=` | Reviews matching every filter given. |

Deleting a run deletes its reviews.

## Compare and export

| Method and path | Does |
|---|---|
| `GET /compare?runs=a,b,c` | Lines up one to six runs of the same pack: `runs` (id, params, status, counts), `criteria` by test, `rows` (one per test and attempt number, with one cell per run: status, duration, error, flags, metrics, notes, kept texts, screenshots, reviews and `score`, the mean of the scale scores on 1 to 5), and the `shotNames` and `textNames` found. Only current attempts count. 400 `mixed_packs` for runs of different packs. |
| `GET /runs/:id/changes?against=` | What changed in a run since `against`, or (without it) since the newest earlier finished, stopped or interrupted run of the same pack with the same params. `{ previous, rows, same }`: each row is a test and attempt number with `before` and `after` (`{ runId, attemptId, status, durationMs, score, flags }`, null when that run didn't have it) and `changes` from `status`, `flags`, `score` (moved by 0.5 or more), `time` (half again as long or short, and at least 2 s apart), `new` and `gone`. `same` counts the attempts that didn't change. `previous` is null when there is no earlier run. |
| `GET /export?runs=a,b` | `{ name, markdown }`: the same runs as Markdown, one section per test, then per attempt: status, flags, metrics, the scores as a table, the reviewers' notes and links to the screenshots. |
| `GET /export.md?runs=a,b` | The Markdown as a file to download, with screenshot links to this server. |
| `GET /export.zip?runs=a,b` | A zip of the Markdown and its screenshots (`shots/<run>/<attempt>/…`), linked by relative paths, so it reads anywhere. |

Run statuses: `queued`, `running`, `pausing`, `paused`, `finished`, `stopped`, `interrupted` (the server stopped mid-run), `failed_to_start`. Attempt statuses: `passed`, `failed`, `broken`, `skipped`, `stopped`, plus `running` and `interrupted`.

## Events

Everything that happens is an event with a growing sequence number: `{ seq, time, type, runId?, attemptId?, data }`.

`GET /events?after=<seq>&wait=<seconds>&runId=&types=&limit=` returns `{ events, next, head }`. With `wait` (up to 110 seconds) it holds the request until a matching event arrives, so an agent can follow a run with one request at a time: call again with `after=next`.

Event types (open set, more come with later plugins): `run.queued`, `run.started`, `run.planned`, `run.pausing`, `run.paused`, `run.resumed`, `run.decision`, `run.stopping`, `run.labeled`, `run.finished`, `run.interrupted`, `run.failed_to_start`, `run.log`, `run.info`, `run.tests-added`, `attempt.started`, `attempt.step`, `attempt.log`, `attempt.flag`, `attempt.artifact`, `attempt.finished`, `page.opened`, `page.navigated`, `page.active`, `page.closed`, `video.unavailable`, `pack.added`, `pack.loaded`, `pack.reload_failed`, `pack.reloaded`, `pack.removed`, `editor.file_changed`, `review.saved`, `record.started`, `record.status`, `record.replay-step`, `record.step`, `record.step-updated`, `record.step-removed`, `record.ended`.

## Live WebSocket

`ws://127.0.0.1:7420/api/v1/live`. The server greets with `{ "type": "hello", "data": { version, head } }`. Send

```json
{ "type": "subscribe", "runId": "1a2b3c4d", "after": 0, "frames": true }
```

to get the run's events after `after` (then new ones) as `{ "type": "event", "data": <event> }` text messages, and, with `frames`, binary messages with the screencast: a 4-byte big-endian header length, a JSON header `{ runId, pageId, timestamp, width, height }`, then a JPEG. Leave out `runId` for every event and no frames. Send `subscribe` again to change it. A viewer that falls behind skips frames and only ever gets the newest one per page.

### Rewind

While a run is going, the server keeps the last 30 seconds of its screencast in memory, at most five frames a second per page. A listed frame stays fetchable for 30 seconds after it leaves the list, so a viewer can still load the oldest frames of the list it fetched. Nothing is written to disk, and the frames are dropped when the run ends.

| Route | What it does |
|---|---|
| `GET /live/:runId/rewind` | `{ windowMs, frames }`, oldest first. Each frame is `{ pageId, timestamp, width, height, url }`. |
| `GET /live/:runId/rewind/:pageId/:timestamp.jpg` | The kept frame of that page at `timestamp`, or the last one before it, as a JPEG. 404 once it has left the buffer. |

`POST /runs/:id/mark` with `{ pageId, at }` saves a rewind frame instead of the newest one.
