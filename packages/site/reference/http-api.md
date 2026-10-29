# HTTP and WebSocket API

Everything the web page does goes through this API, so scripts and AI agents can do the same. All routes are under `http://127.0.0.1:7420/api/v1`.

- JSON in and out. Success is `{ "data": … }`. Failure is `{ "error": { "code", "message", "detail"? } }` with a snake_case `code` and a matching HTTP status.
- Requests must pass the [request guard](../guide/safety#who-can-reach-the-server): a loopback `Host` with the server's port, and for changes no `Origin` header or the server's own (scripts and agents send none).
- Send `x-watchwright-client: <name>` to be named as who started a run (default `api`).
- `GET /actions` lists every action with its JSON Schema input. The [CLI](./cli) builds its commands from the same list, and the [MCP server](./mcp) its tools.
- `/api/v1/mcp` is the MCP endpoint (streamable HTTP), for AI agents.

## Server

| Method and path | Does |
|---|---|
| `GET /health` | Whether the server is up, its version, its data folder, the loaded plugins with the newest store migration each one applied, and `pages`: the web app pages the plugins bring (`{ plugin, name, title, path, icon, menu, order, words? }`, in menu order), which the web app builds its menu from. |
| `GET /actions` | Every action: `name`, `title`, `method`, `path`, JSON Schema `input`, and where set `output` (the JSON Schema of its data), `agent` (`{ tool, say? }`: the MCP tool it is offered as, and a hint for agents) and `destructive: true` (it deletes data or stops the server). |
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

[Recording](../guide/recording) opens a browser for a pack and turns what is done on its page into YAML steps. A recording has an 8-character id. Its events carry that id as `runId`, and its screencast goes through the [live WebSocket](#live-websocket) the same way, so a viewer subscribes to a recording as to a run. A recording holds its pack's site: runs of the site wait for it, and it waits (status `waiting`) for a run of the site to end. It ends by itself after 30 minutes without input (15 minutes without a call when an agent started it).

A recording's state is `{ id, packId, testId, status, message, window, viewport, pages, activePage, steps, startedBy }`. `startedBy` is `web` for the person, else the client that started it (an agent's name). `status` is `waiting`, `starting`, `replaying` (running the steps before the cursor), `recording` or `ended`. Each step is `{ id, name, args, targets, spot }`: `args` are the YAML step's fields, `targets` every target that picks out the same element (the one in use first), and `spot` where a click landed inside the element, for `position`.

| Method and path | Does |
|---|---|
| `GET /record` | `{ canWindow, recordings }`. `canWindow` says whether this machine has a screen for `window: true`. |
| `POST /record` `{ packId, testId?, replay?, line?, url?, params?, window?, signIn? }` | Starts a recording (201, its state). It starts with the site's saved sign-in when `signIn` (default: the pack's `site.signIn`) asks for one and one is saved. With `testId`, the pack's `beforeEach` runs first; with `replay`, also that YAML test's first `replay` steps; with `line`, also that code test's code up to that line (it stops at the first Playwright call below it). `url` is where to open (the site's base URL by default), `params` the parameter values for those steps. 400 `bad_test`, `bad_params`, `no_window`. |
| `GET /record/:id` | The recording's state. |
| `POST /record/:id/input` `{ type, … }` | Input for the active page, in page pixels: `click`, `dblclick`, `down`, `up` (`x`, `y`, `button?`, `clickCount?`), `move` (`x`, `y`), `wheel` (`x`, `y`, `deltaX`, `deltaY`), `key` (`key` in Playwright's form, `Shift+Tab`), `text` (`text`, typed into the focused field), `goto` (`url`), `back`, `reload`. A `move`, `up` or `wheel` answers with `hover`: the element now under the pointer (`box` in page pixels, `tag`, and its best `target`, not checked on the page), or null. 409 `not_recording` before recording starts or after it ends. |
| `POST /record/:id/pick` `{ x, y }` | The element at a point: `{ info, targets, groups }`. `info` has its `tag`, `text`, `value` and `checked`; `targets` pick out only it, best first; `groups` are targets it shares with elements like it, with their `count`. 404 `nothing_there`. |
| `POST /record/:id/page` `{ pageId }` | Makes one of `pages` the active page. |
| `POST /record/:id/steps` `{ name, args?, targets?, index? }` | Adds a step (201), at the end or at `index`. `targets` are other targets to offer for it. 400 `bad_step`. |
| `POST /record/:id/steps/:step` `{ name?, args? }` | Changes a step. A new `args.target` is added to its `targets`. |
| `DELETE /record/:id/steps/:step` | Removes a step. |
| `GET /record/:id/look?shot=` | The active page as an agent reads it: `{ url, title, snapshot, shot? }`. `snapshot` is Playwright's aria snapshot for AI, where elements carry refs (`[ref=e4]`); `shot` (with `shot=true`) is a JPEG of the viewport, `{ mimeType, encoding: "base64", data }`. |
| `POST /record/:id/do` `{ steps, shot? }` | Runs [YAML steps](./yaml-steps), written as JSON, on the active page one at a time and stops at the first that fails. A target may be `{ "ref": "e4" }` from the last look: it is swapped for the element's best target before the step runs. Each step that ran joins the steps. Answers `{ steps: [{ index, ok, step?, error? }], look }`. |
| `POST /record/:id/sign-in` | Saves the recording browser's cookies and local storage as its site's sign-in, replacing the one saved before: `{ siteKey }`. From anything but the web page it waits for approval. |
| `POST /record/:id/stop` | Ends the recording and closes its browser. Returns the state with the steps, and `yaml`: the steps as the list a test's `steps:` takes. |

Events: `record.started`, `record.status` `{ status, message }`, `record.replay-step` `{ title }`, `record.agent-step` `{ title }` (a step of `do` running), `record.step` `{ step, index }`, `record.step-updated` `{ step }`, `record.step-removed` `{ id }`, `record.ended` `{ message, steps }` (`steps` is how many), and the `page.*` events of its pages.

## Settings

Preferences for the whole machine, the same for every browser and agent. Plugins declare them; the web app's Settings page edits them. The look and mode stay in each browser.

| Method and path | Does |
|---|---|
| `GET /settings` | `{ values, definitions }`: every setting's value (its default when never changed) and, for each, `key`, `title`, the JSON Schema of its value and its `default`. |
| `POST /settings` `{ values }` | Changes several settings at once, all or none; `null` puts one back to its default. Returns `{ values }`. 400 `unknown_setting` or `invalid_setting`. |

The settings so far:

- `settings.editor`: the editor that file links open in (`vscode`, `cursor`, `windsurf`, `idea`, `webstorm` or `none`; default `vscode`).
- `runs.newRunFrom`: what the New run page fills in when it opens: `latest` (the pack's latest run, the default) or `defaults` (the pack's defaults).

## Secrets and sign-ins

Secrets are passwords and tokens tests read as `${secret.NAME}` or `h.secret("NAME")`; see [Secrets](../guide/yaml-tests#secrets). Saved sign-ins are one browser storage state (cookies and local storage) per site key, for runs that start signed in; see [Saved sign-ins](../guide/yaml-tests#saved-sign-ins). Both are kept in the data folder, not encrypted, and changing them from anything but the web page waits for approval.

| Method and path | Does |
|---|---|
| `GET /secrets` | `[{ name, length, setAt }]`, never values. |
| `POST /secrets` `{ name, value }` | Sets a secret, or a new value for one (201, `{ name, length, setAt }`). A name is letters, digits and `_`, starting with a letter or `_`. |
| `DELETE /secrets/:name` | Deletes a secret. 404 `not_found`. |
| `GET /signins` | `[{ siteKey, savedAt, source, cookies, origins }]`: when each was saved, from where (`record`, or `run <id>`), how many cookies and which sites' local storage it holds. |
| `DELETE /signins/:siteKey` | Deletes a saved sign-in. 404 `not_found`. |

Events: `signin.saved` `{ siteKey }`, on the run or recording that saved it.

## Schedules

Runs that start by themselves; see [Schedules](../guide/schedules). A due schedule starts its run like `POST /runs`, with `startedBy` `schedule:<name>`. Creating, changing, resuming and deleting a schedule, and start at sign-in, wait for approval from anything but the web page.

| Method and path | Does |
|---|---|
| `GET /schedules` | The schedules, by name: `{ id, name, packId, when, says, run, missed, enabled, nextAt, lastDueAt, lastRunId, lastRun, createdAt, updatedAt }`. `says` is `when` in words ("Every day at 02:00 (UTC)"); `lastRun` is `{ id, status, createdAt, finishedAt, counts }` or null. |
| `GET /schedules/:id` | One schedule, with `runs`: `[{ runId, dueAt, startedAt, run }]`, newest first. 404 `not_found`. |
| `POST /schedules` `{ name, packId, when, run?, missed?, enabled? }` | Creates a schedule (201). `when` is `{ every }` (`15m`, `2h`, `1d`) or `{ cron, timezone? }` (five fields; the time zone defaults to the machine's); 400 `bad_when` otherwise, or when it would run more than once a minute. `run` is what `POST /runs` takes, without `packId`; 400 `bad_run` when that run wouldn't start (an unknown test or preset). `missed` is `once` (default) or `skip`. 409 `name_taken`. |
| `POST /schedules/:id` | Changes any of `name`, `packId`, `when`, `run`, `missed`, `enabled`. A new `when` counts from now. |
| `DELETE /schedules/:id` | Deletes a schedule; the runs it started stay. |
| `POST /schedules/:id/run` | Starts the schedule's run now (201, `{ runId }`); its next time stays. |
| `POST /schedules/:id/pause` | Pauses it: `enabled` false, no `nextAt`. |
| `POST /schedules/:id/resume` | Resumes it from its next time. |
| `GET /startup` | Start at sign-in: `{ supported, enabled, file, command }`. `supported` is true on Windows, where the server writes `file`; `command` starts this server with its port and data folder. |
| `POST /startup` `{ enabled }` | Turns start at sign-in on or off (Windows). 400 `not_supported` elsewhere. |

Events: `schedule.created`, `schedule.updated`, `schedule.deleted`, `schedule.fired` (with `runId` and `why`: `due`, `missed` or `now`), `schedule.skipped` (its last run was still going), `schedule.missed` (a time passed while the server was off, with the `policy` used) and `schedule.failed` (the run didn't start, with `message`).

## Alerts

Messages to ntfy, Discord, Slack or a webhook when runs end a certain way; see [Alerts](../guide/alerts). Adding, changing and deleting channels and rules wait for approval from anything but the web page.

| Method and path | Does |
|---|---|
| `GET /alerts/channels` | `[{ id, name, type, url, hasToken, createdAt, updatedAt }]`. `url` is only the site (`https://ntfy.sh/…`), or a `${secret.NAME}` reference as written; tokens are never answered. |
| `POST /alerts/channels` `{ name, type, url, token? }` | Adds a channel (201). `type` is `ntfy`, `discord`, `slack` or `webhook`. `url` and `token` may be `${secret.NAME}`. 400 `bad_url`, 409 `name_taken`. |
| `POST /alerts/channels/:id` | Changes any of `name`, `type`, `url`, `token`. A missing `url` or `token` keeps the saved one; an empty `token` removes it. |
| `DELETE /alerts/channels/:id` | Deletes a channel and takes it out of every rule. |
| `POST /alerts/channels/:id/test` | Sends a test message now: `{ sent: true }`, or 502 `send_failed` with the reason. |
| `GET /alerts/rules` | `[{ id, name, triggers, packs, schedules, channels, onlyOnChange, enabled, createdAt, updatedAt }]`. |
| `POST /alerts/rules` `{ name, triggers, channels, packs?, schedules?, onlyOnChange?, enabled? }` | Adds a rule (201). `triggers` are `failed`, `broken`, `stopped`, `passed`, `failed_to_start`, `recovered` (passes again), `test_broken`, `schedule_missed` and `approval`. `packs` and `schedules` are ids; both empty covers everything. `onlyOnChange` defaults to true. |
| `POST /alerts/rules/:id` | Changes any of the rule's fields. |
| `DELETE /alerts/rules/:id` | Deletes a rule. |
| `GET /alerts/log?limit=` | What was sent lately, newest first (default 50, at most 500): `{ id, at, ruleId, ruleName, channelId, channelName, trigger, title, runId, status, tries, error }`. `status` is `sending`, `sent` or `failed`. |

Events: `alert.sent` and `alert.failed` (`{ rule, channel, trigger, title, tries, error? }`, on the run when there is one), `alert.channel_changed` and `alert.rule_changed` (`{ id, name, change }`).

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
| `POST /runs` `{ packId, tests?, params?, pauseOnBroken?, pauseLimitMinutes?, attempts?, trace?, video?, signIn?, label?, preset?, kind? }` | Queues a run. `kind` is the job kind (default `test`; `GET /kinds` lists the loaded ones, and an unknown kind is a 400 `bad_input`). `tests` defaults to all; tests they need, and parents and children, join by themselves. `attempts` gives every test the same number of attempts instead of its own `runs`; `trace` (`problems`, `always`, `never`) and `video` override the pack's settings for this run, and `signIn` starts it with (or without) the site's [saved sign-in](#secrets-and-sign-ins) instead of the pack's `site.signIn`; a run that should start signed in with none saved fails to start. `label` names the run (up to 120 characters). `preset` starts from the pack's preset with that name; the other fields given override it (404 when the pack has no such preset). |
| `GET /kinds` | The job kinds the server has loaded, `[{ name, labels }]`. `labels` maps an outcome to the word the kind shows for it (an extraction could show `done` for `passed`); the outcome stays the value in every result. Runs and attempts carry their `kind`. |
| `POST /runs/:id/again` | Queues a new run with the run's pack, tests, values, options and label (201). Queue edits made during the run aren't copied. |
| `POST /runs/:id/label` `{ label }` | Names a run; an empty label takes the name away. Runs carry `label` (empty when none). |
| `POST /runs/preview` (same body) | Plans the run without starting it: `plan` (every attempt in order), `attempts`, the resolved `params`, and `joined`: tests that run although they weren't chosen, with the reason (`needed`, `parent`, `inside`) and the tests that brought them in. |
| `GET /runs/:id?history=` | The run, its plan (every planned attempt with its status), current attempts, and `live` (state, current test and step, pages) while it runs. `info` holds the facts the run saved with `info(key, value)`. `history=true` adds earlier tries of retried attempts. |
| `GET /runs/:id/attempts/:attemptId` | One attempt's result document (`schemaVersion: 1`): status, error, flags, metrics, notes, kept texts, log, `steps` (`{ title, depth, startedAt, finishedAt, status }` for each `h.step`), artifacts with URLs. Shots from one `h.scrollShots` call carry the call's name as `set`. |
| `GET /runs/stats?days=&pack=&tz=&until=` | Runs at a glance: `days` (one entry per day, oldest first, `days` of them, default 14, at most 90) with `{ date, runs, passed, failed, broken, skipped, stopped, medianMs }`, and the same totals for the period (`current`) and the `days` days before it (`previous`). Runs count on the day they were made, attempts on the day they started; only top-level attempts that finished count, and `medianMs` is the median time of the passed and failed ones. `tz` is the caller's `Date.getTimezoneOffset()` (minutes behind UTC), so days are the caller's calendar days; `until` (YYYY-MM-DD) is the last day, today by default. `pack` keeps one pack's runs. |
| `GET /packs/:id/history?limit=` | Each test's last `limit` (default 20, at most 100) finished attempts across the pack's runs, oldest first, keyed by test id: `{ attemptId, runId, runLabel, number, try, status, startedAt, durationMs, params }`. Only the try that counts is listed; `try` above 1 means it was run again after it broke. `{}` for a pack with no runs. |
| `DELETE /runs/:id` | Deletes a run that isn't queued or going, with its attempts and its folder in the data folder. Its events stay in the event log. |
| `GET /runs/:id/summary` | A run in brief, for agents and scripts: `{ id, label, pack: { id, name }, status, startedBy, page, live, counts, pending, attempts, error }`. `page` is the run's page in the web app (`/#/runs/<id>`); `live` is `{ state, pauseReason, pausedBy, deadline, stopping, testId, step }` while it runs; `counts` leaves out zeros; each attempt is `{ id, testId, title, number, try, parentId, status, error, robot, findings, durationMs }`, with the error's kind and first line and how many robot and finding flags it has. |
| `GET /runs/:id/wait?after=&timeout=` | Waits until the run ends or pauses, at most `timeout` seconds (default 60, at most 110). Returns `{ reason, cursor, happened, run }`: `reason` is `ended`, `paused`, `timeout` or `gone` (the caller went away); `run` is the summary; `happened` lists what happened since `after` (or since the call): runs starting, pausing (`reason`, `testId`, `by`), resuming, stopping and finishing, and each attempt finishing (`testId`, `number`, `status`, `error`, `flags`). Pass `cursor` as `after` to the next wait. Without `after` a paused run answers at once; with it, only a pause after that cursor does, so a caller isn't answered again while a person keeps the run paused. |
| `POST /runs/:id/control` `{ do }` | One door for `pause`, `resume`, `retry`, `skip`, `stop` (after this test) and `stop-now`. Returns the summary. |
| `GET /runs/:id/file?path=` | One of the run's files by its `path` from a result document: `{ path, url, mimeType, size, width?, height?, encoding, data, note? }`. PNG and JPEG images come as base64 with their size in pixels, text and JSON files as `utf8`. An image over 5 MB or with a side over 8000 px, a text over 1 MB, and other files come without `data`, with a `note` and the `url` to fetch them. 404 for a path outside the run's folder. |
| `POST /runs/:id/pause` | Pauses at the next step. The run's `live.pausedBy` and the `run.paused` event's `by` name who asked. |
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
| `GET /runs/:id/changes?against=` | What changed in a run since `against`, or (without it) since the newest earlier finished, stopped or interrupted run of the same pack with the same params, preferring one with the same chosen tests. `{ previous, rows, same }`: each row is a test and attempt number with `before` and `after` (`{ runId, attemptId, status, durationMs, score, flags }`, null when that run didn't have it) and `changes` from `status`, `flags`, `score` (moved by 0.5 or more), `time` (half again as long or short, and at least 2 s apart), `new` and `gone`. `same` counts the attempts that didn't change. `previous` is null when there is no earlier run. |
| `GET /export?runs=a,b` | `{ name, markdown }`: the same runs as Markdown, one section per test, then per attempt: status, flags, metrics, the scores as a table, the reviewers' notes and links to the screenshots. |
| `GET /export.md?runs=a,b` | The Markdown as a file to download, with screenshot links to this server. |
| `GET /export.zip?runs=a,b` | A zip of the Markdown and its screenshots (`shots/<run>/<attempt>/…`), linked by relative paths, so it reads anywhere. |

Run statuses: `queued`, `running`, `pausing`, `paused`, `finished`, `stopped`, `interrupted` (the server stopped mid-run), `failed_to_start`. Attempt statuses: `passed`, `failed`, `broken`, `skipped`, `stopped`, plus `running` and `interrupted`.

## Approvals

Actions marked `destructive` in `GET /actions` (deleting a run, a pack, a pack file or a preset, and `POST /stop`) run at once only when the request comes from the web page. From anything else they wait for the person to [approve them on the web page](../guide/safety#approvals). The request is held for up to 45 seconds (less than MCP clients' 60 second timeout): approved in that time, it answers as the action does; refused, it fails with 403 `refused`. Still waiting after that, it answers `202` with `{ approval, message }`; wait on the approval by its id.

An approval is `{ id, action, input, client, summary, status, answeredBy, result, error, createdAt, answeredAt, expiresAt }`. `status` is `waiting`, `approved` (it ran; `result` is the action's data), `refused`, `expired` (nobody answered in 30 minutes) or `failed` (approved, but the action failed; `error` says why).

| Method and path | Does |
|---|---|
| `GET /approvals?status=&limit=` | Approvals, newest first. |
| `GET /approvals/:id/wait?timeout=` | Waits until the approval is answered or expires, at most `timeout` seconds (default 60, up to 110), and returns it. Call again while it is `waiting`. |
| `POST /approvals/:id/answer` `{ approve }` | Approves (runs the action) or refuses. Only from the web page: 403 `not_allowed` otherwise. 409 `conflict` once it is answered. |

## Agents

| Method and path | Does |
|---|---|
| `GET /agents/seen?days=` | Agents that called the MCP server in the last `days` (default 30), most recent first: `{ name, firstAt, lastAt, lastTool, calls, started }`, where `started` counts the runs and explore sessions it started. |
| `POST /agents/install` `{ folder, agents?, mcp?, server? }` | Does what [`watchwright init-agent`](./cli#init-agent) does, in a folder on the server's machine: `agents` is a list of `claude`, `codex`, `cursor`; `server` is the address written into the settings. Answers `{ folder, agents, wrote, commands, problems }`. 400 `install_failed` when the folder is missing. |

## Events

Everything that happens is an event with a growing sequence number: `{ seq, time, type, runId?, attemptId?, data }`.

`GET /events?after=<seq>&wait=<seconds>&runId=&types=&limit=` returns `{ events, next, head }`. With `wait` (up to 110 seconds) it holds the request until a matching event arrives, so an agent can follow a run with one request at a time: call again with `after=next`.

Event types (open set, more come with later plugins): `run.queued`, `run.started`, `run.planned`, `run.pausing`, `run.paused`, `run.resumed`, `run.decision`, `run.stopping`, `run.labeled`, `run.finished`, `run.interrupted`, `run.failed_to_start`, `run.log`, `run.info`, `run.tests-added`, `run.items-added` (items a job kind added to its running run, in batches, with `total` so far; a run's `options.added` lists them, and a resumed run keeps them), `attempt.started`, `attempt.step`, `attempt.log`, `attempt.flag`, `attempt.artifact`, `attempt.finished`, `page.opened`, `page.navigated`, `page.active`, `page.closed`, `video.unavailable`, `pack.added`, `pack.loaded`, `pack.reload_failed`, `pack.reloaded`, `pack.removed`, `editor.file_changed`, `review.saved`, `record.started`, `record.status`, `record.replay-step`, `record.agent-step`, `record.step`, `record.step-updated`, `record.step-removed`, `record.ended`, `signin.saved`, `schedule.created`, `schedule.updated`, `schedule.deleted`, `schedule.fired`, `schedule.skipped`, `schedule.missed`, `schedule.failed`, `alert.sent`, `alert.failed`, `alert.channel_changed`, `alert.rule_changed`, `approval.requested`, `approval.answered`.

## Live WebSocket

`ws://127.0.0.1:7420/api/v1/live`. The server greets with `{ "type": "hello", "data": { version, head } }`. Send

```json
{ "type": "subscribe", "runId": "1a2b3c4d", "after": 0, "frames": true }
```

to get the run's events after `after` (then new ones) as `{ "type": "event", "data": <event> }` text messages, and, with `frames`, binary messages with the screencast: a 4-byte big-endian header length, a JSON header `{ runId, pageId, timestamp, width, height }`, then a JPEG. Leave out `runId` for every event and no frames. With `runId`, `"logTail": 5000` replays only the run's newest 5,000 log lines (`attempt.log`, `run.log`) and every other event; a `{ "type": "backlog", "data": { "skippedLogs": n } }` message first says how many older lines it left out. The run page does this, so a run with a long log opens at its tail. Send `subscribe` again to change it. A viewer that falls behind skips frames and only ever gets the newest one per page.

### Rewind

While a run is going, the server keeps the last 30 seconds of its screencast in memory, at most five frames a second per page. A listed frame stays fetchable for 30 seconds after it leaves the list, so a viewer can still load the oldest frames of the list it fetched. Nothing is written to disk, and the frames are dropped when the run ends.

| Route | What it does |
|---|---|
| `GET /live/:runId/rewind` | `{ windowMs, frames }`, oldest first. Each frame is `{ pageId, timestamp, width, height, url }`. |
| `GET /live/:runId/rewind/:pageId/:timestamp.jpg` | The kept frame of that page at `timestamp`, or the last one before it, as a JPEG. 404 once it has left the buffer. |

`POST /runs/:id/mark` with `{ pageId, at }` saves a rewind frame instead of the newest one.
