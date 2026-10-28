# Watchwright

A browser test harness on [Playwright](https://playwright.dev) that you watch work live. A local server runs your test packs, streams the browser to its own web page, and lets you start, pause, retry and review runs there. AI coding agents (Claude Code, Codex, Cursor, any MCP client) drive it through the `watchwright` command, an MCP server and an agent skill.

```bash
npx watchwright serve ./my-pack     # the server and its web page on http://127.0.0.1:7420/
npx watchwright init-agent          # the skill and MCP settings for your agents, in this project
```

Requires Node.js 22 or newer and a Playwright browser (`npx playwright install chromium`).

**Docs:** [dumiflex.github.io/watchwright](https://dumiflex.github.io/watchwright/) · **Source:** [github.com/DumiFlex/watchwright](https://github.com/DumiFlex/watchwright) · Apache-2.0
