# Writing a test pack

A test pack is a folder that lives next to the site it tests: a `pack` file that describes the site, and test files written in the familiar Playwright style.

::: info Planned
The pack API is part of the run engine, which is being built now. The shape below is the plan and can still change.
:::

## The pack file

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
});
```

- `site.key` names the site. Runs for the same site queue one after another, so they can't break each other's state.
- `params` are the values you choose when you start a run.
- `flags` are the pack's own labels for things a test can report. A `robot` flag marks the attempt `broken` (something went wrong with the test, so redo it); a `finding` flag marks it `failed` (the site did something wrong).

## Tests

```ts
// my-site/tests/home.ts
import { test } from "watchwright";

test("H1", { title: "Home loads", section: "H", runs: 2 }, async ({ h, expect }) => {
  await h.goto("/");
  await expect(h.page.getByRole("heading", { level: 1 })).toBeVisible();
  await h.shot("home");
});

test("H2", { title: "Search", needs: ["H1"] }, async ({ h }) => {
  await h.step("type a query", async () => {
    await h.fill("search", "boots");
  });
  await h.keepText("results", "#results");
});
```

Each test has a short id and metadata:

| Field | What it does |
| --- | --- |
| `title` | The name shown on the page. |
| `section` | Groups tests on the page. |
| `tags` | Free labels for picking tests. |
| `runs` | How many attempts to make. |
| `needs` | Test ids whose saved state this test uses; they run first. |
| `inside` | A parent test this test runs within. |
| `timeout` | Time limit for one attempt. |

## The `h` helper

`h` wraps the Playwright page with steps the live page can show and pause between: `goto`, `click`, `fill`, `press`, `has`, `step`, `idle`, `shot`, `scrollShots`, `keepText`, `log`, `note`, `flag`, `metric` and `save`. `h.page` is the plain Playwright page when you need it. A pack can add its own helpers on top.

::: warning Pack code is trusted
A pack is code that runs on your machine with your permissions. Only add packs you wrote or trust.
:::
