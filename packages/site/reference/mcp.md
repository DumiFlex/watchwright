# MCP tools

Watchwright is an [MCP](https://modelcontextprotocol.io) server, so AI agents such as Claude Code, Codex, Cursor or Claude Desktop can run your packs, follow runs, read results and look at screenshots. Every run an agent starts shows live on the web page, under the agent's name, like any other run.

## Connect

The server answers MCP at `http://127.0.0.1:7420/api/v1/mcp` while it runs (`watchwright serve`). Agents that take an address connect there:

```bash
# Claude Code
claude mcp add --transport http watchwright http://127.0.0.1:7420/api/v1/mcp
# Codex
codex mcp add watchwright --url http://127.0.0.1:7420/api/v1/mcp
```

For Cursor, add it to `.cursor/mcp.json`:

```json
{ "mcpServers": { "watchwright": { "url": "http://127.0.0.1:7420/api/v1/mcp" } } }
```

Clients that start a process instead (Claude Desktop's local servers) run `watchwright mcp`, which speaks MCP on stdio and passes every call to the server. When no server answers, it starts one in the background, which keeps running after the agent is gone, so its runs go on. `--server <address>` picks another server, and `--no-start` turns starting one off.

```json
{ "mcpServers": { "watchwright": { "command": "watchwright", "args": ["mcp"] } } }
```

Both doors offer the same tools and behave the same.

## Who is calling

Runs, pauses, reviews and approvals carry the agent's name. It is the name the MCP client gives (`claude-code` shows as **Claude Code**), unless the request sets the `x-watchwright-client` header (over HTTP) or `watchwright mcp` gets `--as <name>`.

## Tools

The tools are the [actions](./http-api) marked for agents; a tool's description is the action's title and a hint for agents. `call_action` reaches every other action, including those of plugins added later.

| Tool | Action | Does |
|---|---|---|
| `list_packs` | `packs.list` | The packs added to the server. |
| `get_pack` | `packs.get` | One pack: its tests, parameters, flag kinds and load errors. |
| `add_pack` | `packs.add` | Adds a pack by its folder. |
| `create_pack` | `packs.create` | Writes a starter pack into a folder and adds it. |
| `list_pack_files` | `packs.files` | A pack's text files. |
| `read_pack_file` | `packs.file` | Reads one, with the stamp to save it back. |
| `write_pack_file` | `packs.file-save` | Saves or creates one and reloads the pack; the answer lists load problems. |
| `delete_pack_file` | `packs.file-delete` | Deletes one, after the person approves. |
| `check_test` | `packs.check-yaml` | Checks a YAML test without saving it. |
| `test_format` | `packs.yaml-schema` | The JSON Schema of YAML tests. |
| `start_run` | `runs.start` | Starts a run. The pack can be named by its id, its name or its folder. |
| `list_runs` | `runs.list` | Runs, newest first. |
| `get_run` | `runs.summary` | A run in brief: status, counts and one line per attempt. |
| `wait_for_run` | `runs.wait` | Waits up to 110 seconds for the run to end or pause; call again with the cursor. |
| `control_run` | `runs.control` | Pause, resume, retry, skip, stop or stop now. |
| `get_attempt` | `runs.attempt` | One attempt's full result. |
| `get_file` | `runs.file` | A run's file: a screenshot comes back as an image the model can see, a text as text. |
| `delete_run` | `runs.delete` | Deletes a run, after the person approves. |
| `get_rubric` | `reviews.rubric` | What each test of a run is scored on. |
| `save_review` | `reviews.save` | Scores an attempt, filed under the agent's name. |
| `wait_for_approval` | `approvals.wait` | Waits for the person to answer an approval. |
| `list_actions` | `core.actions` | Every action, for `call_action`. |
| `call_action` | any | Calls an action by name with its input. |

Answers are the action's data as JSON text. An error comes back as a tool error with its code and message (`not_found: No run with id …`), so the agent can read and fix it.

## Asking the person

Tools that delete something (`delete_run`, `delete_pack_file`, and any destructive action through `call_action`) don't run until the person approves them on the web page; see [Approvals](../guide/safety#approvals). The call waits up to a minute; after that it answers with the approval's id, and the agent waits on with `wait_for_approval`. A refused approval comes back as a `refused` error.
