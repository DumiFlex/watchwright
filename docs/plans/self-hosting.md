# Self-hosting plan: login, sharing, Docker and the runner

Status: planned (2026-11-02). Research and options: [docs/research/self-hosting.md](../research/self-hosting.md), with Dumi's answers in its section 8. [docs/plan.md](../plan.md) is the base design.

Everything here is general: any team or homelab can run Watchwright on a server, sign in with its own accounts or its single sign-on, share results, and test sites that only run on someone's PC. Nothing changes for a person who keeps running Watchwright on their own PC with no login.

## 1. What this step delivers

1. **Login (optional).** Accounts with three roles: **admin**, **user**, **viewer**. Off by default on `127.0.0.1`; required before Watchwright listens on any other address.
2. **Single sign-on.** Sign in with any OpenID Connect provider (VoidAuth, Authentik, Authelia, Pocket ID, Keycloak, Google…), with group-to-role mapping. Optionally trust a forward-auth header from a named proxy.
3. **Tokens for clients.** Personal API tokens for the CLI, scripts and MCP clients; `watchwright login` and `init-agent` set them up.
4. **Sharing without an account.** Share links for one run (read-only, revocable, optional expiry) and an optional public dashboard showing the latest results of packs an admin picks.
5. **Docker.** An image on GitHub's registry for each release, a compose file that pastes into a Portainer stack, and guides for Proxmox, NPMplus, Caddy and Tailscale.
6. **The runner.** One command, copied from the page, connects a PC to the server; runs set to reach the site "from" that PC see its `localhost` exactly as the PC does.

## 2. Login

### 2.1 Turning it on

- `watchwright serve --auth` (or `WATCHWRIGHT_AUTH=on`, or the setting `server.auth`, read at start) turns login on. With login off, behavior is exactly today's.
- `--host` other than loopback is refused unless login is on. The message says how to turn it on. There is no flag that skips this.
- `--public-url <url>` (repeatable; `WATCHWRIGHT_PUBLIC_URL`, comma-separated) names the addresses people use (`https://watchwright.home.lan`). Their hosts and origins join the request guard's allowed lists; the first one is used in links (share links, MCP instructions, runner command, OIDC redirect).
- `--trust-proxy <address or CIDR>` (`WATCHWRIGHT_TRUST_PROXY`): `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For` count only from there. Without it they're ignored.

### 2.2 The first admin

On the first start with login on and no users, the log prints a setup link `…/#/setup?code=<random>`. The page shows "Create the first admin" (name, password) and refuses without the code. The code works once and dies when the server stops; a new one is printed on the next start while there are still no users. `watchwright users add <name> --admin` (run on the server, for Docker through `docker exec`; it works on the data folder directly, like `serve` does) is the other way in, and `watchwright users reset-password <name>` the way back in.

### 2.3 Accounts, sessions, tokens

New `auth` plugin. Tables: `users` (id, name, display name, role, password hash or null, source `local`/`oidc`/`header`, subject for SSO, created, last seen, disabled), `auth_sessions` (hashed id, user, created, last used, expires, user agent), `auth_tokens` (hashed token, user, name, kind `api`/`runner`, created, last used, expires).

- **Passwords:** `scrypt` from `node:crypto` (N=2^15, r=8, p=1, 16-byte salt), compared with `timingSafeEqual`. At least 10 characters; no other rules.
- **Sessions:** 32 random bytes in cookie `ww_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the request is https). Stored hashed (SHA-256). 30 days sliding, a setting. Signing out ends it; changing a password ends the user's other sessions; disabling a user ends all.
- **Sign-in throttling:** after 5 failures for a name or an address in 15 minutes, each further try waits (1 s doubling to 60 s) and is logged as an event.
- **API tokens:** `ww_` + 32 random bytes (base64url), shown once, stored hashed, named, optional expiry, last used shown. Sent as `Authorization: Bearer`. A token acts with its user's role. Runner tokens (`kind = runner`) only open the runner endpoint.

### 2.4 Roles

| | viewer | user | admin |
|---|---|---|---|
| See packs, runs, results, files, live view, schedules | yes | yes | yes |
| Reviews (rubric scores, notes) | no | yes | yes |
| Start, pause, stop, redo runs; record; explore | no | yes | yes |
| Add, edit, move packs and their files | no | yes | yes |
| Schedules, presets, share links | no | yes | yes |
| Own tokens and runners | own tokens | yes | yes |
| Secrets and saved sign-ins (use by name) | no | use | change |
| Alert channels and rules | no | no | yes |
| Users, server settings, startup, public dashboard, folders outside the packs root, stop the server | no | no | yes |

Pack code runs on the server and can read every secret, so the Users page says under "user": *Users can run code on this server through packs. Give this role only to people you trust with it.*

### 2.5 How every route is checked

- **Actions** get an optional `access: "viewer" | "user" | "admin"`. Default: `viewer` for `GET`, `user` otherwise. Admin-only actions say so. The registry checks it before the handler (and before approvals), answering `401 sign_in_needed` or `403 not_allowed`.
- **Plain routes** (files, live WebSocket, MCP, web app) declare `config: { access }` on the Fastify route. With login on, the guard hook refuses any `/api/v1` route that declares nothing, so a new route can't be open by mistake. A test walks every registered route and checks each has an access level (like the community repo's CSRF inventory).
- **Open without sign-in:** `GET /health` (only what the sign-in page needs), the sign-in, setup and OIDC callback routes, the static web app, share-link routes (section 4).
- **The hook in the plugin contract:** `definePlugin` gets `authenticate?(req)` (one plugin may provide it); `server/app.ts` calls it in the existing `onRequest` hook and puts the user on the request. That's the only change in `server/`.
- **`ActionCall`** gains `user: { id, name, role } | null`. Runs, reviews, approvals, schedules and presets record `started_by` / `by` (new migrations in each plugin), shown as "Dumi" or "Dumi via Claude Code".
- **Approvals:** "from the page" becomes "a signed-in browser session" when login is on (cookie, not token). An approval can be answered by the user whose call asked, or an admin. Without login, today's rule stays.
- **WebSockets** (live view) check the session cookie and the origin on upgrade.
- **Data scoping:** none. Everyone signed in sees the same packs and runs (a team tool). Per-user workspaces are out of scope.

### 2.6 Single sign-on

**OIDC** (`openid-client` 6, the standard Node library, no other dependencies). Settings › Sign-in (admin): issuer URL, client id, client secret (stored like a secret), scopes (default `openid profile email groups`), the claim for groups (default `groups`), and a mapping `group → role` (e.g. `watchwright-admins → admin`), plus "role for anyone else who signs in" (`none` refuses them, or `viewer`/`user`). Authorization code flow with PKCE, `state` and `nonce`; redirect URI `<public-url>/api/v1/auth/oidc/callback` shown with a copy button. A user is matched by issuer + `sub`; role is updated from groups at each sign-in when a mapping is set. The sign-in page shows "Sign in with <name>" and, unless an admin turns it off, the local form too (so a broken provider can't lock admins out). A guide page per provider: VoidAuth, Authentik, Authelia, Pocket ID.

**Trusted header** (forward auth): Settings › Sign-in: header name (`Remote-User`, `X-authentik-username`, `Tailscale-User-Login`), optional groups header, and the proxy address it must come from (requires `--trust-proxy`). A request from that address with the header signs that user in (created as the default role on first sight). Requests from anywhere else with the header are refused and logged.

## 3. Tokens for clients

- **CLI:** `watchwright login [--server <url>]` asks for a name and password (or opens the browser for SSO and takes a token through a one-time code), creates a token named after the machine, and saves it per server in the user's config folder (file mode 600). `WATCHWRIGHT_TOKEN` wins over the saved one. `watchwright logout` deletes it on both sides.
- **MCP over HTTP:** clients send `Authorization: Bearer`. `init-agent --server <url>` and Settings › Agents write the MCP settings with a header that reads `${WATCHWRIGHT_TOKEN}` (Claude Code, Cursor and VS Code expand environment variables in headers; the guide lists which do).
- **Stdio bridge** (`watchwright mcp --server <url>`) passes the saved token through.
- **Callers on loopback with login on** need a token too. No loopback exception: on a shared server, other local users and containers are loopback too.

## 4. Sharing without an account

- **Share links** for a run: Run page › Share › "Anyone with the link can see this run's results, screenshots and video", optional expiry (1 day, 7, 30, never), "include traces and network files" (off by default: they can hold cookies and tokens a site set). Link: `<public-url>/s/<random 22 chars>`. Opens a read-only page: run header, tests and outcomes, attempt details, screenshots, video, files; no live view while running (a "still running" notice that refreshes), no reviews, no settings, no menu. Secrets are already masked in everything a run records. Table `runs_shares`; Settings › Sharing lists every link with who made it, views and revoke. Viewers can't make links; users and admins can.
- **Public dashboard** (admin, off by default): Settings › Sharing › Public dashboard: pick packs (and schedules). `<public-url>/#/status` shows each one's latest run: outcome counts, when, how long, a trend of the last 20 runs; each run links to its share page when "link runs" is on (links are made and renewed automatically). Like a status page for flows.
- **Routes:** `/api/v1/shared/<token>/…` with `access: "public"`, answering only that run's data and files, rate limited per address.
- Without login on, sharing still works on loopback but the page says links only work for people who can reach this address.

## 5. Docker

- **`docker/Dockerfile`:** `FROM mcr.microsoft.com/playwright:v<version>-noble` (version read from `packages/watchwright/package.json` by the workflow as a build arg), `npm install -g watchwright@<version>`, `USER pwuser`, `ENV WATCHWRIGHT_DATA=/data WATCHWRIGHT_AUTH=on WATCHWRIGHT_SERVER_HOST=1`, `EXPOSE 7420`, `VOLUME /data /packs`, `HEALTHCHECK` on `/api/v1/health`, `CMD ["watchwright","serve","--host","0.0.0.0","--no-open"]`. A local build arg installs from a packed tarball instead, so CI and the sandbox can build the image before a release.
- **Server mode** (`WATCHWRIGHT_SERVER_HOST=1`, or Linux with no `DISPLAY`/`WAYLAND_DISPLAY`): hides "Open in file manager", start at sign-in and headed runs; the folder browser stays inside `/packs` (and other roots an admin adds).
- **`docker/compose.yml`** (paste into Portainer › Stacks): one service, `init: true`, `shm_size: 1gb`, `restart: unless-stopped`, volumes, port `7420`, environment with `WATCHWRIGHT_PUBLIC_URL` and `WATCHWRIGHT_TRUST_PROXY` placeholders. Variants: `compose.caddy.yml` (HTTPS) and `compose.tailscale.yml` (sidecar).
- **Publishing:** a `docker` job in `release.yml` after the `npm` job: builds `linux/amd64` and `linux/arm64`, pushes `ghcr.io/dumiflex/watchwright:<version>`, `:<major>.<minor>` and `:latest` with `GITHUB_TOKEN`. Since npm versions only go live once Dumi approves them, the job installs from the release's packed tarball (attached to the GitHub release), not from npm, so the image doesn't wait for the npm approval.
- **Site guide "Self-hosting":** Docker / Portainer stack, Proxmox (Docker in a VM, or in an LXC with `nesting=1`), NPMplus (proxy host, Websockets Support on, a custom location timeout for long waits), Caddy, Tailscale, updating, backup (stop, copy `/data`), and SSO provider pages.

## 6. The runner

### 6.1 Setting it up

Settings › Runners › **Add a runner** (user or admin): name ("Dumi's PC"), which ports on that machine it may reach (default: any port on localhost; or a list like `localhost:3000, localhost:8188`). The page then shows one command with a copy button, for the person's system:

```sh
npx watchwright@0.12.0 runner --server https://watchwright.home.lan --pair 7KQ-M2X-PLD
```

It is the same on Windows, macOS and Linux (it needs Node 22 or later; the page links the Node download when the command fails). The pair code works once, within 15 minutes; the runner trades it for a runner token saved in the config folder, so the token never sits in shell history. After that, `watchwright runner` alone reconnects. `--background` keeps it running with no window (as `serve --background` does), and `watchwright runner --start-at-sign-in` adds it to the user's sign-in items (off unless asked; on Windows the same Startup-folder approach as the server's). The page shows the runner as connected the moment it pairs.

### 6.2 What the runner may reach

Decided on the PC as well as on the server: the runner only opens connections allowed by its own `--allow` list (saved at pairing from the server's list, and changeable only on the PC with `watchwright runner --allow …`). Default: loopback only. A server can't use the PC to reach the rest of its network unless the PC's owner allows it.

### 6.3 How a run uses it

- Run option `network`: `server` (default) or a runner's name; the pack can set a default with `site.network` in its pack file; the New run form has "Reach the site from" (server or a runner, with its status). Schedules keep the choice.
- The engine starts a SOCKS5 listener on `127.0.0.1:<free port>` for the run and launches contexts with `proxy: { server: "socks5://127.0.0.1:<port>" }`. Each connection is carried over the runner's WebSocket to the PC.
- **Protocol** (`/api/v1/runners/connect`, WebSocket, runner token): binary frames `open(id, host, port)`, `opened(id)` / `refused(id, reason)`, `data(id, bytes)`, `end(id)`, `credit(id, n)` for back-pressure (64 KB windows), and pings. Raw TCP, so HTTP, WebSockets and HTTP/2 all pass.
- **Built (PR 8), first version:** a run whose runner is offline when it starts fails to start with a clear message instead of waiting; a runner that drops mid-run breaks the attempts until it reconnects (by itself), so the run pauses on the first broken one when pausing is on. Waiting for the runner is left for later. `credit(id, n)` uses 256 KB windows. `--background` and `--start-at-sign-in` for the runner are not built yet.
- **Runner offline** when a run starts or mid-run: the run pauses with "Waiting for runner Dumi's PC" (the same mechanism as broken waits), resumes when it reconnects, and alerts can fire on it.
- **Browsers:** Chromium proxies `localhost` once a proxy is set (Playwright 1.64 adds `<-loopback>`). Firefox and WebKit are checked first in a prototype; a browser that won't send loopback through the proxy is refused for runner runs with a clear message, rather than worked around with a hosts trick.

## 7. Pull requests

1. **Plan** (this, with the research note).
2. **Auth core:** `auth` plugin, users, sessions, tokens, roles, `access` on actions and routes, the route inventory test, `--auth`, `--public-url`, `--trust-proxy`, non-loopback `--host` with login, first-admin setup, `users` CLI commands, `started_by` columns, approvals by user.
3. **Auth in the page:** sign-in and setup pages, user menu, Settings › Users (admin), Settings › Tokens, role-aware menus and buttons, "by" on runs and reviews. Screenshots.
4. **Auth for clients:** `login`/`logout`, `WATCHWRIGHT_TOKEN`, MCP Bearer, stdio bridge, `init-agent --server`, Settings › Agents.
5. **Single sign-on:** OIDC and trusted header, Settings › Sign-in, provider guides. Tested in CI against a small in-process OIDC provider (`oidc-provider` as a dev dependency).
6. **Sharing:** share links, shared run page, Settings › Sharing, public dashboard.
7. **Docker:** Dockerfile, compose files, server mode, `docker` release job, Self-hosting guide. CI builds the image on PRs that touch `docker/`.
8. **Runner prototype** (Firefox and WebKit loopback over SOCKS) **and runner:** command, pairing, allow list, endpoint, SOCKS listener, run option and pack default, Settings › Runners, offline pause.
9. **Sign-off:** the whole flow in the sandbox (Docker image, OIDC against a test provider, runner from a second container to a site on its loopback), then on Dumi's Proxmox/Portainer with NPMplus and VoidAuth and a runner on the PC. Fixes from that.

No release until Dumi says so (releases are on hold).

## 8. Out of scope

- Per-user workspaces or pack permissions per user.
- Running the browser on the PC through the runner (research option 4). The runner's protocol leaves room for it.
- Encrypting secrets at rest (they are in the data folder as today; the guide says to protect the volume).
- LDAP (VoidAuth and the others offer OIDC).
