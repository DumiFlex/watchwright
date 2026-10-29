# Watchwright

[![npm version](https://img.shields.io/npm/v/watchwright?color=cb3837&logo=npm)](https://www.npmjs.com/package/watchwright)
[![npm downloads](https://img.shields.io/npm/dm/watchwright?color=cb3837)](https://www.npmjs.com/package/watchwright)
[![CI](https://github.com/DumiFlex/watchwright/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DumiFlex/watchwright/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/watchwright?color=5fa04e&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/DumiFlex/watchwright/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-dumiflex.github.io-0a7ea4)](https://dumiflex.github.io/watchwright/)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/DumiFlex?logo=githubsponsors&color=db61a2)](https://github.com/sponsors/DumiFlex)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/dumiflex)

**Browser test and benchmark runs you can watch, pause, fix and score, on your own machine, driven by your own AI agent.**

A browser test harness on [Playwright](https://playwright.dev). A local server runs your test packs, streams the browser to its own web page, and lets you start, pause, retry and review runs there. A broken test pauses the run for you to fix and retry; one pack can run per model and be scored on a rubric; schedules and alerts run it on its own. AI coding agents (Claude Code, Codex, Cursor, any MCP client) drive it through the `watchwright` command, an MCP server and an agent skill.

```bash
npx watchwright demo                # a first run: the TodoMVC example pack against Playwright's demo app
npx watchwright serve ./my-pack     # the server and its web page on http://127.0.0.1:7420/
npx watchwright init-agent          # the skill and MCP settings for your agents, in this project
```

Requires Node.js 22 or newer and a Playwright browser (`npx playwright install chromium`; `demo` gets Chromium for you).

**Docs:** [dumiflex.github.io/watchwright](https://dumiflex.github.io/watchwright/) · **Watchwright or Playwright Test?** [When to use which](https://dumiflex.github.io/watchwright/guide/watchwright-or-playwright-test) · **Source:** [github.com/DumiFlex/watchwright](https://github.com/DumiFlex/watchwright) · Apache-2.0
