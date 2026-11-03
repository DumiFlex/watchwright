# Safety

Watchwright drives a real browser on your machine, so its server is careful about who can talk to it.

## Who can reach the server

By default the server listens on `127.0.0.1` only. A server on localhost is still reachable from any web page open in the same browser, through a form post or a DNS-rebinding page, so it also checks every request:

- The `Host` header must be `127.0.0.1`, `localhost` or `[::1]` with the server's port, or the host of a `--public-url`. Anything else gets `403` with the code `bad_host`.
- A request that changes something, and every WebSocket connection, must come from the server's own page (its loopback address or a `--public-url`). A request with another `Origin` gets `403` with the code `bad_origin`. Requests with no `Origin` at all, such as curl, scripts and agents, are allowed.

Binding to another address (`--host 0.0.0.0`, for a server or a homelab) needs [login](#login) on.

## Login

Login is off by default, and nothing changes while it is: whoever can reach `127.0.0.1` is you. Turn it on with `watchwright serve --auth` (or `WATCHWRIGHT_AUTH=on`) to run Watchwright where other people or machines can reach it.

```bash
watchwright serve --auth --host 0.0.0.0 --public-url http://192.168.1.20:7420
```

- **The first admin.** On the first start with no user, the server prints a link with a one-time code: open it and choose a name and password. Or run `watchwright users add <name> --role admin` on the server's machine (see [users](../reference/cli#users)), which also works with the server stopped and is the way back in if every admin forgets their password.
- **More people.** There is no default admin or password. An admin adds people in Admin › Users, either by choosing their name and a first password, or by making an invitation link: the person opens it and chooses their own name and password, with the role you picked. A link works once and for up to 30 days; unused ones can be taken back there.
- **On a server.** The [Docker image](./self-hosting) always has login on and runs without a screen. See [Self-hosting](./self-hosting).
- **Single sign-on.** People can sign in through your sign-in provider (OpenID Connect: VoidAuth, Authentik, Authelia, Pocket ID, Keycloak) or a header your reverse proxy sets, with roles from their groups. See [Single sign-on](./single-sign-on).
- **Sharing.** A share link opens one run read-only for anyone who has it, and an admin can turn on a public status page for chosen packs. Traces and network files stay private unless a link includes them. See [Sharing](./sharing).
- **Signing in.** The web page asks for a name and password and keeps you signed in for 30 days from your last visit. After five wrong passwords for a name or an address within 15 minutes, each try waits longer, up to a minute.
- **Tokens.** The CLI, scripts and agents send an API token as `Authorization: Bearer <token>` (the CLI reads `WATCHWRIGHT_TOKEN`, or the token [`watchwright login`](../reference/cli#login) saved). A token acts with its owner's role, and a token is never the web page: destructive actions it calls still wait for [approval](#approvals). See [Login](../reference/http-api#login) in the API.
- **Roles.**

| | viewer | user | admin |
|---|---|---|---|
| See packs, runs, results, files and the live view | yes | yes | yes |
| Start, pause and stop runs, record, explore, review | | yes | yes |
| Edit YAML tests, `pack.yaml` and data files; presets, schedules | | yes | yes |
| Add, upload and move packs; change pack code (`.ts`, `.js`, `package.json`, `tsconfig.json`) | | | yes |
| Change a pack's dashboard (tiles that aren't public) | | yes | yes |
| Change what the public status page and shares show (public tiles, the runs they read) | | | yes |
| Use secrets and saved sign-ins by name | | yes | yes |
| Change secrets, saved sign-ins, settings and alerts | | | yes |
| Users, start at sign-in, clean up old runs, stop the server | | | yes |

::: warning Pack code is admin-only
A code pack (`pack.ts` and its tests) runs on the server and can read every secret, so with login on only admins add packs or change code files. Users change what Watchwright reads without running it: YAML tests, `pack.yaml` and data files. A YAML test or a recording opens only `http` and `https` addresses and uploads only files from its pack's folder. Code an admin added still runs when a user starts a run, so add only code you trust.
:::

- **Who did it.** Runs, approvals and controls name the person: `Dumi`, or `Dumi via Claude Code` for an agent with Dumi's token. An approval is answered by the person whose agent asked, or by an admin.
- **Behind a reverse proxy** (NPMplus, Caddy, Traefik), pass the address people use with `--public-url https://watchwright.home.lan`, and the proxy's address with `--trust-proxy` so the server knows a request came in over https. The proxy must pass WebSockets (the live view uses them).

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
