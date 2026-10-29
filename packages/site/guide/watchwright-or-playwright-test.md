# Watchwright or Playwright Test?

Watchwright is built on the [Playwright](https://playwright.dev) library, the same one [Playwright Test](https://playwright.dev/docs/intro) (`npx playwright test`) runs on. They overlap, but they are made for different jobs. This page says which one fits, honestly. Many projects use both.

## The short answer

Use **Playwright Test** for the tests that guard every change: many short, independent tests that run in parallel in CI, on every pull request, across browsers.

Use **Watchwright** for runs you want to watch and keep: long test or benchmark runs that take minutes or hours, where a broken step should pause rather than end the run, where you score what each attempt produced, or where your AI agent does the driving while you look on.

## Where Playwright Test is the better choice

- **CI on every change.** Playwright Test runs tests in parallel workers, shards them across machines and retries flaky ones. It is made to give a fast pass or fail on a pull request. Watchwright runs a pack's attempts in order, in one browser per run, on a server you keep running.
- **Isolated tests.** Playwright Test gives every test a fresh browser context, so tests can't affect each other and can run in any order. That's the right default for a regression suite.
- **Many browsers and devices at once.** Projects run the same tests in Chromium, Firefox and WebKit, and with device presets, in one command.
- **Debugging one test closely.** [UI mode](https://playwright.dev/docs/test-ui-mode) (`--ui`) has a watch mode that reruns tests when you change them, time travel through every action with DOM snapshots, a locator picker, and the console and network logs. `--debug` steps through a test in the Playwright Inspector. The VS Code extension runs and debugs tests from the editor.
- **The ecosystem.** Reporters, fixtures, component testing, and every CI service's guides are written for it.

If that covers what you need, you don't need Watchwright.

## Where Watchwright is the better choice

- **Long runs that survive problems.** A broken step pauses the run instead of ending it. Fix the test file, save it, and press **Retry**: the next attempt uses the new code, without starting the run over. If the server stops, the run resumes where it stopped. This matters when one run costs an hour of model time.
- **Tests that build on each other.** `needs`, children (`inside` and `child()`) and saved values (`h.save`, `h.load`) let a test start from the state an earlier one reached. Playwright Test isolates tests on purpose; Watchwright lets you choose.
- **One pack, many runs, compared.** `runs: { by: "model", q9: 3, haiku: 1 }` sets attempts per parameter value, so one pack becomes a benchmark across models or configurations. A [rubric](./reviewing) scores each attempt, and **Compare** lines up runs side by side.
- **Watching while it runs.** Every run streams the browser live to the web page, with the current test, step and log, and rewind over the last 30 seconds. Video, traces, screenshots and logs are kept with each attempt, on your machine.
- **Your agent drives, you watch.** Every action is an HTTP route, a [CLI command](../reference/cli) and an [MCP tool](../reference/mcp), with an [agent skill](./agents) to go with them. Claude Code, Codex or any MCP client can add packs, start runs, read results and write tests, and anything that deletes data waits for your [approval](./safety#approvals) on the web page.
- **Runs on its own.** [Schedules](./schedules) start runs by themselves and [alerts](./alerts) tell your phone or chat how they went. The attempt that broke keeps its video, trace and log for when you look.

## What it costs to choose Watchwright

- **It's young.** Watchwright is in 0.x, built by one maintainer, and any release may change how things work. Playwright Test is mature and widely used.
- **A server, not a command.** You start `watchwright serve` and keep it running. That's what makes pausing, resuming and the live view possible, but it's one more process than `npx playwright test`.
- **Its own test format.** Packs use `test()` and `expect` in the familiar Playwright style, or YAML steps, but they aren't Playwright Test files. Moving a test across means rewriting its header and helpers, not just copying the file.
- **Not built for CI.** A run can be started from a script with `watchwright run <pack> --wait`, but sharding, parallel workers and CI reporters aren't there.

## Using both

A common split: Playwright Test guards every pull request with fast, isolated tests, and Watchwright runs the long journeys, the benchmarks and the scheduled checks you want to watch and keep. Both can live in the same repository.

To see Watchwright work before deciding, run `npx watchwright demo`. It starts a run of the [TodoMVC example pack](https://github.com/DumiFlex/watchwright/tree/main/examples/todomvc) against Playwright's public TodoMVC demo app and opens its page (see [Getting started](./getting-started#try-the-demo)).
