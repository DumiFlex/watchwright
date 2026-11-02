# Watchwright

[![GitHub](https://img.shields.io/github/stars/DumiFlex/watchwright?logo=github&label=GitHub)](https://github.com/DumiFlex/watchwright)
[![Docker image](https://img.shields.io/badge/docker-ghcr.io%2Fdumiflex%2Fwatchwright-2496ed?logo=docker&logoColor=white)](https://github.com/DumiFlex/watchwright/pkgs/container/watchwright)
[![CI](https://github.com/DumiFlex/watchwright/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DumiFlex/watchwright/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/watchwright?color=5fa04e&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/DumiFlex/watchwright/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-dumiflex.github.io-0a7ea4)](https://dumiflex.github.io/watchwright/)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/DumiFlex?logo=githubsponsors&color=db61a2)](https://github.com/sponsors/DumiFlex)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/dumiflex)

**Browser tests you can watch live, pause, fix and review, on your own computer or your own server.**

Watchwright runs [Playwright](https://playwright.dev) tests from its own server and web page. You see the browser while each test runs, a broken step pauses the run so you can fix the test and retry it, and every attempt keeps its screenshots, video, trace and log for review. Schedules and alerts run it on its own, runs with different settings line up side by side, and AI coding agents (Claude Code, Codex, any MCP client) drive it through the `watchwright` command, an MCP server and an agent skill.

```bash
npx watchwright demo                # a first run: the TodoMVC example pack against Playwright's demo app
npx watchwright serve ./my-pack     # the server and its web page on http://127.0.0.1:7420/
npx watchwright init-agent          # the skill and MCP settings for your agents, in this project
```

Requires Node.js 22 or newer and a Playwright browser (`npx playwright install chromium`; `demo` gets Chromium for you).

For a server or a homelab there's a Docker image, `ghcr.io/dumiflex/watchwright`, with login, roles, single sign-on and runners that reach sites on your own PC: see [Self-hosting](https://dumiflex.github.io/watchwright/guide/self-hosting).

**Docs:** [dumiflex.github.io/watchwright](https://dumiflex.github.io/watchwright/) · **Watchwright or Playwright Test?** [When to use which](https://dumiflex.github.io/watchwright/guide/watchwright-or-playwright-test) · **Source:** [github.com/DumiFlex/watchwright](https://github.com/DumiFlex/watchwright) · Apache-2.0
