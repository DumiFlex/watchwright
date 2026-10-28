# Groundwork plan: the eight seams before new capabilities

Status: planned (2026-10-28). The gaps come from [docs/research/beyond-testing.md](../research/beyond-testing.md), section 3. Dumi asked to fix all eight before choosing a new capability. [docs/plan.md](../plan.md) is the base design; this step finishes the seams its section 3 promised, so that scraping, watching or crawling can arrive later as plugins without touching the core.

Everything here is general. Most of it helps testing right away: schedules, alerts and saved sign-ins are test features too.

## 1. What this step delivers

At the end of this step:

1. **Job kinds are plugins.** A plugin registers a job kind the way it registers actions. A run names its kind (`test` by default). The runs engine no longer imports anything from the testing plugin.
2. **A run can grow.** A job kind can add items to a run while it runs (a crawl finding pages). Added items show in the queue, survive a crash and resume, and can be skipped like any other.
3. **Outcomes have kind-specific words.** The outcome set stays the same five (so lists, filters, stats and redo keep working), but a kind can label them: an extraction calls `passed` "done".
4. **A kind brings its own helpers.** The `h` helper and the outcome rules belong to the kind that uses them. The engine gives every kind the same runtime (page, recorder, control, saves, events).
5. **Schedules.** "Run this pack every night at 2", "every 15 minutes", with a Schedules page: next and last run, pause, run now, history. Missed times while the server was off run once on start (or are skipped, per schedule). Watchwright can start when you sign in to Windows (a setting).
6. **Alerts that reach you when the web page is closed.** Channels (webhook, ntfy, Discord, Slack) and rules ("a run of pack X ends broken or failed", "it passes again", "a schedule was missed", "an agent is waiting for approval"), with a test button. The web page's own notifications stay as they are.
7. **Pages from plugins.** Each plugin declares its pages (name, title, icon, place in the menu). The web app builds its menu from what the server reports, so a plugin's page appears when the plugin is loaded.
8. **Saved sign-ins and secrets.** Sign in once by hand on the live view and save it for a site; runs of that site start signed in. Named secrets kept in the data folder, set on Settings > Secrets, used in steps as `${secret.NAME}` and `h.secret("NAME")`, and masked everywhere `${env.…}` values are masked today.

## 2. Job kinds as plugins (gaps 1, 3, 4)

**Registry.** The runs plugin provides a `JOB_KINDS` service (`register(kind)`, `get(name)`, `list()`), and `plugins/testing/` becomes a real plugin (today it is a folder the runs engine imports, not in `BUILTIN_PLUGINS`), loaded after `runs`, that registers `test` in its `setup`. The engine takes kinds from the service instead of `kinds: [testKind]`, and looks them up when a run starts, so a run interrupted before a crash resumes once its kind's plugin has registered.

**A run names its kind.** `runs.start` gets an optional `kind` (default `test`); `runs` rows already have `job_kind`. `prepare` uses it and refuses an unknown kind with `bad_input`. `GET /kinds` (`watchwright runs kinds`) lists the loaded kinds with their labels.

**The kind owns `h` and the outcome rules.** The engine stops importing `createHelpers` and `classify`. `JobKind` gets:

```ts
interface JobKind {
  // …as today…
  /** Builds this kind's helper object from the runtime the engine gives every attempt. */
  helpers(rt: AttemptRuntime, pack: LoadedPack): unknown;
  /** Turns how the body ended (returned, threw) into an outcome. */
  classify(ended: { error: unknown; flags: readonly Flag[] }): Outcome;
  /** Words for outcomes in this kind, shown by the web app, CLI and MCP (`passed` → "done"). */
  labels?: Partial<Record<Outcome, string>>;
}
```

`AttemptRuntime` is today's `HelperRuntime` moved to `jobs/`, minus test words. `AttemptEnv.helpers()` returns what the kind built. Packs, the `test` API and YAML tests don't change.

**Labels.** Runs, attempts and result documents already carry `kind`; `GET /kinds` gives each kind's words. The web app's status chips show the word, and every result keeps the outcome as the value, so filters, stats and agents keep one vocabulary. `schemaVersion` stays 1.

## 3. Runs that grow (gap 2)

`AttemptEnv.addItem(itemId, { after?: "now" | "end", attempts? })` adds an item to the running run. The kind must know the id (`describe` answers for it). The engine:

- puts it in the queue (`RunQueue.extend` already grows a plan when a person adds tests to a running run),
- stores it in a new `runs_added` table (run id, item id, position, attempts, added by attempt id) so resume re-plans with it,
- emits `run.item_added`, so the live queue updates as it does for a person adding tests.

A limit per run (`maxItems`, default 10 000) stops a runaway kind; hitting it is a run fact and a log line, not a crash. The `test` kind doesn't use `addItem` yet, so it is tested with a small fixture kind in the engine tests.

## 4. Pages from plugins (gap 7)

A plugin gets an optional `pages` field:

```ts
pages: [{ name: "schedules", title: "Schedules", icon: "calendar-clock", menu: "main", order: 30 }]
```

`GET /health` already lists plugins; it adds their pages. The web app keeps a map from page name to its view component (views stay compiled into the one web build, since plugins aren't loaded from outside the repo yet, plan section 3), builds the menu from the server's list, and hides a page whose plugin isn't loaded. Today's pages (Runs, Packs, Settings, Kit, Compare, New run) move to the same list, declared by their plugins. A route to a page the server doesn't list shows the runs list, as unknown addresses do now.

## 5. Saved sign-ins and secrets (gap 8)

**Secrets.** A `secrets` plugin keeps named secrets in `secrets.json` in the data folder (never in packs or the repo). The file is written with owner-only permissions where the OS has them. Values are write-only through the API: `secrets.list` returns names, when they were set and where they're used, never values; `secrets.set` and `secrets.delete` (destructive, so agents ask through approvals). Steps read `${secret.NAME}`, TypeScript tests `h.secret("NAME")`; both join the masking `${env.…}` has today (logs, kept texts, step titles, events), and a typed secret's field is masked in screenshots. `${env.…}` keeps working.

Not encrypted: an OS keychain needs a native module, and a key in the same folder protects nothing. The docs say so plainly: secrets are kept out of packs, logs and screenshots, not away from someone who can read your data folder.

**Saved sign-ins.** A `signins` plugin keeps one Playwright `storageState` per site key (cookies and local storage) in `<data>/signins/<site key>.json`.

- **Save one:** in a Record session (signed in by hand on the live view) press "Save sign-in", or call `h.saveSignIn()` at the end of a login test.
- **Use one:** a pack sets `site.signIn: "saved"` (or a run option "Start signed in"); the session creates its context with the saved state. A run whose saved sign-in is missing fails to start with a clear message; one that has expired is the pack's business (its first step sees a login page).
- **See and clear them** on Settings > Sign-ins: site, when saved, from which session; delete asks agents for approval.

`session.ts` already takes context options; the seam is `storageState` in them, filled by the runs engine through a `SIGNINS` service so the session layer stays unaware of plugins.

## 6. Schedules (gap 5)

A `schedules` plugin. A schedule is: a name, when (`every: "15m"` or a cron expression, with a time zone), what to start (a pack, tests, params and options: the same input as `runs.start`), missed-time policy (`once` or `skip`, default `once`), and on/off.

- **Timer.** One in-process timer computes the next due time ([croner](https://github.com/hexagon/croner) 10, no dependencies, time zones built in) and starts due schedules through the `runs.start` action with `startedBy: "schedule:<name>"`.
- **No pile-ups.** If the schedule's last run is still queued or running when it's due again, that time is skipped and logged (`schedule.skipped`). Runs still queue per site key as today.
- **Missed times.** On server start, a schedule that was due while the server was off starts once (`once`) or waits for the next time (`skip`), and emits `schedule.missed` either way.
- **Doors.** Actions `schedules.list`, `get`, `create`, `update`, `delete`, `run_now`, `pause`, `resume`; for agents, creating, changing and deleting are destructive (they make things happen later, unattended), so they go through approvals.
- **Page.** Schedules: a table (name, pack, when in words, next, last with its outcome), a form with a time picker and an "every" control from the control kit, and each schedule's run history. The runs list shows a schedule's runs with a clock mark.
- **Start at sign-in** (Settings > Server, Windows first): writes a small `.cmd` file to the user's Startup folder that runs `watchwright serve --no-open`. No compiled code and no PowerShell needed; turning it off deletes the file. macOS and Linux get the docs for a LaunchAgent and a systemd user unit.

## 7. Alerts (gap 6)

An `alerts` plugin built on the event log.

- **Channels**: webhook (POST of a JSON body with the event and links), ntfy (topic URL, optional token), Discord webhook, Slack webhook. URLs and tokens are kept as secrets (section 5). Email over SMTP comes later.
- **Rules**: when (a run ends with one of chosen statuses, an attempt is broken, a run passes after the last run of the same pack or schedule didn't, a schedule was missed or skipped, an approval is waiting), for which packs or schedules, to which channels. "Only on change" sends one alert per change, not one per run, which is what monitoring needs.
- **Messages** say what happened in one line and link to the run on the web page (`http://127.0.0.1:<port>/#/runs/<id>`, which works on the same machine).
- **Delivery** retries three times with back-off, then logs `alert.failed` and shows it on Settings > Alerts. A "Send test" button checks a channel.
- **Doors**: actions for channels and rules; changing them is destructive for agents.

## 8. Pull requests

1. This plan.
2. Job kinds as plugins: `JOB_KINDS`, `kind` on start, `helpers`/`classify` move to the testing kind, `GET /kinds` and outcome words in the web app, and a `ready` step in the plugin contract so queued runs wait for every kind (gaps 1, 3, 4).
3. Runs that grow: `addItem`, `runs_added`, resume, the live queue, a fixture kind in tests (gap 2).
4. Pages from plugins: `pages` in the contract, `GET /health`, the menu built from it (gap 7).
5. Secrets: store, Settings > Secrets, `${secret.…}`, `h.secret`, masking (gap 8, part 1).
6. Saved sign-ins: store, Record "Save sign-in", `h.saveSignIn`, `site.signIn`, Settings > Sign-ins (gap 8, part 2).
7. Schedules: store, timer, missed times, page, start at sign-in (gap 5).
8. Alerts: channels, rules, delivery, Settings > Alerts (gap 6).
9. Sign-off: docs site pages, AGENTS.md layout, skill references, a check on the PC.

Each PR carries tests, docs site changes for what users can see, and screenshots (light, dark, phone) for visible changes. PRs 2 to 4 change no behaviour a person sees beyond labels and the menu, so they go first.

## 9. Questions for Dumi

These have recommended answers, and building starts on them; say if any should change before its PR.

1. **Secrets in a plain file** in the data folder, kept out of packs, logs and screenshots but not encrypted (section 5)? The alternative, an OS keychain, needs a native module.
2. **Start at sign-in** as a `.cmd` file in the Startup folder, off by default (section 6)?
3. **First alert channels**: webhook, ntfy, Discord, Slack; email later (section 7)?
4. **Agents and schedules**: creating or changing a schedule or an alert from an agent waits for your approval on the web page (sections 6 and 7)?
