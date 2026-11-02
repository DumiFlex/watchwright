# Research: self-hosting (login, Docker, reaching sites on another machine)

Notes from reading the server, CLI and session code on `dev` (2026-11-02) and Playwright 1.64's sources, before any build. The ask: run Watchwright on a server or homelab instead of the PC it tests from, with an optional login (users and admins), a Docker image, and a way for that server to test a site that only runs on someone's PC (`localhost:3000`), without everyone having to set up Tailscale.

This is deployment of the existing testing tool, not a new capability.

## 1. Where Watchwright stands today

- **Loopback only.** `watchwright serve` refuses any `--host` but `127.0.0.1`, `localhost` or `::1` ("That needs token auth, which isn't built yet", `src/cli/serve.ts`).
- **The request guard** (`src/server/guard.ts`) allows only a loopback `Host` with the server's port, and for changes and WebSocket upgrades only no `Origin` or the server's own loopback origin. That stops other web pages and DNS rebinding; it does not know about people.
- **"From the page" means "has an Origin header".** `fromPage` in `src/actions/registry.ts` is `typeof req.headers.origin === "string"`, and only the page can answer approvals. On a server anyone who can load the page could approve anything.
- **Who called** is a free-text `x-watchwright-client` header (`cli`, an agent's name). Nothing is tied to a person.
- **Desktop-only bits:** "open in the file manager" (`plugins/folders`), start at sign-in (`plugins/schedules/startup.ts`), `serve` opening a browser tab, and the folder browser listing the whole disk of the machine it runs on.
- **What already works on a server:** runs are headless by default (`runs/engine.ts`), the live view is a screencast over WebSocket (`page.screencast`), videos use Playwright's own ffmpeg (or `WATCHWRIGHT_FFMPEG`), and the data folder is one setting (`--data` / `WATCHWRIGHT_DATA`).

So three things are missing: knowing who someone is (login), shipping it (Docker), and reaching sites that aren't on the server (network).

## 2. Login: users and admins

### What it has to protect

The web page, the HTTP API, the live-view WebSocket, the MCP endpoint (`/api/v1/mcp`), and the CLI and stdio bridge that talk to them. Pack code runs on the server with the server's permissions, and packs can read every secret through `h.secret`. Anyone who may edit or add a pack can therefore run any code on the server and read every secret. That has to be said plainly in the docs and in the roles, because it limits how far "users vs admins" can protect anything.

### Options

| Option | What it is | Fits |
|---|---|---|
| **A. Built-in accounts** | Users in SQLite, passwords hashed with `scrypt` from `node:crypto` (no new native dependency), a session cookie for the page, personal API tokens for the CLI and agents. | Everyone. One admin and no other setup. |
| **B. Trusted header (forward auth)** | A reverse proxy in front (Authelia, Authentik, Caddy `forward_auth`, Tailscale Serve's `Tailscale-User-Login`) signs people in and passes the user name in a header Watchwright trusts only from the configured proxy address. | Homelabs that already run single sign-on. Small to add on top of A. |
| **C. OIDC (sign in with Google, GitHub, Authentik, Pocket ID)** | Watchwright talks OpenID Connect itself. | Teams. More code, more settings, a library (`openid-client`). |
| **D. One shared token** | A single password for everything. | Too weak: no admins, no "who started this". |

**Recommendation: A, with B as a small optional extra; C later if someone asks.** A works with no other software, and B covers the single-sign-on homelab case for very little code (both map to the same user rows; B creates the row on first sight).

### Design sketch for A

- **Off by default on loopback.** `watchwright serve` on `127.0.0.1` keeps working exactly as today with no login. Login is turned on by `--auth` (or `WATCHWRIGHT_AUTH=on`), and it is **required** for any non-loopback `--host`. No flag skips that.
- **First admin.** On the first start with login on and no users, the server prints a one-time setup link with a random code (like Jupyter and Grafana do) and the page shows a "Create the first admin" form for it. `watchwright users add <name> --admin` does the same from a shell on the server (for Docker: `docker exec`).
- **Page sessions.** A random 32-byte session id in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when the public address is https), stored hashed in an `auth_sessions` table, sliding expiry (30 days, setting). Sign-out ends it; an admin can end all of a user's sessions. Failed sign-ins are slowed down per user and per address.
- **API tokens.** Each user makes named tokens (`ww_…`, shown once, stored hashed, optional expiry, last used). The CLI sends `Authorization: Bearer` from `WATCHWRIGHT_TOKEN` or `watchwright login` (saved in the user's config folder). MCP clients put the same header in their settings; `init-agent` and Settings › Agents write the header with an environment-variable reference, never the token itself.
- **Roles.** Two, as asked, with an optional third:
  - **Admin:** everything, plus users and tokens of others, server settings, secrets, saved sign-ins, alert channels, startup, folders outside the packs root, stopping the server.
  - **User:** packs (add, edit, record), runs, reviews, schedules, their own tokens. Uses secrets and sign-ins by name but can't see or change them. Because pack code runs on the server, a user is trusted with the server; the docs say so.
  - **Viewer (question for Dumi):** watch runs, read results, maybe review. Useful for sharing a homelab with someone who shouldn't run code.
- **Who did it.** Runs, reviews, approvals and schedule changes record the user (`started_by`), shown next to the existing caller name (`Dumi via Claude Code`).
- **Approvals.** "From the page" becomes "a signed-in session on the page" rather than "has an Origin". An approval is answered by its caller's own user or an admin. Token calls (agents, scripts) still wait for approval for destructive actions.
- **The request guard grows, it doesn't loosen.** A new `--public-url https://watchwright.home.lan` (or several) adds those hosts and origins to the allowed lists. `--trust-proxy <address>` lets `X-Forwarded-Proto/Host` count only from that address. With login on, every route except `/health`, sign-in and the static page needs a session or token; WebSocket upgrades check the cookie and the origin.
- **Where it lives.** A new `auth` plugin (tables `users`, `auth_sessions`, `auth_tokens`) providing a `CURRENT_USER` service and a guard hook. The server only needs a hook in the plugin contract to reject a request before routing, which is a contract extension, not feature code in `server/`.

## 3. Docker

### Image

- **Base:** `mcr.microsoft.com/playwright:v1.64.1-noble`. It has Chromium, Firefox, WebKit, their system libraries, fonts and Playwright's ffmpeg, for `linux/amd64` and `linux/arm64`. It is large (about 2 GB) but every alternative means installing browser dependencies ourselves. The tag must match the `playwright` version Watchwright ships, so the build reads it from `package.json`.
- **Contents:** the published `watchwright` package from npm (`npm install -g watchwright@<version>`), so the image is exactly the release. Runs as the image's non-root `pwuser`.
- **Command:** `watchwright serve --host 0.0.0.0 --auth --no-open --data /data`. Login is always on in the image (see section 2: a container can't tell whether its port is published only to `127.0.0.1`).
- **Volumes:** `/data` (database, runs, secrets, sign-ins) and `/packs` (the packs root the folder browser stays inside).
- **Runtime flags in the docs and compose file:** `init: true` (reaps browser child processes), `shm_size: 1gb` or `ipc: host` (Chromium crashes on Docker's 64 MB `/dev/shm`), a health check on `/api/v1/health`, `restart: unless-stopped`.
- **Desktop bits off:** "Open in file manager" and "Start at sign-in" hide themselves when there is no desktop (a `WATCHWRIGHT_HEADLESS_HOST` flag set in the image, also detectable on Linux by no `DISPLAY`/`WAYLAND_DISPLAY`). Headed runs aren't offered in the container.
- **Publishing:** the release workflow builds and pushes `ghcr.io/dumiflex/watchwright:<version>` and `:latest` after the npm package is live (the image installs from npm, so it can't go first). It uses the repo's `GITHUB_TOKEN`, no new secrets.
- **Reverse proxy:** a compose example with Caddy for HTTPS, which passes WebSockets with no extra settings. Docs list what Nginx needs (`Upgrade`/`Connection` headers, long `proxy_read_timeout`) because the live view and `runs.wait` hold connections open.
- **Updates:** pull a new tag; the store's migrations run on start as they do today. Runs in progress when the container stops resume on the next start (#166).

### Other ways to run it

A plain `npm install -g watchwright` on a Linux server with `npx playwright install --with-deps chromium firefox` and a systemd unit works too; the docs give the unit file. Docker is the main path because browser dependencies are the usual pain.

## 4. Reaching sites that only run on someone's PC

The case: Watchwright runs on the homelab, the site under test runs on the PC as `http://localhost:3000` (or ComfyUI on `127.0.0.1:8188`). The server's browser can't reach it: `localhost` on the server is the server.

### What makes this harder than it looks

- **Dev servers listen on loopback only.** Vite, Next, ComfyUI and most others bind `127.0.0.1` by default, so even on the same LAN the server can't connect unless the developer changes that.
- **Dev servers check `Host`.** Vite rejects unknown hosts (`server.allowedHosts`), as do others guarding against DNS rebinding, so `http://dumi-pc:5173` gets a 403 even once reachable.
- **`localhost` is a secure context; `http://dumi-pc:3000` isn't.** Service workers, `crypto.subtle`, the clipboard API, some cookies (`Secure`, `__Host-`) and `getUserMedia` only work on https or localhost. Testing the site under another name can change what it does, so tests could pass on the PC and fail from the server, or the reverse.
- **Pack URLs say `localhost`.** A pack written on the PC should run unchanged from the server.

The best option is the one where the server's browser still asks for `http://localhost:3000` and that request comes out on the PC.

### Options

| | How | Site URL the browser sees | Setup | Works through NAT / from anywhere | Secure context kept | Code in Watchwright |
|---|---|---|---|---|---|---|
| **1. Tailscale (or ZeroTier, WireGuard)** | Both machines on a tailnet; the site listens on the tailnet address or `tailscale serve` forwards to it. Docker: a `tailscale/tailscale` sidecar. | `http://dumi-pc:3000` | Tailscale on both, dev server config changes | Yes | No | None (docs only) |
| **2. SSH remote forward** | From the PC: `ssh -R 3000:localhost:3000 server`. With `--network host`, or `GatewayPorts` into the container. | `http://localhost:3000` only if the browser shares the host's network; else `host.docker.internal:3000` | SSH access to the server, a terminal kept open per port | Yes, if SSH is reachable | Only with host networking | None (docs only) |
| **3. Watchwright runner as a network bridge** (recommended) | `watchwright runner --server https://ww.home --token …` on the PC dials **out** to the server over one WebSocket. The server gives each run's browser a proxy (`proxy: { server: "socks5://127.0.0.1:<port>" }`) whose connections it carries over that WebSocket; the runner opens them on the PC. | `http://localhost:3000`, unchanged | One command on the PC, a token | Yes: only the PC → server direction is needed | Yes | Runner command, tunnel, SOCKS listener, run option |
| **4. Remote browser on the PC** | Run the browser itself on the PC (`playwright run-server`, or through the runner) and have the server `browserType.connect()` to it. | `http://localhost:3000` | Same Playwright version on both sides, or the runner | Needs server → PC, or the runner's tunnel | Yes | `connect()` path in sessions, version pinning |
| **5. Public tunnel (Cloudflare Tunnel, ngrok)** | Expose the PC's site on a public https address. | `https://something.trycloudflare.com` | An account, the site goes on the internet | Yes | Yes (https) | None |

### Notes on each

- **1. Tailscale** is the zero-code answer and good for anyone already using it, so it gets a docs page with the sidecar compose file. But it changes the site's address, needs dev server changes, and loses the secure context. Not something to make everyone do.
- **2. SSH** is fine for one port and people who already SSH, awkward in Docker. Docs page section only.
- **3. Runner bridge** keeps everything else on the server: the browser, screencast, video, traces, downloads, all as today. Only the site's network traffic crosses. Checked in Playwright 1.64's source: with a proxy set, Chromium contexts get `<-loopback>` added to the bypass list unless the pack's bypass mentions loopback (`shouldProxyLoopback` in `coreBundle.js`), so `localhost` **does** go through the proxy. Firefox (Playwright's Juggler build, which applies the context proxy itself) and WebKit need a prototype to confirm; that's the first thing the build does, and if one of them won't send loopback through a proxy that browser is listed as "not over the bridge" rather than worked around. Details:
  - **The runner** is a new `watchwright runner` command (same npm package; also a standalone Windows `.cmd` the page offers to copy). It holds one outbound WebSocket to `/api/v1/runners/connect` with a runner token (a token kind admins and users can create, limited to that endpoint), reconnects with back-off, and shows its name and status on a new Settings › Runners page.
  - **What it may open** is decided on the PC, not the server: by default only loopback (`--allow localhost:3000,localhost:8188`, or `--allow loopback` for any port). The runner refuses everything else, so a server (or anyone who controls it) can't use the PC to reach the rest of the LAN. This matters: section 2 says pack code is trusted with the server, but the PC belongs to the person running the runner.
  - **Per run:** a new run option `network: "server" | "<runner name>"`, with the pack able to set a default (`site.network` in the pack file). The New run form gets a "Reach the site from" choice. When the runner is offline the run waits, the way a broken wait does, instead of failing every test with connection errors, and says why.
  - **Protocol:** a small multiplexed stream protocol over the WebSocket (open, data, close, per-stream back-pressure), carrying raw TCP, so HTTP, WebSockets (ComfyUI's live updates), and HTTP/2 all pass through. No new dependency is needed for SOCKS5 (the handshake is about 60 lines) or the framing.
  - **Cost:** every byte the site sends goes through the server's process twice. Fine on a LAN or tailnet; the docs say large media sites will be slower than local.
- **4. Remote browser** is the right answer for a different need: a headed browser on the PC, a GPU, a real Windows Firefox. It needs the exact Playwright version on both sides (Playwright refuses mismatched major.minor on `connect`) and moves screencast and video traffic across the link. It can later reuse the runner's tunnel (`watchwright runner --browsers`), but it isn't needed for the ask and isn't in the first build.
- **5. Public tunnel** puts a dev site on the internet. Docs mention it as an option for sites that are fine to expose, nothing more.

**Recommendation: build 3 (the runner as a network bridge), document 1, 2 and 5, and leave 4 for later.** 3 is the only option that keeps pack URLs and the secure context unchanged, needs nothing on the PC but Watchwright itself, and works whichever way NAT and firewalls point, as long as the PC can reach the server (which it must anyway to watch the live view).

## 5. Things that change for people who stay local

Nothing, unless they turn login on. Defaults stay `127.0.0.1:7420`, no login, no runner. Running `serve` with `--auth` locally is allowed (useful to try it).

## 6. Proposed build order

Each a PR to `dev`, each with tests, site docs and screenshots:

1. **Plan** (`docs/plans/self-hosting.md`) after Dumi's answers.
2. **Auth core:** `auth` plugin, users, sessions, tokens, roles, guard hook, `--auth`, `--public-url`, `--trust-proxy`, first-admin setup, `users` CLI commands. Allows a non-loopback `--host` with login on.
3. **Auth in the page:** sign-in page, user menu, Settings › Users (admin) and Settings › Tokens, "started by" on runs and reviews, approvals by user, role checks hiding admin pages.
4. **Auth for clients:** CLI `login`/`WATCHWRIGHT_TOKEN`, MCP Bearer header, stdio bridge, `init-agent` and Settings › Agents writing the header.
5. **Docker:** Dockerfile, compose files (plain, with Caddy, with a Tailscale sidecar), desktop bits hidden on servers, image publishing in `release.yml`, a "Self-hosting" guide on the site.
6. **Runner prototype check** for Firefox and WebKit loopback over a proxy, then **runner bridge:** `watchwright runner`, runners endpoint and tokens, SOCKS listener, run option and pack default, Settings › Runners, offline waits.
7. **Forward-auth header** (option B) if Dumi wants it in this round.
8. **Sign-off:** a full check in Docker in the sandbox, then on Dumi's homelab or PC (Docker Desktop) with the runner on the PC against a local site.

## 7. Risks

- **Login is security code.** Mistakes expose a browser that can run code. Mitigations: small surface (one guard hook, everything else denied by default), tests for every route class without a session, a route inventory test like the community repo's CSRF inventory, and a self-review pass focused on it.
- **Pack code = server access.** Roles can't fix this; docs and the Users page say it. A viewer role is the only real line.
- **Image size and Playwright pinning.** The image must be rebuilt for each Playwright bump; the release workflow ties them.
- **Firefox/WebKit over the bridge** may not proxy loopback (section 4). Checked before building on it.
- **Bridge throughput** for heavy media sites.

## 8. Questions for Dumi

1. **Roles:** admin and user only, or also a read-only viewer?
2. **Single sign-on:** add the trusted-header option (Authelia, Authentik, Tailscale Serve) in this round, or later? Full OIDC later?
3. **Network:** agree on the runner bridge as the built answer, with Tailscale and SSH as docs only?
4. **Docker image:** publish to GitHub's registry (`ghcr.io/dumiflex/watchwright`) on each release?
5. **Homelab:** what does it run (plain Docker, Unraid, TrueNAS, Proxmox LXC, Kubernetes), and amd64 or arm64? That decides which install guide is tested for real.

## 9. Sources

- Watchwright `dev` at `f61c86c`: `src/server/guard.ts`, `src/cli/serve.ts`, `src/actions/registry.ts`, `src/plugins/approvals`, `src/plugins/folders`, `src/plugins/schedules/startup.ts`, `src/session/session.ts`, `src/jobs/run-video.ts`, `packages/site/guide/safety.md`.
- Playwright 1.64.1 (`playwright-core` package): `lib/coreBundle.js` (`shouldProxyLoopback`, Chromium `proxyBypassList` `<-loopback>`), `types/types.d.ts` (`proxy`, `connect` `exposeNetwork`).
- Playwright docs: Docker (`mcr.microsoft.com/playwright`, `--init`, `--ipc=host`), `browserType.connect`, `browser.newContext({ proxy })`.
- Tailscale docs: `tailscale serve`, Docker sidecar, `Tailscale-User-Login` identity headers.
- Vite `server.allowedHosts`; MDN "Secure contexts" (localhost counts as potentially trustworthy).
