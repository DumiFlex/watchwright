# How it works

Watchwright is a server, not a command you run per test. It keeps its own run engine on the Playwright library, so it can pause a run, show it live and pick it up again after a restart.

::: info Planned
The run engine is being built now. This page describes the design in [the step 1 plan](https://github.com/DumiFlex/watchwright/blob/main/docs/plan.md); details can still change.
:::

## Runs and attempts

A **run** is a test pack, the tests you chose from it and the parameter values you gave. An **attempt** is one execution of one test inside a run: a test with `runs: 3` makes three attempts. Retrying an attempt replaces its result and keeps the old one in its history.

Every attempt ends with one outcome:

| Outcome | Means |
| --- | --- |
| `passed` | The test ran to the end and every check held. |
| `failed` | An `expect` failed, or the test reported a finding. |
| `broken` | The harness or the test code went wrong: a missing element, an exception. |
| `skipped` | The attempt didn't run. |
| `stopped` | The run was stopped while the attempt was going. |

## Watching and controlling a run

The web page shows the browser live, with the current test, step, log and queue. From the page or the API you can pause, resume, retry, skip, stop after the current test, or stop now.

A pause takes effect at the next step boundary, because Playwright can't pause in the middle of an action. The page says "pausing at the next step" until it lands. A test that breaks pauses the run and waits for you to retry or skip it.

You can fix a test file while a run is going: the next attempt uses the new code. If the server stops in the middle of a run, start it again and resume the run where it stopped, or redo only the attempts that broke.

## One event log

Everything that happens is one row in an append-only event log: a run queued, an attempt started, a step, a log line, a screenshot saved, a pause. The web page, the API's `GET /events` and the live WebSocket all read the same log, so every client sees the same story.

## Plugins

Every capability is a plugin, including the ones that ship. A plugin can bring its own database migrations, API routes, events, actions and web pages. Testing is the first capability; later ones such as scraping reuse browser sessions, the live view, pause and the store as they are.

Each operation is declared once as an action with a JSON Schema for its input and output. The HTTP route, and later the CLI command and the MCP tool, come from that one declaration.
