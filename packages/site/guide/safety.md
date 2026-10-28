# Safety

Watchwright drives a real browser on your machine, so its server is careful about who can talk to it.

## Who can reach the server

The server listens on `127.0.0.1` only. A server on localhost is still reachable from any web page open in the same browser, through a form post or a DNS-rebinding page, so it also checks every request:

- The `Host` header must be `127.0.0.1`, `localhost` or `[::1]` with the server's port. Anything else gets `403` with the code `bad_host`.
- A request that changes something, and every WebSocket connection, must come from the server's own page. A request with another `Origin` gets `403` with the code `bad_origin`. Requests with no `Origin` at all, such as curl, scripts and agents, are allowed.

Binding to another address (`--host 0.0.0.0`) is refused until token auth is built.

## Approvals

Agents and scripts can do almost everything the web page can, with one exception: actions that delete data or stop the server wait for you. They are deleting a run, removing a pack, deleting a file from a pack, deleting a preset and stopping the server.

When an agent, a script or the command line without a terminal calls one of them, Watchwright doesn't run it. It shows a bar under the top bar on every page, saying who asks and what would happen, for example *Claude Code asks: Delete run 3f2a9c01 "Nightly" of "Checkout" (finished, 41 attempts) with its files*. The tab title starts with the number of approvals waiting, and with desktop notices on, a hidden tab shows a notice.

- **Approve** runs the action, as if you had pressed its button, and the agent gets its answer.
- **Refuse** runs nothing; the agent is told you refused.
- Nobody answers in 30 minutes: the approval expires and nothing runs. Approvals still waiting when the server stops expire too.

The caller's request is held for up to 45 seconds, less than the time MCP clients wait for an answer. If you answer in that time, it gets the result directly. After that it gets the approval to wait on (`202`, see [Approvals](../reference/http-api#approvals) in the API), so it can check back without holding a request open.

Only the web page can answer: a request to answer an approval without the page's `Origin` is refused. At a terminal, the [command line](../reference/cli#every-action-is-a-command) asks y/N instead, and a yes runs the action at once. There is no flag that skips the question.

Approvals catch an agent's mistakes; they don't stop an agent set on getting around them. Agents that only reach Watchwright through MCP can't answer or skip an approval. An agent that can run shell commands as you can send the headers the web page and the terminal send, or delete the data folder itself, so give agents that you don't trust with your files MCP access only.

## What packs can do

A test pack is code that runs on your machine with your permissions. Only add packs you wrote or trust.

## What runs save

Results, screenshots, videos and traces are written to the [data folder](./getting-started#data-folder), and the server only serves files from inside it. Collectors that save network traffic will drop `Authorization`, `Cookie` and `Set-Cookie` headers before saving.
