# Agents

AI coding agents such as Claude Code, Codex and Cursor can work with Watchwright the way you do on its web page. They can look at a pack, try the site, write a test, run it, wait for it and read the results and screenshots. Watchwright has no AI of its own; it gives your agents the tools, and you watch what they do.

## Set up a project

In the project your agent works in, run:

```bash
watchwright init-agent
```

It writes two things for each agent:

- **The skill**: how to use Watchwright well. It covers the loop (explore, write, check, run, wait, read, fix) and the rules (bounded waits, don't touch other people's runs, ask before deleting), with the YAML steps and the command line as references.
- **The MCP server** in the project's settings, so the agent gets Watchwright's tools.

Claude Code reads both at once. Codex keeps MCP servers in its own settings, so `init-agent` prints the one line to run. **Settings > Agents > Add to a project…** does the same from the web page, with a folder browser. The details are in the [command line reference](../reference/cli#init-agent).

## Connect by hand

The server answers MCP at `http://127.0.0.1:7420/api/v1/mcp` while it runs. **Settings > Agents** shows the exact line or JSON for each agent with a copy button, for the address the page is on:

```bash
claude mcp add --transport http watchwright http://127.0.0.1:7420/api/v1/mcp
codex mcp add watchwright --url http://127.0.0.1:7420/api/v1/mcp
```

Agents that start a process instead (Claude Desktop) run `watchwright mcp`, which starts the server when it isn't running. Agents without MCP can use the [command line](../reference/cli) from their shell; it prints short text, and the exit code says how a run went. Every tool is listed in [MCP tools](../reference/mcp).

## What an agent can do

- **Run and follow**: start runs of a pack (all tests or some), wait in bounded steps, pause, retry, skip and stop the runs it started, read each attempt's error, log, flags and files, and look at screenshots.
- **Explore**: open the site in a browser, read the page and click and type in it with steps. The steps come back ready to save as a test ([Exploring](../reference/mcp#exploring)).
- **Write tests**: read and save pack files, check a YAML test before saving it, and create packs.
- **Review**: score attempts against the pack's rubric, under the agent's name.

It can't delete anything on its own. Deleting a run or a file waits for you to [approve it on the web page](./safety#approvals).

## Watching an agent

- Runs an agent starts show on the Runs page and the run's page like any other, with **started by** set to the agent's name.
- An agent's explore session shows on the Runs page under **Agents exploring**. **Watch** opens it: you see its browser live and the steps as it adds them, and you can click and type along. **Stop the session** ends it.
- You stay in charge. Pause or stop any run from its page; an agent that waits on a run you paused is told you paused it, and the skill tells it to ask you before going on.
- **Settings > Agents > Seen lately** lists the agents that called in the last 30 days, with their last tool and what they started.
