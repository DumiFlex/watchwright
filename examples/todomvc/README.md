# TodoMVC demo pack

A Watchwright pack without code, for the [TodoMVC demo app](https://demo.playwright.dev/todomvc) that Playwright hosts. Every test is a YAML list of steps, so this folder is also the example for writing tests in YAML.

- `pack.yaml`: the pack's name, site, browser, flags, rubric and collectors, and the steps that run before each test (open the app with an empty list).
- `tests/adding.yaml`, `tests/editing.yaml`, `tests/filters.yaml`: three sections, eleven tests.

The quickest way to try it is `npx watchwright demo`: it copies this pack into Watchwright's data folder, starts the server and starts a run, and opens the run's page. Or start Watchwright (`watchwright serve`), add this folder on the Packs page, and start a run. The tests need the internet to reach the demo app.

The format is described in the docs site's "YAML tests" guide and "YAML steps" reference.
