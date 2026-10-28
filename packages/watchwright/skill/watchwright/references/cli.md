<!-- Made from https://dumiflex.github.io/watchwright/reference/cli by `pnpm --filter watchwright skill-references`; edit the site page, not this file. -->

# Command line

The `watchwright` command starts the server, and talks to a running one for everything else. It is made for people at a terminal and for AI coding agents with a shell (Claude Code, Codex, Cursor): the output is short text by default and JSON with `--json`, and the exit code says how a run went.

It comes with the [`watchwright` npm package](https://www.npmjs.com/package/watchwright): run it with `npx watchwright …`, or install the package (in a project or with `--global`) to have `watchwright` itself. From a clone of the repository, run it as `node packages/watchwright/dist/cli/main.js` after `pnpm build`, or put it on your `PATH` with `pnpm link --global` in `packages/watchwright`.

## Commands

```bash
watchwright serve [pack folder…] [--port 7420] [--host 127.0.0.1] [--data <folder>] [--no-open]
watchwright status
watchwright run <pack> [test…] [--param key=value]… [--preset <name>] [--label <text>] [--wait]
watchwright wait <run> [--after <cursor>] [--timeout <seconds>]
watchwright results <run> [--attempt <id>]
watchwright actions
watchwright mcp [--no-start]
watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp]
watchwright <plugin> <verb> [args] [--options]
```

### serve

Starts the server: the web page, the [HTTP API](https://dumiflex.github.io/watchwright/reference/http-api) and the store, on `http://127.0.0.1:7420/`. It stays up between runs; stop it with Ctrl+C or **Settings > Server > Stop Watchwright**. Pack folders named after `serve` are added (or reloaded). When a Watchwright already runs on the port, `serve` adds the packs there and opens its page instead of starting a second one.

| Option | |
|---|---|
| `--port` | Port to listen on (default 7420). |
| `--host` | Address to bind. Only loopback addresses (`127.0.0.1`, `localhost`, `::1`). |
| `--data` | Folder for the database and run files (default: `WATCHWRIGHT_DATA`, else the system's app data folder). |
| `--no-open` | Don't open the web page on start. |

### status

Whether the server is up, its version and data folder, and the runs that are queued or going, each with its page address.

### run

Starts a run of a pack. Name the pack by its id, its name or its folder; name tests to run only those (the tests they need join by themselves), or none to run them all.

| Option | |
|---|---|
| `--param key=value` | A parameter value; repeat it for more. `--params '{"key": 1}'` takes JSON. |
| `--preset <name>` | Start from the pack's preset with this name; other options override it. |
| `--label <text>` | A name for the run. |
| `--attempts <n>` | Attempts for every test, instead of each test's own count. |
| `--trace problems\|always\|never` | Which attempts keep a Playwright trace. |
| `--video`, `--no-video` | Record a video per attempt, or not. |
| `--pause-on-broken`, `--no-pause-on-broken` | Pause on a broken attempt and wait for retry or skip, or go on. |
| `--wait` | Wait for the run to end or pause, printing each attempt as it finishes. |
| `--timeout <seconds>` | With `--wait`: stop waiting after this long (the run goes on). |

It prints the run's id and the address of its page, where the run shows live.

### wait

Waits until a run ends or pauses, at most `--timeout` seconds (default 100), and prints what happened meanwhile and how the run stands. When the time runs out first, the exit code is 6 and the last line gives the cursor: `watchwright wait <run> --after <cursor>` goes on from there, and doesn't answer again for a pause it already reported. Agents should wait in these short steps instead of one long call, so they can read new messages between them.

### results

A run's attempts in brief: each with its outcome, the first line of its error, and its robot problems and findings. With `--attempt <id>`, one attempt's result: its error, flags, notes, metrics and files (pass a file's path to `watchwright runs file <run> --path <path>`).

### mcp

The [MCP server](mcp.md) over stdio, for agents that start a process instead of connecting to `http://127.0.0.1:7420/api/v1/mcp`. It passes every call to the server at `--server`, and starts one in the background when none answers, unless `--no-start` is given. `--as <name>` names the caller.

### init-agent

Sets up a project for AI agents, on this machine (no server needed): the Watchwright skill where each agent looks for skills, and the MCP server in the project's settings. The folder is the current one unless given.

| Agent | Skill | MCP server |
|---|---|---|
| Claude Code | `.claude/skills/watchwright/` | `.mcp.json` |
| Codex | `.agents/skills/watchwright/` | Printed: a `codex mcp add` line to run once (Codex keeps MCP servers in its own settings) |
| Cursor | `.agents/skills/watchwright/` | `.cursor/mcp.json` |

Without `--agent`, it sets up the agents whose folders the project has (`.claude`, `.codex` or `.agents`, `.cursor`), else all three. Settings files are merged: other servers and keys stay, and a file that isn't valid JSON is left alone and named in a message. The skill's folder is replaced, so running it again updates the skill. `--no-mcp` writes only the skill; `--server` sets the address written into the settings. See [Agents](https://dumiflex.github.io/watchwright/guide/agents).

### actions

Every action the server has, with what it does. Every action is also a command.

## Every action is a command

Each [action](https://dumiflex.github.io/watchwright/reference/http-api) of every plugin is a command made from its name: `runs.pause` is `watchwright runs pause`, `runs.presets.save` is `watchwright runs presets save` (`watchwright runs.presets.save` works too).

- **Path parameters** come first, in order: `watchwright runs pause 0a1b2c3d`, `watchwright runs attempt 0a1b2c3d 4e5f6a7b8c9d`.
- **Everything else is an option**, named after the input field in either case: `--pack-id` or `--packId`. Values are typed from the action's JSON Schema: numbers, `true`/`false` (a boolean option alone means true, `--no-x` false), lists as `--tests A1,A2` or by repeating the option, objects as JSON or `key=value` (`--param lang=de` fills `params`).
- `--input <file>` sends a JSON object as the input (`--input -` reads it from stdin); options given beside it win.
- Where an action wants a pack id, the pack's name or folder works too.
- `--help` after a command lists its options from the schema.
- The answer's `data` is printed as JSON.

Actions that delete data or stop the server (`runs delete`, `packs remove`, `packs file-delete`, `runs presets delete`, `core stop`) ask y/N first when you run them at a terminal. Without a terminal (an agent's shell, a script) they wait for the person to [approve them on the web page](https://dumiflex.github.io/watchwright/guide/safety#approvals): the command prints that it is waiting and waits up to 50 seconds. It exits 0 once approved and done, 1 when refused, and 7 when nobody has answered yet; then `watchwright approvals wait <id>` waits on.

## Everywhere

| Option | |
|---|---|
| `--server <address>` | The server to talk to: an address or just a port. Default: `WATCHWRIGHT_URL`, else `http://127.0.0.1:7420/`. |
| `--as <name>` | Who is calling, shown as who started a run, paused it or wrote a review. Default: `WATCHWRIGHT_CLIENT`, else the agent the command runs under (Claude Code, Codex, Cursor, Gemini CLI, Amp and OpenCode are recognized from their environment), else `cli`. |
| `--json` | Print the data as JSON instead of text (`status`, `run`, `wait`, `results`, `actions`). |

## Exit codes

| Code | Means |
|---|---|
| 0 | Done. For `run --wait`, `wait` and `results`: the run finished and no attempt failed or broke. |
| 1 | The action failed; the message (or with `--json`, the error on stderr) says why. |
| 2 | Bad usage: an unknown command or option, or a missing argument. |
| 3 | No Watchwright answers at the address. |
| 4 | The run ended with a failed, broken or stopped attempt, or was stopped. |
| 5 | The run is paused: on a broken attempt (retry or skip it with `watchwright runs control <run> --do retry`), or by a person. |
| 6 | The wait ran out while the run still goes. Wait again. |
| 7 | An approval is still waiting for the person on the web page. Wait with `watchwright approvals wait <id>`. |
