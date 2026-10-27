# Writing a test pack

A test pack is a folder with a pack file and test files. It usually lives in the repository of the site it tests. Watchwright bundles it with esbuild, so TypeScript works without a build step, and it reloads the pack when you save a file, even in the middle of a run.

```
my-site/watchwright/
  pack.ts
  tests/
    home.ts
    search.ts
  lib/            helpers your tests share (optional)
```

Add it on the web page (**Packs → Add pack**, with the folder's absolute path) or through the [API](../reference/http-api#packs): `POST /api/v1/packs` with `{ "path": "/abs/path/to/my-site/watchwright" }`.

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
| `browser` | `name` (`chromium`, `firefox`, `webkit`), `viewport`, `headless` (default `true`; you watch through the live view), and raw Playwright `launch` and `context` options. |
| `params` | Values chosen per run. A param has a `default`, optional `choices`, and an optional `type` (`string`, `number`, `boolean`). Tests get them as `params`. |
| `flags` | Flags tests may raise, with their kind: `robot` (the harness or test went wrong: the attempt is **broken**), `finding` (the site did something wrong: the attempt **failed**), `info` (changes nothing). |
| `rubric` | What reviewers score each attempt on (see [Reviewing results](./reviewing)). Default: one 1-to-5 `overall` criterion. |
| `tests` | Glob(s) of test files relative to the pack file. Default `tests/**/*.{ts,mts,js,mjs}`. |
| `setup` | Runs once each time a run starts (or resumes), before the first test. |
| `collectors` | Record what the browser does for every attempt (see below). |
| `helpers` | Adds your own helpers to `h` (see below). |
| `idle` | Your app's busy check for `h.idle()`: resolve `true` when the app is idle. |
| `run` | `pauseOnBroken` (default `true`), `pauseLimitMinutes` (default 20), `testTimeout` in ms (default 30 minutes), `trace` (`problems` (default), `always`, `never`), `video` (default `true`), `showActions` (default `true`), `chapters` (show `h.step` titles as cards in the live view, default `false`), `screencastSize`, `frameQuality`. |

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
| `runs` | How many attempts: a number, a function of the params, or a table: `{ by: "model", q9: 3, haiku: 1, default: 1 }`. |
| `needs` | Tests whose saved state this one uses. Choosing this test pulls them in and runs them first. If one of them breaks, this test is skipped. |
| `inside` | The parent test whose body runs this one with `child("id")`. |
| `timeout` | Time limit per attempt in ms. Time spent paused doesn't count. |
| `review` | Changes the pack's rubric for this test: `add` (criteria of its own) and `drop` (ids of pack criteria it isn't scored on). |

The body gets `{ page, h, expect, params, attempt, attempts, last, child }`. `expect` is Playwright's, with its auto-retrying assertions. You can also import `expect` from `playwright/test`.

### Outcomes

Every attempt ends as one of:

- **passed**: the body returned and no finding was flagged.
- **failed**: an `expect` didn't hold, or the test raised a `finding` flag.
- **broken**: anything else went wrong: an exception, a `StepError`, a `robot` flag, the time limit. A broken attempt pauses the run (unless `pauseOnBroken` is off) until you press **Retry** or **Skip**. Save a fix to the test file and it retries by itself.
- **skipped**: not run, because a test it needs broke or was skipped.
- **stopped**: the run was stopped while it ran.

Throw `StepError` (from `watchwright`) when your own helper can't do its job, so the attempt reads as broken, not failed.

### The `h` helper

Every `h` call is a pause point: Pause takes effect at the next one.

| Helper | What it does |
|---|---|
| `h.goto(url)` | Opens a URL; relative ones resolve against `site.baseURL`. |
| `h.click(target, { done?, timeout? })` | Clicks. `done` (a selector that must appear, or a function that must return true) says how to tell the click worked; without it a click that had no effect isn't noticed. |
| `h.fill(target, value)`, `h.press(key)`, `h.press(target, key)` | Typing. |
| `h.has(target, timeout?)` | True when the target is visible. |
| `h.step(title, fn)` | A named step: shown live, logged, a pause point. Steps nest. |
| `h.idle({ timeout?, quietMs? })` | Waits for the network to go quiet and for the pack's `idle` check. |
| `h.wait(ms)` | Waits; time paused doesn't count. |
| `h.shot(name, { fullPage?, target? })` | Saves a screenshot. |
| `h.scrollShots(name, { target?, max? })` | Scrolls top to bottom, one screenshot per screen. The shots are kept as one set and show as a single strip on the attempt page. |
| `h.keepText(name, target \| { text })` | Saves text: an element's inner text, or a string. |
| `h.log(msg)`, `h.note(msg)` | A log line; a note for whoever reviews the result. |
| `h.flag(name, detail?)` | Raises a flag declared in the pack's `flags`. |
| `h.metric(name, value, unit?)` | A number to keep with the result. |
| `h.save(key, value)`, `h.load(key)` | State for later tests (see `needs`). A test's saves are kept from its last attempt, when it passed or failed. |

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

## Collectors

| Collector | Records |
|---|---|
| `consoleErrors({ warnings? })` | Console errors (and warnings) and uncaught page errors. |
| `failedRequests({ match? })` | Requests that failed, and responses with status 400 or more. |
| `responses({ match?, bodies?, maxBody? })` | Responses whose URL contains `match` (or matches a RegExp), with headers and optionally text bodies. |

Each attempt stores them as `collectors/<name>.json`. `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` and `X-Api-Key` headers are redacted.

A collector of your own is an object with a `name` and `attach(context, record)`, where `context` is the Playwright `BrowserContext` and `record(entry)` stores one JSON entry.

## Where results go

Each attempt has a folder in the data folder:

```
<data>/runs/<run id>/<test id>/attempt-<n>[-try-<k>]/
  01-home.png  02-result-count.txt  video-p1.webm  trace.zip  result.json  collectors/…
```

`result.json` is the same document `GET /api/v1/runs/<run id>/attempts/<attempt id>` returns, with `schemaVersion: 1`. Open a `trace.zip` with `npx playwright show-trace trace.zip`.
