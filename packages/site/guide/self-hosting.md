# Self-hosting

Watchwright can run on a server or in a homelab instead of your own computer, so runs go on while your computer is off and several people share one server. The Docker image is the easiest way: it holds the server, its web app and the browsers.

Self-hosted, Watchwright always has [login](./safety#login) on. The first start prints a link that creates the first admin; after that, admins add people in Settings › Users or through [single sign-on](./single-sign-on).

::: tip Sites that run only on your computer
A site at `localhost:3000` on your own computer can't be reached from a server. Run a [runner](#runners) on your computer and the server's runs reach it through there.
:::

## Docker

The image is `ghcr.io/dumiflex/watchwright`, for `linux/amd64` and `linux/arm64`. Tags are each version (`0.11.0`), each minor version (`0.11`, which takes patch releases) and `latest`.

1. Make the two folders the container keeps its things in, owned by the container's user (uid 1001):

   ```bash
   sudo mkdir -p /opt/watchwright/data /opt/watchwright/packs
   sudo chown -R 1001:1001 /opt/watchwright
   ```

   - `data` holds the database, the runs, their screenshots and videos. Back it up.
   - `packs` holds your test packs. The folder browser in the web app shows only this folder.

2. Save [`compose.yml`](https://github.com/DumiFlex/watchwright/blob/dev/docker/compose.yml) and set `WATCHWRIGHT_PUBLIC_URL` to the address people will open, such as `http://192.168.1.20:7420`. Watchwright refuses requests for any other address, which keeps other sites from talking to it through someone's browser.

3. Start it, and read its log for the first-admin link:

   ```bash
   docker compose up -d
   docker compose logs watchwright
   ```

4. Open the link, choose your admin name and password, and add a pack under **Packs › Add a pack**.

### Getting packs onto the server

- **Upload .zip** on the Packs page (admins) unpacks a zip into a new folder under `/packs` and adds it. Zip a pack folder on your PC, or use **Download .zip** from a pack's menu on another Watchwright.
- **Download .zip** in a pack's menu gives you the pack's folder back, to edit it locally or move it to another server.
- Or put pack folders into the packs folder on the host (`/opt/watchwright/packs`), for example with `git clone`, and add them with **Browse…**.
- **New pack here** in the folder browser writes a starter pack, and the editor on a pack's page changes its files.

The same with `docker run`:

```bash
docker run -d --name watchwright --init --shm-size 1g --restart unless-stopped \
  -p 7420:7420 \
  -v /opt/watchwright/data:/data -v /opt/watchwright/packs:/packs \
  -e WATCHWRIGHT_PUBLIC_URL=http://192.168.1.20:7420 \
  ghcr.io/dumiflex/watchwright:latest
```

`--init` reaps the browsers' child processes, and `--shm-size 1g` gives Chromium the shared memory it needs (Docker's default 64 MB makes pages crash).

### What's different in a container

The image sets these, and you can change them with `-e` or in `environment:`:

| Variable | In the image | What it does |
|---|---|---|
| `WATCHWRIGHT_PUBLIC_URL` | (none) | The address people open, with `https://` behind a proxy. Several, with commas. |
| `WATCHWRIGHT_TRUST_PROXY` | (none) | The reverse proxy's address or network, such as `172.18.0.0/16`, so people's own addresses show and sign-in limits count them, not the proxy. |
| `WATCHWRIGHT_AUTH` | `on` | Login. It can't be off while the server listens beyond `127.0.0.1`. |
| `WATCHWRIGHT_DATA` | `/data` | The data folder. |
| `WATCHWRIGHT_FOLDERS` | `/packs` | The folders the web app's folder browser may show, with commas. |
| `WATCHWRIGHT_SERVER_HOST` | `1` | No screen: browsers always run headless (a pack's `headless: false` is ignored), **Record in a window** isn't offered, and folders can't be shown in a file manager. |
| `WATCHWRIGHT_HOST` | `0.0.0.0` | The address the server listens on inside the container. |
| `TZ` | (UTC) | The time zone for schedules. |

On a Linux server without Docker, `watchwright serve` notices there's no screen (no `DISPLAY` or `WAYLAND_DISPLAY`) and does the same as `WATCHWRIGHT_SERVER_HOST=1`. Set `WATCHWRIGHT_SERVER_HOST=0` to say there is one.

### Commands in the container

The `watchwright` command works inside the container, for example to add an admin when nobody can sign in:

```bash
docker exec -it watchwright watchwright users add dumi --role admin
```

## Portainer

1. In Portainer, open **Stacks › Add stack**, name it `watchwright`, and pick **Web editor**.
2. Paste [`compose.yml`](https://github.com/DumiFlex/watchwright/blob/dev/docker/compose.yml) and change `WATCHWRIGHT_PUBLIC_URL`. Make the two folders first (step 1 above), on the machine the stack runs on.
3. **Deploy the stack**, then open the container's **Logs** for the first-admin link.

To update, open the stack and press **Update the stack** with **Re-pull image and redeploy** on. Your data stays in `/opt/watchwright/data`.

### Proxmox

Run Docker in a VM (Debian or Ubuntu, 2 cores and 4 GB of memory or more for a browser or two at a time), or in an LXC container with **Nesting** on (Options › Features). In an unprivileged LXC, give the folders to uid 1001 inside the container, as above. Portainer, or its agent, runs in the same VM or container.

## Behind a reverse proxy

A reverse proxy gives Watchwright a domain and HTTPS. Set `WATCHWRIGHT_PUBLIC_URL` to the address with `https://`, and `WATCHWRIGHT_TRUST_PROXY` to the proxy's address or Docker network. The live view is a WebSocket, so the proxy must pass WebSockets on.

### Nginx Proxy Manager and NPMplus

1. **Add Proxy Host.** Domain: `watchwright.example.com`. Scheme `http`, forward hostname: the Watchwright container's name (on the same Docker network as the proxy) or the machine's address, port `7420`.
2. Turn on **Websockets Support** and **Block Common Exploits**.
3. Under **SSL**, request a certificate and turn on **Force SSL**.
4. Under **Advanced**, so that `watchwright wait` and agents' long waits aren't cut off after a minute, add:

   ```nginx
   proxy_read_timeout 300s;
   proxy_send_timeout 300s;
   ```

5. In the stack: `WATCHWRIGHT_PUBLIC_URL: "https://watchwright.example.com"` and `WATCHWRIGHT_TRUST_PROXY` set to the proxy's Docker network (`docker network inspect <network>` shows its subnet, such as `172.18.0.0/16`).

For [single sign-on](./single-sign-on) with VoidAuth, Authentik or Authelia, add the OpenID Connect client in the provider; nothing more changes in NPMplus.

### Caddy

[`compose.caddy.yml`](https://github.com/DumiFlex/watchwright/blob/dev/docker/compose.caddy.yml) runs Watchwright with Caddy, which gets and renews the certificate by itself. Put your domain in the [`Caddyfile`](https://github.com/DumiFlex/watchwright/blob/dev/docker/Caddyfile) and in `WATCHWRIGHT_PUBLIC_URL`, point the domain's DNS at the machine, open ports 80 and 443, and start it:

```bash
docker compose -f compose.caddy.yml up -d
```

### Tailscale

To reach Watchwright only from your own devices, with HTTPS and no open ports, [`compose.tailscale.yml`](https://github.com/DumiFlex/watchwright/blob/dev/docker/compose.tailscale.yml) puts it on your tailnet. Make an auth key in the Tailscale admin console, turn on HTTPS certificates (DNS page), set the key and your tailnet's name in the file, and keep [`tailscale-serve.json`](https://github.com/DumiFlex/watchwright/blob/dev/docker/tailscale-serve.json) beside it. Watchwright is then at `https://watchwright.<tailnet>.ts.net`.

## Runners

A server in Docker or on another machine can't open `localhost` on your PC, and often not your home network either. A **runner** fixes that: `watchwright runner` runs on the machine that can reach the site, connects out to the server (so nothing on that machine is opened to the network), and the browser connections of runs that pick it go through it. The browser still runs on the server; only its connections come from your machine, so the site sees an ordinary visitor from `localhost`.

1. In **Settings › Runners**, give the runner a name (such as `Office PC`) and say what it may open: `loopback` (any port on that machine, the default), `host:port` or `host:*`, separated by commas.
2. The page shows a command with a one-time pair code. Run it on that machine; it needs [Node.js](https://nodejs.org/) 22 or later and works the same on Windows, macOS and Linux:

   ```bash
   npx watchwright@0.12.0 runner --server https://watchwright.example.com --pair 7KQ-M2X-PLD
   ```

   (The page's command names the server's own version, so the runner matches it.)

   The code works once, within 15 minutes. The runner trades it for a token it keeps in your config folder (`runner.json`), so afterwards `npx watchwright runner` alone connects again. Leave it running; the page shows it as connected. It reconnects by itself when the server restarts or the network drops.
3. Pick the runner under **Reach the site from** on New run, or make it the pack's default with `site.network`:

   ```yaml
   site: { key: shop, baseURL: "http://localhost:3000/", network: Office PC }
   ```

   Schedules and presets keep the choice. Recording a pack whose `site.network` names a runner goes through it too.

**What it may open is decided on that machine.** The list given on the page is only where it starts: the runner keeps its own (`watchwright runner --allow "loopback, nas.lan:5000"` changes it), and the server can't widen it. A connection it refuses fails in the browser, and the run's log says which address was refused and why.

**When the runner is offline** a run that needs it doesn't start, and says so. If it drops during a run, the connections fail until it is back (it reconnects by itself), so the attempts in between break; with **Pause and wait for Retry or Skip** on, the run pauses on the first one and goes on when you retry.

Chromium, Firefox and WebKit all send `localhost` through the runner. Remove a runner in Settings › Runners to disconnect it and stop its token working; a new pair code (the link icon) sets it up again or on another machine.

## Updating

Pull the new image and start the container again; the data folder upgrades itself on start.

```bash
docker compose pull && docker compose up -d
```

A run in progress stops when the container stops and shows as interrupted, and **Resume run** goes on from where it stopped. Update between runs.

## Backup

Everything is in the data folder. Stop the container (so the database is closed), copy the folder, and start it again:

```bash
docker compose stop
sudo tar czf watchwright-backup.tgz -C /opt/watchwright data
docker compose start
```

To move to another machine, copy the folder there and start the same stack. Your packs live in the packs folder (or in git), so back them up too.
