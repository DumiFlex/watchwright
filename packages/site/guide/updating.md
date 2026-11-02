# Updating

Watchwright checks npm for a newer version twice a day. When there is one, admins see **Update** in the top bar, and **Admin › Server › Updates** says what's new and how to update. How you update depends on how you installed it.

## Installed with npm

If you installed it with `npm install -g watchwright`, update in one step, from the web page or a terminal:

- **Admin › Server › Update to …**, or
- `watchwright update` in a terminal.

Either way, Watchwright stops, installs the new version with `npm install -g`, and starts again with the same options (port, data folder, login). It takes about a minute. The web page waits for it and reloads with the new version. If you started the server in a terminal, it comes back in the background (its output goes to `logs/server.log` in the data folder).

```bash
watchwright update            # asks first, then updates
watchwright update --check    # only says whether there is a newer version
watchwright update --yes      # doesn't ask
```

**Runs in progress.** Watchwright won't update while runs are going, unless you say so: the page asks first, and the command needs `--now`. Runs it interrupts go on by themselves once it's back when **Resume interrupted runs** is on (Settings › New run); otherwise they wait for **Resume** on their page.

**Agents keep working.** Claude Desktop and other agents that start `watchwright mcp` stay connected through the update. A call made while the server is away waits for it to come back, and once it's back the agent gets the new version's tools. You don't need to quit Claude Desktop first.

**If it fails**, the old version starts again, and Admin › Server says so. The update's own log is `logs/update.log` in the data folder.

::: tip Why this works on Windows
Windows doesn't let npm replace files a running program has loaded. The update runs from a small separate process that waits for the server to exit before npm starts. `watchwright mcp` doesn't load any of the files npm replaces, so it can stay running.
:::

## Docker and Portainer

A container can't replace its own image, so in Docker the page shows how to update instead of an Update button. Pull the new image and recreate the container; the data folder upgrades itself when the new version starts.

- **Portainer:** open the stack and press **Update the stack** with **Re-pull image and redeploy** on.
- **Docker Compose:** `docker compose pull && docker compose up -d`

The `latest` and `0.x` tags move with each release, and each version also has its own tag to pin. To update automatically, a tool such as [Watchtower](https://containrrr.dev/watchtower/) can pull new images and recreate the container. See [Self-hosting](./self-hosting#updating).

## npx and projects

- **npx** runs the newest version by itself: `npx watchwright@latest serve`.
- **As a dependency of a project**, update it the way you installed it, such as `npm install watchwright@latest` in that project.

## Turning the check off

Switch off **Check npm for a newer version** in Admin › Server. Watchwright then never asks npm on its own, and **Check now** still asks when you press it. The check sends nothing but the request for the newest version. To use another registry (a mirror), set `WATCHWRIGHT_NPM_REGISTRY`; otherwise npm's own `registry` setting is used.
