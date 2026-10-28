---
layout: home

hero:
  name: Watchwright
  text: Browser tests you can watch
  tagline: A test harness on Playwright that streams every run live to its own web page, lets you pause and retry from there, and gives your AI agents the same controls.
  image:
    light: /logo-light.svg
    dark: /logo-dark.svg
    alt: ""
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: How it works
      link: /guide/how-it-works

features:
  - title: Watch it
    details: Every run streams a live picture of the browser to Watchwright's web page, with the current test, step and log.
  - title: Control it from the page
    details: Start, pause, resume, retry, skip and stop runs, then review what each test saved, from screenshots and text to video and Playwright traces.
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

**Status: early.** The run engine, test packs (in code or YAML), the live view, reviews, the editor, recording, the HTTP API, the command line, the MCP server and the agent skill work.

![A run in progress on the Watchwright web page, with the live browser picture, the controls and the plan](/web-page.png)

</div>
