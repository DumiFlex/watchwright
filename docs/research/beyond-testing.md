# Research: capabilities beyond testing

Notes written on 2026-10-28, after 0.5.0, when testing was judged complete enough to start on other capabilities. Nothing here is built yet. The note looks at what Watchwright could do besides testing, what each capability gives people, how it fits the plugin seams from [docs/plan.md](../plan.md) (section 3), what it reuses, how big it is, and in which order to build. It ends with the questions to settle before the first plan.

## 1. What Watchwright already is, and why that matters here

Watchwright is a long-lived local server that drives a real Playwright browser, streams it live to its own web page, lets a person pause it and take over, keeps everything in a store, and exposes every action through HTTP, a CLI and an MCP server. That is a general "watched browser job" platform with testing as its first job.

Most tools in the areas below are either cloud services (you can't watch, can't take over, and your logins live on someone else's machine) or libraries (no live view, no store, no web page). The common thread for every capability in this note is the same pitch as for testing:

- **You watch it work**, live, and can pause it, take over with the mouse and hand it back.
- **It runs in your browser profile on your machine**, so pages behind your own login work and nothing leaves the machine.
- **Your own agent can drive it** through the same CLI, MCP tools and skill, while you watch.
- **Everything is kept**: video, trace, screenshots, logs and now data, reviewable afterwards.

Watchwright still has no AI of its own. Where a capability would "use AI to find the data", the answer here is: the person's own agent explores with the existing `explore_*` tools and writes the recipe, and Watchwright runs the recipe without AI.

## 2. What the core already gives every capability

| Piece | Where | A new capability gets |
|---|---|---|
| Browser sessions, screencast, video, trace | `session/` | Live view, video and trace of any job, every browser Playwright has. |
| Job runner | `plugins/runs/engine.ts`, `jobs/` | Queue, site locks, pause, stop, retry and skip on breaks, hot reload, crash resume. |
| Job kinds | `jobs/kind.ts` | The interface a non-test job implements (`plan`, `setup`, `execute`, `afterAttempt`). |
| YAML steps and targets | `plugins/packs/yaml/` | A way to write "go here, click this, wait for that" without code, with an editor and hints. |
| Record | `plugins/record/` | Clicking on the live view turns into steps; good targets from `candidatesOf`. |
| Exploring for agents | `plugins/record/explore.ts` | Aria snapshots with refs, so an agent can find what to extract. |
| Collectors | `plugins/testing/collectors.ts` | Console errors, failed requests, matched responses. The `responses` collector is half of an API scraper already. |
| Diffs | web `diff.ts`, `ImageDiff.vue`, `reviews/compare.ts` | Text and image diffs (side by side, wipe, overlay), which change watching needs. |
| Event log | `events/` | Records arriving live, cursors for agents (`wait`). |
| Action registry, CLI, MCP, approvals | `actions/`, `cli/`, `plugins/agents/`, `plugins/approvals/` | Every new action is an HTTP route, a CLI command and (with `agent.tool`) an MCP tool; destructive ones wait for the person. |
| Settings | `plugins/settings/` | Machine-wide preferences a plugin declares. |
| Secrets in steps | `plugins/packs/yaml/run.ts` | `${env.NAME}` values, masked in logs and kept texts. |

## 3. Seams that are missing

Reading the code with a second job kind in mind, these are the gaps. They are small, but every capability below needs some of them, so they belong in the first PR of whichever capability goes first.

1. **Job kinds are not pluggable yet.** The `runs` plugin passes `kinds: [testKind]` by import, and `RunEngine.prepare` picks `this.kinds.get("test")`. A `JOB_KINDS` service (plugins register kinds in `setup`) and a `kind` field on run start close this, as plan section 3 intended.
2. **Plans are fixed at start.** `KindPlan.items` is known before the first attempt. A crawl discovers its pages while it runs, so a kind needs a way to add items during a run (and resume must keep them).
3. **Outcomes are test words.** `Outcome` is passed, failed, broken, skipped, stopped. For a scrape, "failed" (an assertion) has no meaning; "broken" (the page didn't load, a target wasn't there) and "done" do. Either kinds map to the same set (done = passed) or the set gets a kind-specific label. Mapping is simpler and keeps every list and filter working.
4. **Kinds get `LoadedPack` and test `Helpers`.** Fine if every job lives in a pack (see question 2 in section 9), which is the recommendation.
5. **Nothing runs on its own.** There is no scheduler; every run is started by a person or an agent.
6. **Alerts only reach an open browser tab.** Notifications today are the web page's (`notify.ts`). A job that runs at 3 a.m. needs server-side alerts: a webhook, ntfy, Discord or Slack webhook, email over SMTP, a desktop toast.
7. **The web app's pages are a fixed list** (`router.ts`, `App.vue`). Plan section 3 wanted navigation built from what plugins add. A capability can still add its view by hand first; a plugin-driven nav can come when there are three or more.
8. **Signed-in pages need a saved sign-in.** Tests log in with steps each run. Scraping, watching and automation want to sign in once (by hand, on the live view) and reuse it: a saved Playwright `storageState` per site key, kept between runs. Secrets are half there already: YAML steps read `${env.NAME}` from the machine's environment and mask those values in logs and kept texts (`packs/yaml/run.ts`). What is missing is a place to keep them that isn't the environment, such as named secrets in the data folder set from Settings.

## 4. Capabilities

Sizes are rough, counted in PRs of the kind the project has been merging (one PR is about a day of focused work with tests, docs and screenshots). S is 1 to 2 PRs, M is 3 to 4, L is 5 or more.

### 4.1 Schedules and alerts

**What people get.** "Run the smoke pack every hour", "run the bench every night at 2", "check this page every 15 minutes", and a message on the phone when something goes wrong or comes back. A schedules page with next and last runs, pause a schedule, run now.

**How it fits.** A `schedules` plugin: a table of schedules (cron-like expression or "every N minutes", time zone, what to start as an action name plus input, enabled), a timer in the server that starts due ones through the same action registry, so it can start anything any plugin offers. An `alerts` plugin: channels (webhook, ntfy, Discord, Slack, SMTP, desktop toast) and rules ("when a run of pack X ends broken or failed", "when it passes again", "when a watch sees a change") built on the event log. Both are general and help testing first.

**Questions it raises.** The server has to be running. On the PC that means "start Watchwright when I sign in" (a shortcut in the Startup folder or a Task Scheduler entry made with plain PowerShell, never compiled code). Missed times while the server was off: run once on start, or skip (a per-schedule choice, default "once").

**Reuses.** Actions, events, settings, runs. **Size: M** (schedules S, alerts S, start at sign-in and the pages).

**Similar tools.** Checkly and Uptime Kuma schedule checks; cron plus `npx playwright test` is the do-it-yourself version, with nothing to watch and no store.

### 4.2 Synthetic monitoring (uptime for flows)

**What people get.** A test pack on a schedule is synthetic monitoring: "can people still sign in and check out?" every 10 minutes, with a status board (up, down, since when), response and step timings over time, and the video of the run that broke. This is what Checkly sells as Playwright Check Suites, but local and watchable.

**How it fits.** Almost nothing new once 4.1 exists: a status view over runs started by schedules, per pack or per test, with uptime percentages and timing charts (`chart.ts`, `runstats.ts` already exist), and an alert rule that fires once per state change instead of every run.

**Reuses.** Runs, test history, charts, alerts. **Size: S** on top of 4.1.

**Limits.** It monitors from one machine; that machine being off or offline looks like the site being down. The status board says "no check ran" rather than "down" in that case.

### 4.3 Extraction (scraping)

**What people get.** Pull structured data from pages: a product list into a table, every job posting with title, place and link, prices from a shop, results behind a login. Pagination and "load more". Output as a dataset they can browse on the web page and download as CSV, JSON or JSON Lines, or read from the CLI and MCP. Agents get a tool that returns records from a page in the person's real browser.

**How it fits.** An `extract` plugin with a job kind `extract` and a `datasets` store (`datasets`, `datasets_records`: dataset, run, attempt, record key, JSON, first and last seen).

- **YAML recipes**, in the pack beside tests, using the same steps and targets as tests:

  ```yaml
  name: Products
  start: /catalog
  steps:
    - click: { role: button, name: Accept cookies }
  items:
    each: { css: ".product-card" }
    fields:
      title: { role: heading }
      price: { text: /\d+[.,]\d\d/, as: number }
      link: { role: link, attr: href, as: url }
    key: link
  next: { role: link, name: Next }
  ```

- **TypeScript**: `h.record(dataset, value)` and `h.extract(spec)` in any job, tests included, so a test can keep data too.
- **API capture**: many sites load their data as JSON. The `responses` collector already matches responses; an `api` source turns matched JSON into records (with a path into the JSON), which is faster and sturdier than reading the DOM.
- **Picking fields on the live view**: in a Record session, "pick field" mode turns a clicked element into a field target with `candidatesOf`, and "pick list" finds the repeating parent (the same element shape repeated as siblings).
- **Agents**: `extract_page` (one-shot: URL plus fields, returns records), and explore, then save a recipe with `packs.write`.

**Reuses.** Sessions, live view, YAML targets, Record, explore, collectors, events (records stream into the live page), runs (an extraction is a run with attempts, so pause, resume and video come free). **Size: L** (job kind and dataset store; YAML recipe; pages for datasets; field picking in Record; agent tools and docs).

**Similar tools.** Crawlee (the open-source library from Apify: crawlers on Playwright, request queues, datasets, proxy and session rotation, no live view or store UI), Browse AI (no-code "robots" trained by clicking, cloud, monitors on a schedule), Firecrawl (API that turns URLs into Markdown or JSON with an LLM, cloud), Apify actors. Watchwright's place: local, watchable, signed in as you, recipes in your repo, your agent writes them.

**Etiquette.** Default to a polite pace (one browser, a delay between pages), say in the docs that people are responsible for a site's terms, and keep secrets out of datasets (collectors already redact headers).

### 4.4 Change watching (visual and content)

**What people get.** "Tell me when this page changes": a price drops, a product is back in stock, a job is posted, a policy page is edited, a dashboard turns red, a layout breaks. Each watch shows a history of versions with text and image diffs, and alerts on a change that matters (ignore timestamps, ads; only a part of the page; only when a number crosses a line).

**How it fits.** A `watch` plugin with a job kind `watch`: steps to get to the state (log in, open a tab), what to compare (a region's text, an extraction's records, a screenshot of a region or the page), filters (ignore patterns, numeric thresholds, "added lines only"), and a store of snapshots per watch. Each scheduled run compares with the last snapshot and emits `watch.changed` for alerts. Visual compare uses the image diff already in the web app, with a pixel threshold and masked regions, done server side.

**Reuses.** Schedules and alerts (4.1), extraction (4.3) for "the records changed", text and image diffs, Record to point at the region, the live view to see why a check broke. **Size: M** after 4.1 and with 4.3 (S to M without 4.3, text and screenshots only).

**Similar tools.** changedetection.io (open source, self-hosted; Playwright "browser steps" to log in or click before checking, a visual selector for the region, restock and price detection, many notification channels through Apprise), Visualping and Distill (cloud and extension). Watchwright adds the live view, full video of each check, and agents setting watches up.

### 4.5 Crawling and site audits

**What people get.** Start from one or more URLs and follow links under rules (same site, include and exclude patterns, depth, a page limit, respect `robots.txt`), doing something on every page: run an extraction recipe, or audit the page. A site audit is the first thing most people want: broken links and images, console errors, failed requests, missing titles and alt text, accessibility problems (axe-core), slow pages, mixed content, with a report grouped by problem.

**How it fits.** A `crawl` plugin with a job kind whose items are pages found while it runs (seam 2 in section 3), a request queue in the store so a crawl resumes after a crash, de-duplication by normalised URL, and per-page actions from the other plugins (extract, audit checks as collectors). Several browser pages in one run would speed it up; one page at a time is the right start, since that is what the live view shows well.

**Reuses.** Collectors (console errors and failed requests are audit checks already), extraction, runs and resume, the store. **Size: L** (dynamic items and the queue, rules and robots, audit checks and report, pages).

**Similar tools.** Crawlee and Scrapy (crawling libraries), Screaming Frog and Sitebulb (desktop site auditors), Lighthouse CI and Unlighthouse (performance and accessibility over many pages).

### 4.6 Automation (tasks with inputs)

**What people get.** Run a recorded flow as a task, with inputs, on demand or on a schedule: fill a form, download a monthly report, post an update, do the same thing for every row of a CSV ("for each customer, open their page and export the invoice"). Outputs are files (downloads) and records. The person watches the first rows and lets it go, or pauses when something looks wrong.

**How it fits.** A `tasks` plugin, or a mode of packs: a task is YAML steps with declared inputs (the pack `params` shape), run once per input row as attempts, with downloads saved as artifacts. It changes things on real sites, so tasks are `destructive` for agents (approvals already exist), and a task can ask to stop for confirmation at a step ("pause before submit").

**Reuses.** YAML steps, Record, params, attempts and pause, approvals, sign-in profiles (seam 8). **Size: M.**

**Similar tools.** Browser automation in n8n, Zapier and Make (cloud, no live view), Power Automate Desktop on Windows, AI browser agents (browser-use, Stagehand, Browserbase): those choose the clicks with an LLM each time; Watchwright runs fixed recipes your agent wrote, which is cheaper and repeatable.

### 4.7 Smaller ideas, most of them testing add-ons

These fit into testing or into one of the plugins above rather than being capabilities of their own. They are listed so they aren't lost, not proposed now.

- **Visual regression**: baseline screenshots per test with masked regions and an approve-new-baseline button. Strong testing feature, shares the server-side image compare with 4.4.
- **Accessibility checks** (`h.a11y()` with axe-core) and **performance metrics** (Web Vitals per step). Shared with the crawl audit.
- **Network mocking and HAR record and replay** (`page.routeFromHAR`): make tests independent of a flaky backend.
- **Page capture service**: a list of URLs to PDF, full-page PNG or MHTML, for archives and reports. Small, and falls out of 4.3's job kind.
- **API steps** in YAML (`request:` through Playwright's request context), for setup and for checking a backend.

## 5. How they depend on each other

```
sign-in profiles and secrets ──┬──> extraction ──┬──> change watching
                               │                 └──> crawling (extract on every page)
schedules and alerts ──────────┼──> synthetic monitoring
                               ├──> change watching
                               └──> automation on a schedule
job-kind seam (section 3) ─────> every new job kind
```

## 6. Comparison at a glance

| Tool | Kind | Watch live and take over | Your signed-in browser | Agents | Where it runs |
|---|---|---|---|---|---|
| Crawlee | Library for crawling and scraping | No | If you set it up | No | Your code |
| Browse AI | No-code extraction and monitors | No | Cookies uploaded | API | Cloud |
| Firecrawl | URL to Markdown or JSON (LLM) | No | No | API, MCP | Cloud or self-hosted |
| changedetection.io | Change watching | No (a screenshot of the step) | Browser steps | API | Self-hosted |
| Checkly | Synthetic monitoring on Playwright | No (traces after) | Through scripts | CLI | Cloud |
| Uptime Kuma | Uptime checks | No | No | No | Self-hosted |
| n8n, Zapier | Workflow automation | No | No | Yes | Cloud or self-hosted |
| browser-use, Stagehand | AI drives the browser | Some | Some | Built in (their LLM) | Your code or cloud |
| **Watchwright** | Watched browser jobs | **Yes** | **Yes** | **CLI, MCP, skill (your agent)** | **Your machine** |

## 7. Recommended order

1. **Groundwork plus schedules and alerts (4.1) and synthetic monitoring (4.2).** The job-kind seam (section 3, items 1 and 3) lands here, though `test` is still the only kind. It is the smallest step, it makes testing itself better right away (nightly bench, uptime for flows), and every later capability needs schedules and alerts. It also keeps faith with "testing first": the first step past testing is still mostly for tests.
2. **Extraction (4.3)** with sign-in profiles and secrets (seam 8). The capability Dumi named first, the biggest piece, and the base for watching and crawling.
3. **Change watching (4.4).** Small once 1 and 2 exist, and very visible.
4. **Crawling and site audits (4.5).** Needs the dynamic-plan seam; reuses extraction and collectors.
5. **Automation (4.6).** Last, because it changes real sites and leans on everything above (profiles, approvals, schedules).

Each step gets its own plan in `docs/plans/` and, where it needs it, a deeper research note (for example on server-side image compare, or on the dataset store) before its build, as before.

If scraping should come first instead, swap 1 and 2: extraction does not need schedules. Then the job-kind seam moves into the extraction step, and watching waits for schedules.

## 8. Risks

- **Scope creep in the core.** Each capability adds a plugin; the core gets only seams (job kinds, dynamic items, plugin pages). Plugins share code through services, as now.
- **The server must be up for schedules.** Covered by "start at sign-in" and honest "no check ran" states.
- **Legal and polite use of scraping and crawling.** Polite defaults, `robots.txt` on by default for crawls, docs that say the person is responsible.
- **Secrets.** Saved sign-ins and secrets live in the data folder, never in the repo or packs; logs, events and screenshots of typed secret values are masked where Watchwright can (logs and events; a typed value's field can be masked in screenshots with Playwright's `mask`).
- **One machine.** Everything runs on one PC; parallel browsers or remote workers are out of scope until a capability needs them.

## 9. Questions for Dumi

1. **Order.** Section 7's order (schedules and monitoring first, then extraction), or extraction first?
2. **Where non-test jobs live.** Recommended: in packs. A pack is "a folder of jobs for one site": `tests/`, plus `extract/`, `watch/` and `tasks/` folders, sharing the site key, params, browser and sign-in. The alternative is separate top-level folders per capability, which splits a site's work in two places.
3. **Start at sign-in on Windows.** OK to offer it as a setting (a shortcut in the Startup folder, made with plain PowerShell)?
4. **Alert channels for the first version.** Recommended: webhook, ntfy, Discord and desktop toast first; Slack and email after.

## 10. Sources

- The code at 0.5.0: `jobs/kind.ts`, `plugins/runs/engine.ts` (`prepare`, `kinds`), `plugins/runs/plugin.ts`, `plugins/testing/collectors.ts`, web `router.ts`, `notify.ts`, `ImageDiff.vue`.
- Crawlee docs (crawlee.dev): `PlaywrightCrawler`, request queue, datasets, sessions.
- changedetection.io (README and docs): Playwright browser steps, visual selector, restock and price detection, Apprise notifications.
- Browse AI product pages and 2026 reviews: robots trained by clicking, monitors, cloud.
- Checkly docs: Playwright Check Suites, synthetic monitoring, comparison page.
- Firecrawl, Uptime Kuma, Visualping, Distill, n8n, browser-use and Stagehand product docs, for the comparison table.
- Playwright 1.64 docs: `storageState`, `routeFromHAR`, `screenshot({ mask })`, `request` context.
