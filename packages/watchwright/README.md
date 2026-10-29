# Watchwright

**Browser test and benchmark runs you can watch, pause, fix and score, on your own machine, driven by your own AI agent.**

A browser test harness on [Playwright](https://playwright.dev). A local server runs your test packs, streams the browser to its own web page, and lets you start, pause, retry and review runs there. A broken test pauses the run for you to fix and retry; one pack can run per model and be scored on a rubric; schedules and alerts run it on its own. AI coding agents (Claude Code, Codex, Cursor, any MCP client) drive it through the `watchwright` command, an MCP server and an agent skill.

```bash
npx watchwright demo                # a first run: the TodoMVC example pack against Playwright's demo app
npx watchwright serve ./my-pack     # the server and its web page on http://127.0.0.1:7420/
npx watchwright init-agent          # the skill and MCP settings for your agents, in this project
```

Requires Node.js 22 or newer and a Playwright browser (`npx playwright install chromium`; `demo` gets Chromium for you).

**Docs:** [dumiflex.github.io/watchwright](https://dumiflex.github.io/watchwright/) · **Watchwright or Playwright Test?** [When to use which](https://dumiflex.github.io/watchwright/guide/watchwright-or-playwright-test) · **Source:** [github.com/DumiFlex/watchwright](https://github.com/DumiFlex/watchwright) · Apache-2.0
