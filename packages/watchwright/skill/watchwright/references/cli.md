<!-- Made from https://dumiflex.github.io/watchwright/reference/cli by `pnpm --filter watchwright skill-references`; edit the site page, not this file. -->

# Command line

The `watchwright` command starts the server, and talks to a running one for everything else. It is made for people at a terminal and for AI coding agents with a shell (Claude Code, Codex, Cursor): the output is short text by default and JSON with `--json`, and the exit code says how a run went.

It comes with the [`watchwright` npm package](https://www.npmjs.com/package/watchwright): run it with `npx watchwright …`, or install the package (in a project or with `--global`) to have `watchwright` itself. From a clone of the repository, run it as `node packages/watchwright/dist/cli/main.js` after `pnpm build`, or put it on your `PATH` with `pnpm link --global` in `packages/watchwright`.

## Commands

```bash
watchwright serve [pack folder…] [--port 7420] [--host 127.0.0.1] [--data <folder>] [--no-open] [--background]
                  [--auth] [--public-url <address>]… [--trust-proxy <address>]…
watchwright demo [--port 7420] [--data <folder>] [--no-open]
watchwright status
watchwright run <pack> [test…] [--param key=value]… [--preset <name>] [--label <text>] [--wait]
watchwright wait <run> [--after <cursor>] [--timeout <seconds>]
watchwright results <run> [--attempt <id>]
watchwright actions
watchwright mcp [--no-start]
watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp] [--auth]
watchwright login [--name <name>] [--password-stdin] [--token <token>]
watchwright logout
watchwright runner [--server <address>] [--pair <code>] [--allow <list>]
watchwright users list|add|reset-password|role|disable|enable|remove …
watchwright update [--check] [--yes] [--now] [--version <version>]
watchwright <plugin> <verb> [args] [--options]
```

### serve

Starts the server: the web page, the [HTTP API](https://dumiflex.github.io/watchwright/reference/http-api) and the store, on `http://127.0.0.1:7420/`. It stays up between runs; stop it with Ctrl+C or **Settings > Server > Stop Watchwright**. Closing its console window (or Ctrl+Break on Windows) stops it the same way: runs going then are marked interrupted, ready to resume. Pack folders named after `serve` are added (or reloaded). When a Watchwright already runs on the port, `serve` adds the packs there and opens its page instead of starting a second one.

| Option | |
|---|---|
| `--port` | Port to listen on (default 7420). |
| `--host` | Address to bind (default: `WATCHWRIGHT_HOST`, else `127.0.0.1`). Any address other than `127.0.0.1`, `localhost` or `::1` (such as `0.0.0.0`) needs `--auth`. |
| `--auth` | Turn [login](https://dumiflex.github.io/watchwright/guide/safety#login) on: the web page asks people to sign in, and the CLI, scripts and agents send a token. Also `WATCHWRIGHT_AUTH=on`. The first start with no user prints a link that creates the first admin. |
| `--public-url` | An address people reach the server at, such as `https://watchwright.home.lan` behind a reverse proxy, or `http://192.168.1.20:7420`. Requests may name its host, and the web page may make changes from it. Repeat it for more than one, or set `WATCHWRIGHT_PUBLIC_URL` with commas. |
| `--trust-proxy` | The reverse proxy whose `X-Forwarded-For` and `X-Forwarded-Proto` headers count: an address or a range like `172.18.0.0/16`. Repeat it, or set `WATCHWRIGHT_TRUST_PROXY` with commas. Without it those headers are ignored. |
| `--data` | Folder for the database and run files (default: `WATCHWRIGHT_DATA`, else the system's app data folder). |

On a machine without a screen (`WATCHWRIGHT_SERVER_HOST=1`, or Linux without `DISPLAY` or `WAYLAND_DISPLAY`) browsers always run headless and folders aren't shown in a file manager; `WATCHWRIGHT_FOLDERS` keeps the web app's folder browser inside the folders it lists. See [Self-hosting](https://dumiflex.github.io/watchwright/guide/self-hosting#what-s-different-in-a-container).
| `--no-open` | Don't open the web page on start. |
| `--background` | Run the server as its own process with no window, so no terminal has to stay open. The command returns once the server answers (it waits up to 30 seconds and shows the end of the log when the server doesn't come up). The server's output goes to `logs/server.log` in the data folder (past 5 MB the old one is kept as `server.old.log`). Stop it with **Settings > Server > Stop Watchwright**. |

### demo

A first run in one command, for trying Watchwright out. It:

1. downloads Playwright's Chromium when it isn't there yet (once, about 150 MB),
2. copies the [TodoMVC example pack](https://github.com/DumiFlex/watchwright/tree/main/examples/todomvc) into the data folder, under `demo/todomvc`,
3. starts the server, or uses the Watchwright already running on the port, and adds the pack,
4. starts a run of the pack (labelled **Demo**) against Playwright's public [TodoMVC demo app](https://demo.playwright.dev/todomvc), and opens the run's page.

The run needs the internet to reach the demo app. The server keeps running afterwards, as with `serve`, and takes the same options. The pack is copied only the first time, so changes you make to it in the editor stay; delete the `demo/todomvc` folder to get the original back.

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

It keeps running while the server restarts or [updates](https://dumiflex.github.io/watchwright/guide/updating): a call made while the server is away waits for it, and when the server comes back the tools follow its actions (the client is told the tool list changed). It loads none of the server's code, so on Windows it doesn't stop npm from replacing the package.

### init-agent

Sets up a project for AI agents, on this machine (no server needed): the Watchwright skill where each agent looks for skills, and the MCP server in the project's settings. The folder is the current one unless given.

| Agent | Skill | MCP server |
|---|---|---|
| Claude Code | `.claude/skills/watchwright/` | `.mcp.json` |
| Codex | `.agents/skills/watchwright/` | Printed: a `codex mcp add` line to run once (Codex keeps MCP servers in its own settings) |
| Cursor | `.agents/skills/watchwright/` | `.cursor/mcp.json` |

Without `--agent`, it sets up the agents whose folders the project has (`.claude`, `.codex` or `.agents`, `.cursor`), else all three. Settings files are merged: other servers and keys stay, and a file that isn't valid JSON is left alone and named in a message. The skill's folder is replaced, so running it again updates the skill. `--no-mcp` writes only the skill; `--server` sets the address written into the settings. When that server has [login](https://dumiflex.github.io/watchwright/guide/safety#login) on (or with `--auth`, for a server that isn't running yet), the settings send `Authorization: Bearer` with the token from the `WATCHWRIGHT_TOKEN` environment variable: `${WATCHWRIGHT_TOKEN}` in `.mcp.json`, `${env:WATCHWRIGHT_TOKEN}` in Cursor's, and `--bearer-token-env-var` for Codex. The token itself is never written into a project. See [Agents](https://dumiflex.github.io/watchwright/guide/agents).

### login

Signs in to a server that has [login](https://dumiflex.github.io/watchwright/guide/safety#login) on, from this machine. It asks for your name and password (or takes `--name` and reads the password from standard input with `--password-stdin`), makes an API token named after the machine (`CLI on <host>`), and saves it for that server. From then on, every command and `watchwright mcp` aimed at that server sends it by themselves. `WATCHWRIGHT_TOKEN` still wins when it is set.

`--token <token>` checks and saves a token you made in **Settings › Your account** instead, which is the way in for accounts that sign in through single sign-on.

Saved tokens live in `credentials.json` in your config folder (`%APPDATA%\watchwright` on Windows, `~/.config/watchwright` elsewhere, or `WATCHWRIGHT_CONFIG_DIR`), one per server address, readable only by you.

### logout

Removes the saved token for the server, both on the server and on this machine.

### runner

Lets a server reach sites through this machine (see [Runners](https://dumiflex.github.io/watchwright/guide/self-hosting#runners)). Add the runner in the server's **Settings › Runners**, which shows the command with a pair code:

```bash
npx watchwright runner --server https://watchwright.example.com --pair 7KQ-M2X-PLD
```

| Option | |
|---|---|
| `--server <address>` | The server (default: `WATCHWRIGHT_URL`, else the one paired last). |
| `--pair <code>` | A pair code from Settings › Runners. Works once, within 15 minutes; the token it gives is saved in `runner.json` in your config folder, readable only by you. |
| `--allow <list>` | What the server may open here: `loopback` (any port on this machine; the default), `host:port` or `host:*`, comma-separated. Saved for next time; only this machine can change it. |

It runs until you stop it (Ctrl+C), reconnecting by itself when the link drops, and exits with 1 when the server removes the runner.

### users

Accounts for [login](https://dumiflex.github.io/watchwright/guide/safety#login), made on the machine the server runs on. It works on the data folder itself (`--data`, else `WATCHWRIGHT_DATA`), so it works with the server stopped, and it is the way back in when nobody can sign in. In Docker, run it with `docker exec`.

| Command | |
|---|---|
| `users list` | Every user with role and when they were last seen. |
| `users add <name> [--role admin\|user\|viewer]` | Adds a user (role `user` unless given). |
| `users reset-password <name>` | Sets a new password and ends the user's sign-ins. |
| `users role <name> <role>` | Changes the role. The last admin can't stop being one. |
| `users disable <name>` / `users enable <name>` | Stops or allows signing in; disabling ends their sign-ins. |
| `users remove <name>` | Removes the user with their sign-ins and tokens. |

Passwords (at least 10 characters) are asked for at the terminal, twice, without showing them. `--password-stdin` reads the first line of standard input instead, for scripts.

### update

Installs the newest Watchwright from npm over a global npm install (`npm install -g watchwright`). With a server running at `--server`, the server does it: it stops, runs `npm install -g watchwright@<version>` and starts again with the same options, and the command waits until it answers with the new version. With no server running, the command runs npm itself. It asks first unless `--yes` is given; without a terminal it needs `--yes`. See [Updating](https://dumiflex.github.io/watchwright/guide/updating).

| Option | |
|---|---|
| `--check` | Only say whether there is a newer version. |
| `--yes` | Don't ask first. |
| `--now` | Update even while runs go: they are interrupted and go on after the server is back. |
| `--version` | Install this version instead of the newest. |

In Docker, with npx or as a project's dependency it says how to update instead. `WATCHWRIGHT_NPM_REGISTRY` sets the registry it asks (default npm's `registry` setting, else npmjs.org).

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
| `WATCHWRIGHT_TOKEN` | An API token, for a server with [login](https://dumiflex.github.io/watchwright/guide/safety#login) on. Sent as `Authorization: Bearer`. Without it, the token [`login`](#login) saved for the server is sent. |

## Exit codes

| Code | Means |
|---|---|
| 0 | Done. For `run --wait`, `wait` and `results`: the run finished and no attempt failed or broke. |
| 1 | The action failed; the message (or with `--json`, the error on stderr) says why. |
| 2 | Bad usage: an unknown command or option, or a missing argument. |
| 3 | No Watchwright answers at the address, or it took the request and didn't answer within 60 seconds (waits get their own `--timeout` on top). |
| 4 | The run ended with a failed, broken or stopped attempt, or was stopped. |
| 5 | The run is paused: on a broken attempt (retry or skip it with `watchwright runs control <run> --do retry`), or by a person. |
| 6 | The wait ran out while the run still goes. Wait again. |
| 7 | An approval is still waiting for the person on the web page. Wait with `watchwright approvals wait <id>`. |
