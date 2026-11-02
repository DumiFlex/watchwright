---
layout: home

hero:
  name: Watchwright
  text: Browser tests you can watch, pause, fix and review
  tagline: Playwright tests with their own server and web page, on your own computer or your own server.
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
  - title: End-to-end tests of your web app
    details: Write tests in TypeScript in the Playwright style or in YAML, or record them by clicking through your site.
    link: /guide/test-packs
    linkText: Writing a test pack
  - title: Compare setups
    details: Run the same tests with different settings, such as a browser, a language or a feature flag, line the runs up side by side, and score them when a person judges the result.
    link: /guide/reviewing
    linkText: Reviewing results
  - title: Watch a live site
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
    details: On your computer the server listens on 127.0.0.1 and refuses requests from other web pages open in your browser. On a server, login with roles is always on.
---

<div class="ww-status">

**Try it in one command:** `npx watchwright demo` starts a run of the TodoMVC example pack against Playwright's public demo app and opens it.

**Status: early.** The run engine, test packs (in code or YAML), the live view, reviews, the editor, recording, schedules, alerts, secrets, saved sign-ins, the HTTP API, the command line, the MCP server and the agent skill work.

![A run in progress on the Watchwright web page, with the live browser picture, the controls and the plan](/web-page.png)

</div>
