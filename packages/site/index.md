---
layout: home

hero:
  name: Watchwright
  text: Browser runs you can watch, pause, fix and score
  tagline: Long test and benchmark runs on Playwright, on your own machine, driven by your own AI agent while you look on.
  image:
    light: /logo-light.svg
    dark: /logo-dark.svg
    alt: ""
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Watchwright or Playwright Test?
      link: /guide/watchwright-or-playwright-test

features:
  - title: Bench your AI feature across models
    details: One pack runs per model or setting, every attempt keeps its screenshots, text and video, a rubric scores it, and Compare lines the runs up side by side.
    link: /guide/reviewing
    linkText: Reviewing results
  - title: Let your agent test and fix your site while you watch
    details: Claude Code, Codex or any MCP client starts runs, reads results and writes tests. You see the browser live, and anything that deletes data waits for your approval.
    link: /guide/agents
    linkText: Agents
  - title: Check your site on a schedule
    details: Schedules start runs by themselves and alerts reach your phone or chat. The attempt that broke keeps its video, trace and log.
    link: /guide/schedules
    linkText: Schedules
  - title: Watch it
    details: Every run streams a live picture of the browser to Watchwright's web page, with the current test, step and log.
  - title: Control it from the page
    details: Start, pause, resume, retry, skip and stop runs, then review what each test saved, from screenshots and text to video and Playwright traces. Or schedule them, and get an alert when one fails.
  - title: Test any site
    details: Write test packs for your own websites, as a folder with a pack file and test files in the familiar Playwright style.
  - title: Let your agents drive
    details: Everything the page does is an API call. AI coding agents such as Claude Code, Codex or any MCP client get it through a CLI, an MCP server and an agent skill. Watchwright has no AI assistant of its own.
  - title: Built to grow
    details: Every capability is a plugin on one core of browser sessions, jobs, events and actions. Testing comes first; scraping and crawling can follow without reworking the base.
  - title: Safe on your machine
    details: The server listens on 127.0.0.1 and refuses requests from other web pages open in your browser.
---

<div class="ww-status">

**Try it in one command:** `npx watchwright demo` starts a run of the TodoMVC example pack against Playwright's public demo app and opens it.

**Status: early.** The run engine, test packs (in code or YAML), the live view, reviews, the editor, recording, schedules, alerts, secrets, saved sign-ins, the HTTP API, the command line, the MCP server and the agent skill work.

![A run in progress on the Watchwright web page, with the live browser picture, the controls and the plan](/web-page.png)

</div>
