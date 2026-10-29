# Writing a test pack

A test pack is a folder with a pack file and test files. It usually lives in the repository of the site it tests. Watchwright bundles it with esbuild, so TypeScript works without a build step, and it reloads the pack when you save a file, even in the middle of a run.

Tests can also be YAML lists of steps, next to code tests or in a pack with no code at all (`pack.yaml`). This page is about code; [YAML tests](./yaml-tests) has the rest.

```
my-site/watchwright/
  pack.ts
  tests/
    home.ts
    search.ts
  lib/            helpers your tests share (optional)
```

## Adding a pack

There are four ways, and they all end the same: the server loads the pack and lists its tests.

- **On the Packs page**, type or paste the folder's path. The field suggests folders as you type (Tab completes, like a terminal) and says when the folder has a pack file. A path pasted with quotes (Windows Explorer's "Copy as path"), a `file://` address and `~` all work.
- **Browse…** opens a folder browser of the server's machine: your home folder, the drives, the folders of packs already added and the folders you used recently on the side. Open the folder with the pack file and press **Add this pack**. Type to filter the list, or type a whole path and press Enter to jump there.
- In the folder browser, **Find packs here** searches the open folder and the four levels below it for pack files (skipping `node_modules`, build output and hidden folders) and adds the ones you tick. Handy for a folder of projects. The Ctrl+K command **Find packs in a folder** opens the browser ready to search.
- **When you start the server**: `watchwright serve ./watchwright` adds that folder (or reloads it when it's already added). When the server is already running, the same command adds the pack there and opens the page.

Through the [API](../reference/http-api#packs) it's `POST /api/v1/packs` with `{ "path": "/abs/path/to/my-site/watchwright" }`.

**Starting from nothing?** In the folder browser, open the folder the pack should live in and press **New pack here…**. Give it a name and the site's address, pick YAML or TypeScript, and Watchwright writes a small pack that works (a pack file, a first test that opens the site and takes a screenshot, and a `README.md`) and adds it. It never overwrites a file that's already there.

A pack's page shows its five latest runs at the top, then tabs for its README, tests, parameters, flags and rubric. On **Tests**, search by id, title, tag, file or description (every word must match), and filter by section, tag or how the latest attempts went (failing lately, flaky, passing lately, never run); the search and filters stay at the top while the list scrolls. Each test takes one line (point at a cut-off title to read it whole). In a pack with more than one section, tests sit under a row per section that folds away, and **Fold all sections** leaves only those rows; searching or filtering opens them all. The **Descriptions** switch shows each test's description under it: on by default in packs of up to 30 tests, off in bigger ones, and the browser remembers your choice. Once the pack has run, each test shows its last 20 attempts as a row of ticks (newest on the right, green passed, red failed, amber broken, grey skipped or stopped), its pass rate and its typical time. Point at a tick to see its run, date, time and values; click it to open the attempt. A tick with a notch passed only on a later try. A test is marked **flaky** when it went from passing to failing and back with the same parameter values, or passed only when it was run again; a test that started failing once and stayed that way isn't flaky, it broke. When the pack's folder has a `README.md` at its top (or `README`, `readme.markdown` and the like), the page opens on its **README** tab, rendered as on a code host, with a pencil to edit it: GitHub's Markdown (tables, task lists, footnotes, alerts such as `> [!NOTE]`) and the safe HTML tags READMEs use, like `<details>`, `<summary>`, `<kbd>`, `<sub>`, `<sup>` and `<img width>`. Scripts, styles, frames and event handlers are dropped. Links in it to other pack files open them in the [editor](./editing).

If a pack's folder moves, its card says the folder is gone; **Locate…** points it at the new folder and keeps its runs. **Remove** in the card's menu takes a pack off the list without touching its files or runs.

::: warning Pack code is trusted
Pack code runs on your machine with your permissions, like any script. Only add packs you wrote or trust.
:::

## The pack file

```ts
// pack.ts
import { pack, consoleErrors, failedRequests, responses } from "watchwright";

export default pack({
  name: "My site smoke",
  site: { key: "my-site", baseURL: "http://127.0.0.1:3000/" },
  browser: { name: "firefox", viewport: { width: 1600, height: 960 } },
  params: {
    lang: { choices: ["en", "de"], default: "en" },
    rounds: { default: 2, description: "How often the search test repeats" },
  },
  flags: { "no-card": "robot", "slow-answer": "finding", "retried": "info" },
  tests: "tests/**/*.ts",
  setup: async ({ h, params }) => {
    await h.goto(`/?lang=${params.lang}`);
  },
  collectors: [consoleErrors(), failedRequests(), responses({ match: "/api/", bodies: true })],
  run: { pauseOnBroken: true, pauseLimitMinutes: 20, trace: "problems", chapters: true },
});
```

| Option | What it does |
|---|---|
| `name` | Shown on the web page. |
| `site.key` | Runs of packs with the same key wait for each other, so two runs never change the same app at once. |
| `site.baseURL` | Relative URLs in `h.goto()` resolve against it. |
| `site.signIn` | `"saved"`: every run starts with the sign-in saved for this site key (see [Saved sign-ins](./yaml-tests#saved-sign-ins)). |
| `browser` | `name` (`chromium`, `firefox`, `webkit`), `viewport`, `headless` (default `true`; you watch through the live view), and raw Playwright `launch` and `context` options. |
| `params` | Values chosen per run. A param has a `default`, optional `choices` (with optional display `labels`: `{ q9: "Qwen3.5 9B" }`), and an optional `type` (`string`, `number`, `boolean`). Tests get them as `params`. |
| `flags` | Flags tests may raise, with their kind: `robot` (the harness or test went wrong: the attempt is **broken**), `finding` (the site did something wrong: the attempt **failed**), `info` (changes nothing). |
| `rubric` | What reviewers score each attempt on (see [Reviewing results](./reviewing)). Default: one 1-to-5 `overall` criterion. |
| `tests` | Glob(s) of test files relative to the pack file. Default `tests/**/*.{ts,mts,js,mjs}`. |
| `setup` | Runs once each time a run starts (or resumes), before the first test. Gets `{ page, context, browser, h, params, packDir, info }`; `info(key, value)` saves a fact about the run (see below). |
| `beforeAttempt`, `afterAttempt` | Run around every attempt, children too (see [Attempt hooks](#attempt-hooks)). |
| `collectors` | Record what the browser does for every attempt (see below). |
| `helpers` | Adds your own helpers to `h` (see below). |
| `idle` | Your app's busy check for `h.idle()`: resolve `true` when the app is idle. |
| `run` | `pauseOnBroken` (default `true`), `pauseLimitMinutes` (default 20), `testTimeout` in ms (default 30 minutes), `trace` (`problems` (default), `always`, `never`), `video` (default `true`), `showActions` (default `true`), `chapters` (show each `h.step` title, after the titles of the steps it runs in, as a small caption in the bottom-left corner of the live view and video, default `false`), `screencastSize`, `frameQuality`. |

## Tests

```ts
// tests/search.ts
import { test } from "watchwright";

test("S1", { title: "Search finds products", section: "Search", needs: ["H1"], runs: 2 }, async ({ h, expect, params, attempt }) => {
  await h.goto("/");
  await h.step("type the query", async () => {
    await h.fill("input[name=q]", "boots");
  });
  await h.click("button[type=submit]", { done: "#results" });
  await expect(h.page.locator("#results .card").first()).toBeVisible();
  await h.keepText("result count", "#count");
  h.metric("attempt", attempt);
});
```

`test(id, meta, body)`. The id is short and stable (`S1`, `checkout-2`); results are filed under it.

| Meta | What it does |
|---|---|
| `title`, `section`, `tags` | Shown on the web page. |
| `description` | What the test does and what a good result looks like. Shown in the pack's test list and above the review of every attempt. |
| `runs` | How many attempts: a number, a function of the params, or a table: `{ by: "model", q9: 3, haiku: 1, default: 1 }`. 0 leaves the test out of the run for those params (an optional section, a subset for one model); a run's "attempts per test" never brings it back. |
| `needs` | Tests whose saved state this one uses. Choosing this test pulls them in and runs them first. If one of them breaks, this test is skipped. |
| `inside` | The parent test whose body runs this one with `child("id")`, or a list of parents (see [Children](#children)). |
| `timeout` | Time limit per attempt in ms. Time spent paused doesn't count. |
| `review` | Changes the pack's rubric for this test: `add` (criteria of its own) and `drop` (ids of pack criteria it isn't scored on). |

The body gets `{ page, h, expect, params, attempt, attempts, last, packDir, child }`. `packDir` is the pack's folder, for files that live next to it. `expect` is Playwright's, with its auto-retrying assertions. You can also import `expect` from `playwright/test`.

### Outcomes

Every attempt ends as one of:

- **passed**: the body returned and no finding was flagged.
- **failed**: an `expect` didn't hold, or the test raised a `finding` flag.
- **broken**: anything else went wrong: an exception, a `StepError`, a `robot` flag, the time limit. A broken attempt pauses the run (unless `pauseOnBroken` is off) until you press **Retry** or **Skip**. Save a fix to the test file and it retries by itself.
- **skipped**: not run, because a test it needs broke or was skipped, its parent didn't run it, or the test called `h.skip(reason)`.
- **stopped**: the run was stopped while it ran.

Throw `StepError` (from `watchwright`) when your own helper can't do its job, so the attempt reads as broken, not failed.

### The `h` helper

Every `h` call is a pause point: Pause takes effect at the next one.

| Helper | What it does |
|---|---|
| `h.goto(url)` | Opens a URL; relative ones resolve against `site.baseURL`. |
| `h.click(target, { done?, timeout?, position? })` | Clicks. `done` (a selector that must appear, or a function that must return true) says how to tell the click worked; without it a click that had no effect isn't noticed. `position` (`{ x, y }` in pixels from the element's top-left corner) clicks that spot instead of the middle, for canvases, maps and pickers. |
| `h.fill(target, value)`, `h.press(key)`, `h.press(target, key)` | Typing. |
| `h.has(target, timeout?)` | True when the target is visible. |
| `h.step(title, fn)` | A named step: shown live, logged, a pause point, and kept with its start, end and outcome for the attempt's step timeline. Steps nest. |
| `h.idle({ timeout?, quietMs? })` | Waits for the network to go quiet and for the pack's `idle` check. |
| `h.wait(ms)` | Waits; time paused doesn't count. |
| `h.waitUntil(check, { timeout?, interval?, progress?, stallMs?, what? })` | Polls `check` until it returns true and resolves `"done"`. With `progress` (a function whose value changes while the app works) and `stallMs`, it gives up early and resolves `"stalled"` when the value stays the same that long, so a stuck spinner or a model that stopped producing output doesn't cost the whole time limit. After `timeout` (default 30 s) the attempt is broken. |
| `h.shot(name, { fullPage?, target? })` | Saves a screenshot. |
| `h.scrollShots(name, { target?, max? })` | Scrolls top to bottom, one screenshot per screen. The shots are kept as one set and show as a single strip on the attempt page. |
| `h.keepText(name, target \| { text })` | Saves text: an element's inner text, or a string. |
| `h.file(name, data, contentType?)` | Saves a file of your own with the attempt (see [Files of your own](#files-of-your-own)). |
| `h.log(msg)`, `h.note(msg)` | A log line; a note for whoever reviews the result. |
| `h.flag(name, detail?)` | Raises a flag declared in the pack's `flags`. |
| `h.metric(name, value, unit?)` | A number to keep with the result. |
| `h.save(key, value)`, `h.load(key)` | State for later tests (see `needs`). A test's saves are kept from its last attempt, when it passed or failed. |
| `h.info(key, value)` | Saves a fact about the whole run (the app's version, the model it runs on). Facts show on the run page, in Compare and in exports. |
| `h.saveSignIn()` | Saves the browser's cookies and local storage as the sign-in for the pack's site key. Call it at the end of a login test. |
| `h.secret(name)` | A secret set on Settings > Secrets (a password, a token). Its value is masked in everything the run records; see [Secrets](./yaml-tests#secrets). |
| `h.skip(reason)` | Ends the attempt as skipped, with the reason (a file it needs isn't there, the feature is off). |

A target is a Playwright selector string (`"#add"`, `"text=Checkout"`, `"role=button[name=Save]"`) or a locator (`h.page.getByRole("button")`).

### Your own helpers

```ts
// pack.ts
export default pack({
  // ...
  helpers: (h) => ({
    async openPanel(name: string) {
      await h.click(`role=tab[name="${name}"]`, { done: `role=tabpanel[name="${name}"]` });
    },
  }),
});

declare module "watchwright" {
  interface Helpers {
    openPanel(name: string): Promise<void>;
  }
}
```

### Children

Some tests only make sense inside another one, in the state it reached. Declare the child with `inside`, and call it from the parent's body where it belongs:

```ts
test("W3", { title: "Settings panel" }, async ({ h, child }) => {
  await h.openPanel("Settings");
  await child("W4");
});
test("W4", { title: "Theme switch", inside: "W3" }, async ({ h }) => {
  await h.click("text=Dark");
});
```

Choosing W4 runs W3 with it. W4's result is its own (with W3 as its parent), and a broken W4 pauses for Retry right there, inside W3.

A child's own `runs` caps it: with `runs: 2` inside a parent that makes 3 attempts, the third parent attempt's `child("W4")` does nothing and returns `"skipped"`.

A child can also have several parents: `inside: ["P1", "P2", "P6"]`. Any of them may call `child("P12")`, for example only when the state it needs came about. Each attempt number of the child runs once, in whichever parent gets to it first; a later call for the same number returns the outcome it had. Chosen alone, the child brings its first parent.

When a run ends, a planned child attempt that no parent ran is filed as skipped, so it doesn't look lost.

## Attempt hooks

`beforeAttempt` and `afterAttempt` run around every attempt, children too. They get `{ page, h, params, packDir, test: { id, title, section, tags }, attempt, attempts, last }`, and `afterAttempt` also gets the `outcome`. Use them for state some tests need set up or kept safe, picked by tag:

```ts
export default pack({
  // ...
  beforeAttempt: async ({ h, test }) => {
    if (test.tags.includes("changes-data")) await h.page.request.post("/api/backup");
  },
  afterAttempt: async ({ h, test }) => {
    if (test.tags.includes("changes-data")) await h.page.request.post("/api/restore");
  },
});
```

An error in `beforeAttempt` makes the attempt broken. An error in `afterAttempt` is logged on the attempt and the run goes on. Hooks don't run for an attempt that was stopped.

## Collectors

| Collector | Records |
|---|---|
| `consoleErrors({ warnings? })` | Console errors (and warnings) and uncaught page errors. |
| `failedRequests({ match? })` | Requests that failed, and responses with status 400 or more. |
| `responses({ match?, bodies?, maxBody? })` | Responses whose URL contains `match` (or matches a RegExp), with headers and optionally text bodies. |

Each attempt stores them as `collectors/<name>.json`. `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` and `X-Api-Key` headers are redacted.

A collector of your own is an object with a `name` and any of:

- `attach(context, record)`: called with the Playwright `BrowserContext` when the run starts (and again if Watchwright replaces a stuck context). `record(entry)` stores one JSON entry with the attempt that is running; a child attempt keeps the entries made while it ran.
- `beginAttempt(a)` and `endAttempt(a)`: called around every attempt, children too. `a` has `attemptId`, `testId`, `number`, `page`, `context`, `record(entry)`, `metric(name, value, unit?)` and `file(name, data, contentType?)`, which saves a file under `collectors/<collector>/<name>` with the attempt. Errors are logged, not fatal.

The hooks suit apps that keep their own log of what happened, like a debug log behind an API: note where the log stands in `beginAttempt`, and in `endAttempt` save what was added:

```ts
const appLog = (): Collector => {
  const seen = new Map<string, number>();
  return {
    name: "app-log",
    async beginAttempt(a) {
      seen.set(a.attemptId, (await (await a.page.request.get(new URL("/api/log", a.page.url()).href)).json()).length);
    },
    async endAttempt(a) {
      const all = await (await a.page.request.get(new URL("/api/log", a.page.url()).href)).json();
      for (const [i, entry] of all.slice(seen.get(a.attemptId)).entries()) a.file(`entry-${i + 1}.json`, JSON.stringify(entry, null, 2), "application/json");
    },
  };
};
```

Files show in the attempt's **Files** tab; text, Markdown and JSON open right there.

## Files of your own

A collector sees every attempt from the outside. When the test itself has something worth keeping, such as a file the page downloaded, an answer from the app's API or a report it put together, the test saves it with `h.file`:

```ts
test("E1", { title: "Export orders" }, async ({ h, page }) => {
  await h.goto("/orders");
  const [download] = await Promise.all([page.waitForEvent("download"), h.click("text=Export CSV")]);
  await h.file("orders.csv", { path: await download.path() });

  const stats = await (await page.request.get(new URL("/api/stats", page.url()).href)).json();
  await h.file("stats.json", JSON.stringify(stats, null, 2));
  await h.file("summary.md", `# Orders\n\n${stats.count} orders exported.\n`);
});
```

- `data` is a string, bytes (a `Buffer` or `Uint8Array`), or `{ path }` to copy a file on disk.
- The file is saved under `files/<name>` in the attempt's folder. `name` may have folders (`calls/01.md`) but can't leave the attempt's folder (`..`).
- The content type comes from the extension (`.md`, `.json`, `.csv`, `.txt`, `.log`, `.yaml`, `.xml`, `.html`, `.pdf`, images) unless you pass one.
- A name used twice in one attempt gets `-2`, `-3` before its extension, so nothing is overwritten. `h.file` returns the name it used.

In the **Files** tab, Markdown files open rendered, with a **Source** view next to **Preview**. Relative links and images in them point at files next to them, so a report can link the files it describes. Files also go into the [zip export](./reviewing#exporting), and agents read them with the `get_file` tool.

## Where results go

Each attempt has a folder in the data folder:

```
<data>/runs/<run id>/<test id>/attempt-<n>[-try-<k>]/
  01-home.png  02-result-count.txt  video-p1.webm  trace.zip  result.json  collectors/…  files/…
```

`result.json` is the same document `GET /api/v1/runs/<run id>/attempts/<attempt id>` returns, with `schemaVersion: 1`. Open a `trace.zip` with `npx playwright show-trace trace.zip`.
