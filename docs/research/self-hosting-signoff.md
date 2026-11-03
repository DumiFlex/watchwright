# Self-hosting sign-off

The last step of [docs/plans/self-hosting.md](../plans/self-hosting.md) (section 7, PR 9): the whole flow, first in a sandbox, then on a real homelab.

## 1. In the sandbox (done, 2026-11-02)

The Docker image (`docker/Dockerfile`, with the built `dist` of `dev` at the runner merge) ran with three containers on one Docker network:

| Container | What it is |
|---|---|
| `wwrun` | Watchwright, `--public-url http://localhost:7431,http://wwrun:7420`, login on (the image's default). |
| `idp` | A small OpenID provider (discovery, `authorize` that signs one person in without asking, `token` with an RS256 ID token, JWKS, userinfo). Its person is in the group `watchwright-admins`. |
| `pc` | Stands in for someone's PC: a site that listens only on its own `127.0.0.1:3000`, and `watchwright runner --server http://wwrun:7420 --pair <code>`. |

The browser that played the people ran on the host. All of this passed:

1. **First admin.** The setup link from the server's log opened the setup page, and creating the admin signed them in.
2. **Single sign-on.** The admin set OpenID Connect to the provider, with the group `watchwright-admins` mapped to admin and everyone else refused. In a fresh browser, "Sign in with Test IdP" went to the provider and back, and the person was signed in as `alex` (Alex Doe), admin.
3. **Runner.** The admin added the runner "Office PC". The `pc` container paired with the code, saved its token and showed as connected on the page (`linux-x64`).
4. **A run through the runner.** `alex` started a Firefox run of a pack with `site: { baseURL: "http://localhost:3000/", network: Office PC }`.
   - It passed, with "The browser reaches the site from the runner Office PC" in its log and its video saved.
   - The `wwrun` container itself can't reach that site.
5. **Earlier in the same session** (PR #179):
   - Chromium and Firefox runs reached a site on the host's loopback through a runner on the host.
   - The same run without the runner got `ERR_CONNECTION_REFUSED`.
   - The runner reconnected by itself after the container restarted.

Found and fixed on the way:

- Setup didn't end when the first admin was made with `watchwright users add` while the server ran: the page kept asking for the setup code. Fixed in #179.
- The run log said "Started HOME HOME" for a test without a title of its own. Fixed here.
- `watchwright runner` stopped instead of reconnecting when the server restarted. Node's built-in WebSocket reports a failed connection with an `error` event alone and holds the process open only once connected. Fixed in #179, with a test.

## 2. On a homelab (for Dumi)

These need the real setup: Proxmox with Portainer, NPMplus in front, VoidAuth for sign-in, and the PC with the app.

- [x] **Stack.** In Portainer, deploy [`docker/compose.yml`](../../docker/compose.yml) from the repository with `WATCHWRIGHT_PUBLIC_URL=https://watchwright.<your domain>`. Open the setup link from the container's log and make the admin.
- [x] **Proxy.** In NPMplus, add the proxy host with WebSockets on (the live view and the runner both need them), and set `WATCHWRIGHT_TRUST_PROXY` to NPMplus's address. The page should open over HTTPS, sign in, and play the live view of a run.
- [x] **VoidAuth.** Add an OIDC client with the redirect URL `https://watchwright.<your domain>/api/v1/auth/oidc/callback`. Fill Settings › Single sign-on and map a group to admin, then sign in with it in a private window.
- [x] **Runner on the PC.** Add a runner in Settings › Runners and run its command in a terminal on the PC (Node 22 or later). It should show as connected.
- [x] **A real run through it.** Set `network:` to the runner's name in a pack whose site runs on the PC (or pick it under Reach the site from), run one test, and check the video.
- [x] **Stop the runner** (Ctrl+C) and start a run: it should fail to start with "the runner … is offline". Start the runner again with `npx watchwright runner` alone; it should reconnect without a new code.
- [ ] **Update.** Pull a newer image and redeploy: data, users, runners and sign-on settings stay, and the runner reconnects by itself.

Lines 1 to 6 passed on 2026-11-02 with 0.12.0 (Dumi). One thing to know for VoidAuth: the issuer in Settings › Single sign-on is VoidAuth's address followed by `/oidc`, not the address alone (the guide's provider table now says so).

Anything that fails there comes back as a fix before the next release.
