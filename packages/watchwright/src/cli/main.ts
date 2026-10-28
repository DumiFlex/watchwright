#!/usr/bin/env node
import { parseArgs } from "node:util";
import { DEFAULT_HOST, DEFAULT_PORT } from "../config.js";
import { VERSION } from "../version.js";
import { UsageError } from "./args.js";
import { Client, clientName, DEFAULT_SERVER, serverUrl } from "./client.js";
import { actionCommand, actionsCommand, EXIT, guarded, processIo, resultsCommand, runCommand, statusCommand, waitCommand, type RunOpts } from "./commands.js";
import { initAgentCommand } from "./init-agent.js";
import { mcpCommand } from "./mcp.js";
import { serveCommand } from "./serve.js";

const HELP = `Watchwright ${VERSION}

Usage:
  watchwright serve [pack folder…] [--port ${DEFAULT_PORT}] [--host ${DEFAULT_HOST}] [--data <folder>] [--no-open]
  watchwright status
  watchwright run <pack> [test…] [--param key=value]… [--preset <name>] [--label <text>] [--wait]
  watchwright wait <run> [--after <cursor>] [--timeout <seconds>]
  watchwright results <run> [--attempt <id>]
  watchwright actions
  watchwright mcp [--no-start]
  watchwright init-agent [folder] [--agent claude,codex,cursor] [--no-mcp]
  watchwright <plugin> <verb> [args] [--options]     any action, such as: watchwright runs pause 0a1b2c3d
  watchwright --version

serve      Starts the server: the web app, the HTTP API and the store. It stays up between runs.
           Pack folders given after it are added (or reloaded when already added). When the
           server is already running on the port, it adds them there and opens the page.
  --port     Port to listen on (default ${DEFAULT_PORT}).
  --host     Address to bind. Only loopback addresses for now (127.0.0.1, localhost, ::1).
  --data     Folder for the database and run files (default: WATCHWRIGHT_DATA, else the OS's app data folder).
  --no-open  Don't open the web page in the browser on start.

status     Whether the server is up, and the runs that are going.
run        Starts a run of a pack (its id, name or folder): every test, or the tests named.
  --param key=value   A parameter value (repeat it); --params '{"key":1}' takes JSON.
  --preset, --label, --attempts <n>, --trace problems|always|never, --[no-]video, --[no-]pause-on-broken
  --wait     Wait for the run to end or pause, printing each attempt as it finishes.
  --timeout  With --wait: give up waiting after this many seconds (default: no limit).
wait       Waits until a run ends or pauses, at most --timeout seconds (default 100), printing what
           happened. Exit code 6 means it still runs: wait again with --after <cursor>.
results    A run's attempts in brief, or one attempt's result with --attempt.
mcp        The MCP server over stdio, for agents that start a process (Claude Desktop). It calls the
           server at --server, and starts one in the background when none answers (not with
           --no-start). Agents that connect to an address use ${DEFAULT_SERVER}api/v1/mcp instead.
init-agent Sets up a project (default: this folder) for AI agents: the Watchwright skill where
           Claude Code, Codex or Cursor look for skills, and the MCP server in the project's
           settings (merged; Codex gets a command to run). Without --agent: the agents whose
           folders the project has, else all three. --no-mcp writes only the skill.
actions    Every action the server has. Each one is a command: its name's words, path parameters
           in order, the rest as --options (--help after it lists them). Prints the data as JSON.

Everywhere:
  --server <address>  The server to talk to (default: WATCHWRIGHT_URL, else ${DEFAULT_SERVER}).
  --as <name>         Who is calling, shown on runs (default: WATCHWRIGHT_CLIENT, else the agent
                      this runs under, such as Claude Code or Codex, else cli).
  --json              Print the data as JSON instead of text.

Exit codes: 0 done (a run passed), 1 failed, 2 bad usage, 3 no server, 4 the run had failed or
broken attempts, 5 the run is paused, 6 the run still goes, 7 an action waits for approval on
the web page.
`;

/** Takes `--name value` / `--name=value` out of the arguments. */
function takeValue(args: string[], name: string): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") break;
    if (a === `--${name}`) {
      value = args[i + 1];
      if (value === undefined) throw new UsageError(`--${name} needs a value.`);
      args.splice(i, 2);
      i--;
    } else if (a.startsWith(`--${name}=`)) {
      value = a.slice(name.length + 3);
      args.splice(i, 1);
      i--;
    }
  }
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(`--${name}`);
  const end = args.indexOf("--");
  if (i < 0 || (end >= 0 && i > end)) return false;
  args.splice(i, 1);
  return true;
}

function number(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v.trim() === "" || Number.isNaN(n) || n < 0) throw new UsageError(`--${name} takes a number, not "${v}".`);
  return n;
}

async function main(argv: string[]): Promise<number> {
  // Pack bundles carry inline source maps: errors then point at the pack's own files and lines.
  process.setSourceMapsEnabled(true);
  const command = argv[0];
  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return EXIT.ok;
  }
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }
  if (command === "serve") return serveCommand(argv.slice(1));
  if (command === "mcp") return mcpCommand(argv.slice(1));
  if (command === "init-agent") return guarded(processIo, false, () => Promise.resolve(initAgentCommand(processIo, argv.slice(1))));

  const args = argv.slice(1);
  const io = processIo;
  let asJson = false;
  return guarded(io, args.includes("--json"), async () => {
    const server = serverUrl(takeValue(args, "server"));
    const client = new Client(server, clientName(takeValue(args, "as")));
    const generated = !["status", "run", "wait", "results", "actions"].includes(command);
    if (generated) return actionCommand(client, io, [command, ...args], "watchwright");
    asJson = takeFlag(args, "json");
    if (takeFlag(args, "help")) {
      console.log(HELP);
      return EXIT.ok;
    }
    switch (command) {
      case "status":
        return statusCommand(client, io, asJson);
      case "actions":
        return actionsCommand(client, io, asJson);
      case "wait": {
        const after = number("after", takeValue(args, "after"));
        const timeout = number("timeout", takeValue(args, "timeout")) ?? 100;
        const [id, ...extra] = args;
        if (!id || extra.length) throw new UsageError("Usage: watchwright wait <run> [--after <cursor>] [--timeout <seconds>]");
        return waitCommand(client, io, id, after, timeout, asJson);
      }
      case "results": {
        const attempt = takeValue(args, "attempt");
        const [id, ...extra] = args;
        if (!id || extra.length) throw new UsageError("Usage: watchwright results <run> [--attempt <id>]");
        return resultsCommand(client, io, id, attempt, asJson);
      }
      default: {
        const { values, positionals } = parseArgs({
          args,
          allowPositionals: true,
          options: {
            param: { type: "string", multiple: true },
            params: { type: "string" },
            preset: { type: "string" },
            label: { type: "string" },
            attempts: { type: "string" },
            trace: { type: "string" },
            video: { type: "boolean" },
            "no-video": { type: "boolean" },
            "pause-on-broken": { type: "boolean" },
            "no-pause-on-broken": { type: "boolean" },
            wait: { type: "boolean" },
            timeout: { type: "string" },
          },
        });
        const [pack, ...tests] = positionals;
        if (!pack) throw new UsageError("Usage: watchwright run <pack> [test…] [--param key=value]… [--wait]");
        const params: Record<string, string> = {};
        if (values.params) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(values.params);
          } catch {
            throw new UsageError(`--params takes a JSON object, not ${values.params}.`);
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UsageError("--params takes a JSON object.");
          Object.assign(params, parsed);
        }
        for (const p of values.param ?? []) {
          const eq = p.indexOf("=");
          if (eq < 1) throw new UsageError(`--param takes key=value, not "${p}".`);
          params[p.slice(0, eq)] = p.slice(eq + 1);
        }
        const opts: RunOpts = { params, wait: values.wait ?? false, timeout: number("timeout", values.timeout) ?? Number.POSITIVE_INFINITY, json: asJson };
        if (values.preset !== undefined) opts.preset = values.preset;
        if (values.label !== undefined) opts.label = values.label;
        const attempts = number("attempts", values.attempts);
        if (attempts !== undefined) opts.attempts = attempts;
        if (values.trace !== undefined) opts.trace = values.trace;
        if (values.video || values["no-video"]) opts.video = !values["no-video"];
        if (values["pause-on-broken"] || values["no-pause-on-broken"]) opts.pauseOnBroken = !values["no-pause-on-broken"];
        return runCommand(client, io, pack, tests, opts);
      }
    }
  }).catch((err: unknown) => {
    // parseArgs reports unknown options with its own error type.
    if (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS")) {
      io.err(`${err.message}\nSee \`watchwright --help\`.`);
      return EXIT.usage;
    }
    throw err;
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    // Exit once stdout has drained, so piped JSON isn't cut off and idle connections don't hold the process.
    if (code >= 0) process.stdout.write("", () => process.exit(code));
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
