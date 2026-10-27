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
| `GET /packs` | Every pack with its tests, params, flag kinds, run settings (`run`: `pauseOnBroken`, `pauseLimitMinutes`, `trace`, `video`, defaults filled in) and load errors. |
| `POST /packs` `{ path }` | Adds a pack by its absolute folder (or pack file) path and loads it. A pack that doesn't load is still added, with its error. |
| `GET /packs/:id` | One pack. |
| `POST /packs/:id/reload` | Builds it again now. |
| `DELETE /packs/:id` | Forgets the pack (its files and past runs stay). |

## Runs

| Method and path | Does |
|---|---|
| `GET /runs?limit=&pack=&status=&before=` | Runs, newest first, with counts. `pack` keeps one pack's runs, `status` a comma-separated list of statuses (`finished,stopped`). For the next page, pass the `createdAt` of the last run as `before`. |
| `POST /runs` `{ packId, tests?, params?, pauseOnBroken?, pauseLimitMinutes?, attempts?, trace?, video? }` | Queues a run. `tests` defaults to all; tests they need, and parents and children, join by themselves. `attempts` gives every test the same number of attempts instead of its own `runs`; `trace` (`problems`, `always`, `never`) and `video` override the pack's settings for this run. |
| `POST /runs/preview` (same body) | Plans the run without starting it: `plan` (every attempt in order), `attempts`, the resolved `params`, and `joined`: tests that run although they weren't chosen, with the reason (`needed`, `parent`, `inside`) and the tests that brought them in. |
| `GET /runs/:id?history=` | The run, its plan (every planned attempt with its status), current attempts, and `live` (state, current test and step, pages) while it runs. `history=true` adds earlier tries of retried attempts. |
| `GET /runs/:id/attempts/:attemptId` | One attempt's result document (`schemaVersion: 1`): status, error, flags, metrics, notes, kept texts, log, artifacts with URLs. |
| `DELETE /runs/:id` | Deletes a run that isn't queued or going, with its attempts and its folder in the data folder. Its events stay in the event log. |
| `POST /runs/:id/pause` | Pauses at the next step. |
| `POST /runs/:id/resume` | Resumes a manual pause. For an `interrupted`, `stopped` or `failed_to_start` run, queues it to continue: passed, failed and skipped attempts are kept, the rest run. |
| `POST /runs/:id/retry`, `/skip` | Answers a pause on a broken attempt. |
| `POST /runs/:id/stop` `{ when: "after" \| "now" }` | `after` finishes the current test first; `now` ends at once and files the current attempt as `stopped`. A queued run is cancelled. |
| `POST /runs/:id/queue/skip` `{ testId, number?, undo? }` | Skips attempt `number` (default 1) of a test that hasn't started yet; `undo: true` takes the skip back. A skipped attempt is filed as `skipped` when its turn comes. The plan marks it with `skip: true`. |
| `POST /runs/:id/queue/move` `{ testId, direction: "up" \| "down" }` | Moves a test that hasn't started one place up or down, past the next test that hasn't started. Refused (400) when a test would run before a test it needs. Children move with their parent. |
| `POST /runs/:id/mark` `{ note? }` | Saves the live view's newest frame to the running attempt as a `mark` artifact named by the note, and adds the note to the attempt. Returns `{ attemptId, artifact }` (201). 409 `no_frame` before the first frame arrives. |
| `POST /runs/:id/redo-broken` | Runs only the broken attempts of a finished run again, with the tests they need. |
| `GET /files/runs/…` | Artifact files (the `url` in result documents). Only files inside the data folder's `runs/`. |

Run statuses: `queued`, `running`, `pausing`, `paused`, `finished`, `stopped`, `interrupted` (the server stopped mid-run), `failed_to_start`. Attempt statuses: `passed`, `failed`, `broken`, `skipped`, `stopped`, plus `running` and `interrupted`.

## Events

Everything that happens is an event with a growing sequence number: `{ seq, time, type, runId?, attemptId?, data }`.

`GET /events?after=<seq>&wait=<seconds>&runId=&types=&limit=` returns `{ events, next, head }`. With `wait` (up to 110 seconds) it holds the request until a matching event arrives, so an agent can follow a run with one request at a time: call again with `after=next`.

Event types (open set, more come with later plugins): `run.queued`, `run.started`, `run.planned`, `run.pausing`, `run.paused`, `run.resumed`, `run.decision`, `run.stopping`, `run.finished`, `run.interrupted`, `run.failed_to_start`, `run.log`, `attempt.started`, `attempt.step`, `attempt.log`, `attempt.flag`, `attempt.artifact`, `attempt.finished`, `page.opened`, `page.navigated`, `page.active`, `page.closed`, `video.unavailable`, `pack.added`, `pack.loaded`, `pack.reload_failed`, `pack.reloaded`, `pack.removed`.

## Live WebSocket

`ws://127.0.0.1:7420/api/v1/live`. The server greets with `{ "type": "hello", "data": { version, head } }`. Send

```json
{ "type": "subscribe", "runId": "1a2b3c4d", "after": 0, "frames": true }
```

to get the run's events after `after` (then new ones) as `{ "type": "event", "data": <event> }` text messages, and, with `frames`, binary messages with the screencast: a 4-byte big-endian header length, a JSON header `{ runId, pageId, timestamp, width, height }`, then a JPEG. Leave out `runId` for every event and no frames. Send `subscribe` again to change it. A viewer that falls behind skips frames and only ever gets the newest one per page.
