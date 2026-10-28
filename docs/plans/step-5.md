# Step 5 plan: a CLI, an MCP server and an agent skill

Status: planned (2026-10-28). [docs/plan.md](../plan.md) holds the base design; this step builds its third rule ("one action registry feeds every door", section 3). The research behind this plan is in [docs/research/step-5-agents.md](../research/step-5-agents.md).

Steps 1 to 4 made Watchwright run, show, review and write tests from its web page and its HTTP API. This step gives a person's own AI agent the same reach: a CLI for agents with a shell, an MCP server for agents without one, and a skill that teaches either of them how to use Watchwright well. The person watches the agent work on the web page, as they watch a run, and can pause or take over at any time.

Everything here is general. Nothing is for one site, one pack or one agent.

## 1. What step 5 delivers

At the end of step 5:

1. **An agent with a shell** (Claude Code, Codex, Cursor) uses `watchwright` commands: `status`, `run`, `wait`, `results`, and every action of every plugin as `watchwright <plugin> <verb>`, with JSON output and exit codes it can rely on.
2. **An MCP client** connects to `http://127.0.0.1:7420/api/v1/mcp` (or starts `watchwright mcp` over stdio) and gets about twenty tools: packs, files, runs, waits, results with screenshots as images, reviews and exploring.
3. **An agent explores a page** in a browser the person sees on the live view: it sends steps, gets back an aria snapshot with element refs and a screenshot, and the steps that worked come back as YAML for a test.
4. **An agent learns the rules from a skill**: `watchwright init-agent` (or Settings > Agents on the web page) writes the Watchwright skill into a project for Claude Code and Codex, plus the MCP setting for the agents that read one from the project.
5. **The person sees who does what**: runs and explore sessions show the agent that started them, an agent's explore session shows on the Runs page with a Watch button, and Settings > Agents shows how to connect each agent and which ones called lately.

Not in step 5: an AI of Watchwright's own (never), MCP Tasks (too few clients support them; bounded waits do the job, research section 2), approving agent actions on the web page (section 6), taking over a *running test* from the live view (docs/plan.md step 7), and publishing to npm (section 9).

## 2. The action contract grows

An action (`actions/registry.ts`) gets three optional fields. Everything else in this step reads them, so a plugin added later reaches agents by declaring its actions, as docs/plan.md section 3 promised.

```ts
defineAction({
  name: "runs.start",
  // …as today…
  agent: { tool: "start_run", say: "Start a run. It shows live on the web page; tell the person its address." },
  destructive: false, // true: deletes data or stops the server
  output: { type: "object", properties: { … } }, // optional JSON Schema of `data`
});
```

- `agent.tool`: the action is an MCP tool under this name (snake_case, checked unique like names and routes). `agent.say` is extra text for agents, added to the title in the tool's description and in CLI help.
- `destructive`: `runs.delete`, `runs.presets.delete`, `packs.remove`, `packs.file-delete`, `core.stop`. MCP never offers these (section 6); the CLI asks first, or takes `--yes`.
- `output`: where given, MCP sends it as the tool's `outputSchema` with `structuredContent`; it is optional because most clients read the text.
- `GET /actions` returns the new fields, so the CLI and the stdio MCP bridge build themselves from a running server and see every plugin's actions.
- MCP tool annotations come from the method and the flag: `GET` is `readOnlyHint`, `destructive` is `destructiveHint`.

New actions this step needs, useful from every door:

| Action | Route | What it does |
|---|---|---|
| `runs.wait` | `GET /runs/:id/wait` | Waits until the run pauses, ends, or `timeout` seconds pass (default 60, at most 110), then returns the run's summary, what happened since `after` (attempts finished, flags, the pause reason) and a new cursor. Built on the event log's bounded wait. |
| `runs.summary` | `GET /runs/:id/summary` | A run in a few lines an agent can read: status, counts by outcome, and per attempt its test, outcome, first error line, flags and findings counts, score and result address. `runs.get` stays the full document. |
| `runs.control` | `POST /runs/:id/control` | One door for `pause`, `resume`, `retry`, `skip`, `stop` (after this test) and `stop-now`, so agents get one tool instead of six. The existing per-verb routes stay. |
| `runs.file` | `GET /runs/:id/file` | One file of a run by its path in the results (a screenshot, kept text, log, collector file): `{ mimeType, size, encoding, data }`. Images over 5 MB, or taller than 8000 px, come back as their size and address instead of the bytes. |
| `packs.write` | `POST /packs/:id/write` | Write a pack file whether it exists or not (create or save without the stale check), then rebuild and return the pack's load problems and, for a YAML test, its check. The editor keeps its own careful routes. |
| `agents.*` | section 5 | The skill, installing it, and the agents seen lately. |

## 3. The CLI

`watchwright` keeps `serve` and gets more commands. All but `serve`, `mcp` and `init-agent` talk to a running server over HTTP.

```text
watchwright status                          # is the server up, what runs are going, its address
watchwright run <pack> [test…] [--param k=v]… [--preset name] [--label …] [--wait]
watchwright wait <run> [--timeout 110]       # one bounded wait; exit code says how it ended
watchwright results <run> [--attempt id]     # the summary, or one attempt's result document
watchwright <plugin> <verb> [args]           # any action: watchwright runs pause 42, watchwright packs list
watchwright actions                          # every action with its input, as the server has them
watchwright mcp                              # an MCP server on stdio (section 4)
watchwright init-agent [folder]              # the skill and MCP settings for agents (section 5)
```

- **Generated commands.** `watchwright runs presets save …` is the action `runs.presets.save`. Path parameters can be given in order (`watchwright runs pause 42`); every input property is a flag, typed from its JSON Schema (`--tests a,b` for arrays, `--params '{"lang":"de"}'` or `--param lang=de` for objects, `--no-x` for false). `--input file.json` or `--input -` sends a whole body. `watchwright <plugin> <verb> --help` prints the action's title, `agent.say` and flags from its schema.
- **Packs by name.** Wherever an action wants a pack id, the CLI also takes the pack's name or its folder, and says which pack it picked.
- **Output.** Generated commands print the `data` as JSON on stdout. `status`, `run`, `wait` and `results` print short readable text, and `--json` prints the data instead. Errors go to stderr (as the error envelope with `--json`).
- **Exit codes.** 0 done; 1 the action failed (the error says why); 2 bad usage; 3 no server answers. `wait` and `run --wait`: 0 the run ended with every attempt passed, 4 it ended with a failure or broken attempt, 5 it paused (on a broken test, or a person paused it), 6 the wait timed out while it still runs. An agent loops on 6.
- **Which server.** `--server <address>`, else `WATCHWRIGHT_URL`, else `http://127.0.0.1:7420/`. A command that finds no server says how to start one and exits 3; it doesn't start one by itself, since a CLI call should not leave a server behind.
- **Who is calling.** The CLI sends `x-watchwright-client`: `--as <name>`, else `WATCHWRIGHT_CLIENT`, else the agent it finds in the environment (Claude Code sets `CLAUDECODE`; Codex and Cursor are checked during the build), else `cli`.
- **Destructive actions** ask "Delete run 42 and its files? [y/N]" on a terminal and need `--yes` otherwise.
- **`run --wait`** prints one line per finished attempt and the pause or end, and waits in bounded steps, so a long run never blocks longer than one wait.

## 4. The MCP server

A new built-in plugin, `agents`, mounts the MCP endpoint and owns sections 4 and 5.

**Doors.**

- **Streamable HTTP** at `/api/v1/mcp` on the server itself, through `@modelcontextprotocol/server` 2.x and `@modelcontextprotocol/node`. This is the default way to connect: it needs no path on disk, only the address. The request guard applies as for every request (a loopback `Host`, and an own `Origin` or none; MCP clients send none). Sessions (`Mcp-Session-Id`) live in memory and keep the client's name.
- **stdio**: `watchwright mcp` for clients that only start processes (Claude Desktop's local servers). It is a bridge: its tools come from the server's `GET /actions` and its calls go to the server over HTTP, so both doors behave the same. When no server answers, it starts `watchwright serve --no-open` in the background (detached, so the server outlives the bridge and its runs keep going) and prints the address to stderr; `--no-start` turns that off.

**Tools.** The tools are the actions with `agent.tool`, plus two that reach the rest:

| Tool | Action | Notes |
|---|---|---|
| `list_packs`, `get_pack` | `packs.list`, `packs.get` | Tests with metadata, parameters, flag kinds, load errors. |
| `list_pack_files`, `read_pack_file`, `write_pack_file` | `packs.files`, `packs.file`, `packs.write` | Writing returns load problems at once. |
| `check_test` | `packs.check-yaml` | Checks a YAML test's text without saving it. |
| `test_format` | `packs.yaml-schema` | The YAML test format's JSON Schema. |
| `start_run` | `runs.start` | Packs by id or name (the tool resolves names). |
| `list_runs`, `get_run` | `runs.list`, `runs.summary` | |
| `wait_for_run` | `runs.wait` | At most 110 s, then call again. |
| `control_run` | `runs.control` | pause, resume, retry, skip, stop, stop-now. |
| `get_attempt` | `runs.attempt` | The result document (schemaVersion 1). |
| `get_file` | `runs.file` | Screenshots come back as **image content**, so a model sees them; texts as text. |
| `get_rubric`, `save_review` | `reviews.rubric`, `reviews.save` | Reviews are filed under the agent's name. |
| `explore_start`, `explore_do`, `explore_look`, `explore_stop` | `record.start`, `record.do`, `record.look`, `record.stop` | Section 4.1. |
| `list_actions`, `call_action` | `core.actions`, any | Every other action that isn't destructive, so a plugin's actions are reachable before anyone gives them a tool. |

That is 24 tools, in the range of Playwright MCP's own. Each description is the action's title plus `agent.say`, so the docs site, `GET /actions`, CLI help and MCP all say the same thing.

**Results.** Text content is the `data` as compact JSON; tools with an `output` schema also send `structuredContent`. Errors come back as `isError` with the error's message and code, so the agent can read and fix them. A run paused by a person reads as `"status": "paused", "pausedBy": "Dumi"` in the next wait, so the agent knows to stop and ask, not to retry.

### 4.1 Exploring

An agent explores in a **record session** (step 4's Record), driven by steps instead of clicks. The person watches it on the live view exactly like a recording.

- `explore_start { pack, url?, test?, upTo? }` is `record.start` with the agent as `startedBy`; with `test` and `upTo`, the test's steps up to there run first ("Record from here"), so an agent can explore from the middle of a flow.
- `explore_do { session, steps }` is a new action `record.do`: it runs YAML steps (the same steps and targets as test files, plus `ref: e4` as a target) on the session's active page, one by one, stopping at the first that fails. Each step that ran is added to the session's step list with good targets: a `ref` is turned into the element's best target and alternatives (step 4's `candidatesOf`), never kept as a ref. It returns each step's outcome and then what `explore_look` returns.
- `explore_look { session, shot? }` is a new action `record.look`: the page's URL, title, aria snapshot with refs (`mode: "ai"`), and a screenshot of the viewport as an image when asked (on by default in MCP).
- `explore_stop { session }` ends it and returns the steps as YAML, ready for `write_pack_file`.
- The person can click and type on the live view during an agent's session as in Record; those steps land in the same list, and the agent sees them in its next look.
- Sessions end after 15 minutes without a call, as recordings do when their page is closed.

## 5. The skill and `init-agent`

**The skill** ships in the package at `skill/watchwright/`:

- `SKILL.md` (short): what Watchwright is; first check `watchwright status` (or `list_packs`) and give the person the web page's address so they can watch; then the loop: look at the pack, explore, write a test (YAML first, code when YAML can't say it), check it, run it, wait in bounded steps, read results and screenshots, fix the test when the robot went wrong and report a finding when the site did. The rules: never stop or change a run the agent didn't start; never delete; when a run is paused by a person, stop and ask; a broken attempt is a robot problem until the screenshots say otherwise; keep each wait bounded.
- `references/yaml-steps.md`, `references/pack-api.md`, `references/results.md`, `references/cli.md`, `references/mcp.md`, generated from the same sources as the docs site's reference pages (the steps reference script already exists), with a test that fails when they are stale.

**`watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp]`** writes into a project (default: the current folder):

| Agent | Skill | MCP setting |
|---|---|---|
| Claude Code | `.claude/skills/watchwright/` | `.mcp.json`: `{"mcpServers":{"watchwright":{"type":"http","url":"http://127.0.0.1:7420/api/v1/mcp"}}}` |
| Codex | `.agents/skills/watchwright/` | Printed: the `codex mcp add` line (Codex keeps MCP servers in its user config) |
| Cursor | `.agents/skills/watchwright/` | `.cursor/mcp.json` |

Without `--agent` it writes for the agents whose folders it finds, else for all three. It merges into existing settings files and never removes entries; it overwrites only its own `watchwright` skill folder and says what it wrote. The same thing runs as the action `agents.install`, which Settings > Agents uses.

## 6. Guardrails

- **Deleting needs the person.** MCP never offers destructive actions, `call_action` refuses them, and the CLI asks first or needs `--yes`. The skill says not to delete. An approval banner on the web page (agent asks, person approves) waits for step 6, where budgets give it more to approve (question 2).
- **The person stays in charge.** Runs and explore sessions show the agent that started them; the person can pause, stop or take over from the page; a pause made by a person tells the agent in its next wait.
- **Bounded everything.** No call waits longer than 110 s. Explore sessions time out.
- **Same server rules.** The MCP endpoint is behind the same request guard, loopback only. Nothing in a tool result is a secret the web page wouldn't show; parameters marked secret stay masked as they are today.

## 7. The web page

- **Settings > Agents**: the MCP address with a copy button; for Claude Code, Codex, Cursor and Claude Desktop the exact line or JSON to connect, each with a copy button; **Add to a project…**, which picks a folder with the folder browser and runs `agents.install` with the agents ticked; and **Seen lately**: each agent that called in the last days, with its last call and what it started.
- **Runs page**: an agent's explore session that is going shows above the runs as a card (agent, pack, page, how long) with **Watch**, which opens the pack's editor attached to that session: the live view, the step list and Stop, like a recording the person started.
- **Run and attempt pages**: "started by" shows the agent's name as given (`Claude Code`), and reviews show who wrote them, as they already do for people.
- Every new control comes from the kit, every look and mode works, and it works at phone width. Screenshots in light, dark and phone width go in each PR.

## 8. Docs site

- **Guide: Agents** (new): connect (HTTP address, stdio, each agent), the skill and `init-agent`, what an agent can and can't do, watching and stopping an agent.
- **Reference: CLI** (new): every built-in command, exit codes, and how generated commands map to actions.
- **Reference: MCP tools** (new): the tool table, generated from the actions, with a test that the page lists exactly the tools the server offers.
- **HTTP API**: the new routes; `how-it-works.md` and `index.md` stop saying "later" about the CLI and MCP.

## 9. How step 5 is tested

- **Unit:** CLI argument parsing from schemas (types, arrays, objects, `--no-`, path parameters in order, `--input -`), exit codes, client detection, pack names to ids; tool generation from actions (names, descriptions, annotations, no destructive tools, `call_action` refusing them); the skill's front matter (name and description limits) and its references being current; `init-agent` merging settings files without losing entries.
- **Server:** `runs.wait` (returns on pause, on end, on timeout, and early when the client goes away), `runs.summary`, `runs.control`, `runs.file` (image, text, too big), `packs.write`; the MCP endpoint through the SDK client over real HTTP on a free port (initialize, list tools, call, image result, error result, the client's name as `startedBy`); `watchwright mcp` over stdio against a real server, and starting one when none runs.
- **Engine (Chromium):** an agent-style flow end to end against the fixture site: explore (`record.do` with a ref, `record.look`), stop, write the steps to a YAML test, run it, wait, read the summary and a screenshot.
- **Web:** component tests for Settings > Agents and the Runs page card.
- **With a real agent:** Claude Code in the cloud sandbox connected over HTTP, asked to write and run a test for the fixture site; on Dumi's PC (Windows, Firefox), the CLI and MCP against a spare-port server, only when no bench is running.

## 10. Pull requests within step 5

1. This plan and the research note.
2. The contract and the CLI: `agent`, `destructive` and `output` on actions; `runs.wait`, `runs.summary`, `runs.control`, `runs.file`, `packs.write`; the CLI commands; Reference: CLI.
3. The MCP server: the `agents` plugin, HTTP and stdio, the tools, images; Reference: MCP tools.
4. Exploring: `record.do` and `record.look`, refs to targets, the Runs page card and Watch; screenshots.
5. The skill, `init-agent`, `agents.install` and Settings > Agents; Guide: Agents; screenshots.
6. Sign-off after the checks with a real agent and on the PC.

Each PR ships with tests and, where the page changes, screenshots.

## 11. Open questions

1. **npm.** Watchwright isn't published, so strangers run it from a clone, and stdio MCP settings need a path to the clone (the HTTP address doesn't). Publish `watchwright` to npm in this step, so `npx watchwright` works everywhere? Recommended: not yet; get the package ready (no `private`, a clean `files` list, the skill inside) and publish when you decide the project is ready for strangers.
2. **Approvals.** Leave destructive actions out of MCP for now and build the web page's approval banner with step 6's budgets (recommended), or build the banner in this step so agents can ask to delete runs?
