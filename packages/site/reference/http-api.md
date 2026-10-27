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

## Packs

| Method and path | Does |
|---|---|
| `GET /packs` | Every pack with its tests (each with its `description`, `inside` (a list, empty for top-level tests) and the `rubric` it is scored on), params, flag kinds, the pack's own `rubric`, run settings (`run`: `pauseOnBroken`, `pauseLimitMinutes`, `trace`, `video`, defaults filled in) and load errors. |
| `POST /packs` `{ path }` | Adds a pack by its absolute folder (or pack file) path and loads it. Quotes around the path (Windows' "Copy as path"), `file://` addresses, `~` and either slash are accepted. A pack that doesn't load is still added, with its error. Adding the same folder again returns the pack already added. |
| `GET /packs/:id` | One pack. Every pack carries `path` (its pack file), `dir` (its folder) and `missing` (true when the pack file is gone). |
| `POST /packs/:id/reload` | Builds it again now. |
| `POST /packs/:id/move` `{ path }` | Points a pack whose folder moved at its new folder. It keeps its id and runs. 400 `bad_pack` when the folder has no pack file or another pack already uses it. |
| `POST /packs/discover` `{ path, depth? }` | Finds pack files in a folder and up to `depth` (default 4, at most 8) levels below it, skipping `node_modules`, `dist`, `build` and hidden folders, and not looking inside a pack. Returns `{ root, found: [{ dir, packFile, packId }], truncated }`; `packId` is set for packs already added. |
| `DELETE /packs/:id` | Forgets the pack (its files and past runs stay). |

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
| `GET /runs?limit=&pack=&status=&before=` | Runs, newest first, with counts. `pack` keeps one pack's runs, `status` a comma-separated list of statuses (`finished,stopped`). For the next page, pass the `createdAt` of the last run as `before`. |
| `POST /runs` `{ packId, tests?, params?, pauseOnBroken?, pauseLimitMinutes?, attempts?, trace?, video? }` | Queues a run. `tests` defaults to all; tests they need, and parents and children, join by themselves. `attempts` gives every test the same number of attempts instead of its own `runs`; `trace` (`problems`, `always`, `never`) and `video` override the pack's settings for this run. |
| `POST /runs/preview` (same body) | Plans the run without starting it: `plan` (every attempt in order), `attempts`, the resolved `params`, and `joined`: tests that run although they weren't chosen, with the reason (`needed`, `parent`, `inside`) and the tests that brought them in. |
| `GET /runs/:id?history=` | The run, its plan (every planned attempt with its status), current attempts, and `live` (state, current test and step, pages) while it runs. `info` holds the facts the run saved with `info(key, value)`. `history=true` adds earlier tries of retried attempts. |
| `GET /runs/:id/attempts/:attemptId` | One attempt's result document (`schemaVersion: 1`): status, error, flags, metrics, notes, kept texts, log, artifacts with URLs. Shots from one `h.scrollShots` call carry the call's name as `set`. |
| `DELETE /runs/:id` | Deletes a run that isn't queued or going, with its attempts and its folder in the data folder. Its events stay in the event log. |
| `POST /runs/:id/pause` | Pauses at the next step. |
| `POST /runs/:id/resume` | Resumes a manual pause. For an `interrupted`, `stopped` or `failed_to_start` run, queues it to continue: passed, failed and skipped attempts are kept, the rest run. |
| `POST /runs/:id/retry`, `/skip` | Answers a pause on a broken attempt. |
| `POST /runs/:id/stop` `{ when: "after" \| "now" }` | `after` finishes the current test first; `now` ends at once and files the current attempt as `stopped`. A queued run is cancelled. |
| `POST /runs/:id/queue/skip` `{ testId, number?, undo? }` | Skips attempt `number` (default 1) of a test that hasn't started yet; `undo: true` takes the skip back. A skipped attempt is filed as `skipped` when its turn comes. The plan marks it with `skip: true`. |
| `POST /runs/:id/queue/move` `{ testId, direction: "up" \| "down" }` | Moves a test that hasn't started one place up or down, past the next test that hasn't started. Refused (400) when a test would run before a test it needs. Children move with their parent. |
| `POST /runs/:id/mark` `{ note? }` | Saves the live view's newest frame to the running attempt as a `mark` artifact named by the note, and adds the note to the attempt. Returns `{ attemptId, artifact }` (201). 409 `no_frame` before the first frame arrives. |
| `POST /runs/:id/redo-broken` | Runs only the broken attempts of a finished run again, with the tests they need. |
| `GET /files/runs/…` | Artifact files (the `url` in result documents). Only files inside the data folder's `runs/`. Answers `Range` requests (206), so videos can seek. |
| `GET /trace-viewer/index.html?trace=<url>` | Playwright's trace viewer, served from the installed `playwright-core`. Pass the full URL of an attempt's `trace` artifact; the viewer opens it without uploading it anywhere. |

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
| `GET /export?runs=a,b` | `{ name, markdown }`: the same runs as Markdown, one section per test, then per attempt: status, flags, metrics, the scores as a table, the reviewers' notes and links to the screenshots. |
| `GET /export.md?runs=a,b` | The Markdown as a file to download, with screenshot links to this server. |
| `GET /export.zip?runs=a,b` | A zip of the Markdown and its screenshots (`shots/<run>/<attempt>/…`), linked by relative paths, so it reads anywhere. |

Run statuses: `queued`, `running`, `pausing`, `paused`, `finished`, `stopped`, `interrupted` (the server stopped mid-run), `failed_to_start`. Attempt statuses: `passed`, `failed`, `broken`, `skipped`, `stopped`, plus `running` and `interrupted`.

## Events

Everything that happens is an event with a growing sequence number: `{ seq, time, type, runId?, attemptId?, data }`.

`GET /events?after=<seq>&wait=<seconds>&runId=&types=&limit=` returns `{ events, next, head }`. With `wait` (up to 110 seconds) it holds the request until a matching event arrives, so an agent can follow a run with one request at a time: call again with `after=next`.

Event types (open set, more come with later plugins): `run.queued`, `run.started`, `run.planned`, `run.pausing`, `run.paused`, `run.resumed`, `run.decision`, `run.stopping`, `run.finished`, `run.interrupted`, `run.failed_to_start`, `run.log`, `run.info`, `attempt.started`, `attempt.step`, `attempt.log`, `attempt.flag`, `attempt.artifact`, `attempt.finished`, `page.opened`, `page.navigated`, `page.active`, `page.closed`, `video.unavailable`, `pack.added`, `pack.loaded`, `pack.reload_failed`, `pack.reloaded`, `pack.removed`, `review.saved`.

## Live WebSocket

`ws://127.0.0.1:7420/api/v1/live`. The server greets with `{ "type": "hello", "data": { version, head } }`. Send

```json
{ "type": "subscribe", "runId": "1a2b3c4d", "after": 0, "frames": true }
```

to get the run's events after `after` (then new ones) as `{ "type": "event", "data": <event> }` text messages, and, with `frames`, binary messages with the screencast: a 4-byte big-endian header length, a JSON header `{ runId, pageId, timestamp, width, height }`, then a JPEG. Leave out `runId` for every event and no frames. Send `subscribe` again to change it. A viewer that falls behind skips frames and only ever gets the newest one per page.
