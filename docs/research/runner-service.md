# Runners that start by themselves, and removing them

Status: research note, then built in the same PR.

## The problem

A runner today is `npx watchwright runner` in a terminal that has to stay open. Close the terminal, sign out or restart the machine and the runner is gone until someone starts it again by hand, so runs and schedules that reach their site through it stop starting. Removing a runner in Admin › Runners disconnects it and stops its token working, but the machine keeps the token in `runner.json` and anything set up to start it keeps trying, and the page doesn't say what to do there.

## What people need

1. One command that sets the runner up to start by itself and run with no window, on Windows, Linux and macOS, with no admin rights where possible.
2. A way to see, stop, start and remove that from the machine.
3. Removing the runner on the page cleans up the machine by itself when it can, and says what to run there when it can't.

## Options per system

**Windows.**

- *Startup folder* (a `.cmd` in `shell:startup`): starts at sign-in, needs no admin, no compiled code. `serve`'s "Start at sign-in" already does this (`plugins/schedules/startup.ts`), with `start /min` and a detached child with `windowsHide`, so no console stays open. Doesn't start before someone signs in.
- *Task Scheduler* (`schtasks /Create /SC ONSTART /RU SYSTEM`): starts at boot without a sign-in, but needs an admin prompt and runs as SYSTEM, whose config folder isn't the user's (the token would have to move). A console program run as the signed-in user from a task opens a window.
- *A real Windows service* needs a wrapper (NSSM, WinSW, node-windows): an extra binary, admin, and on Dumi's PC exactly the kind of thing antivirus flags.

The runner's job is to reach sites on that PC, which only run while someone is signed in, so sign-in is the right moment. **Pick: the Startup folder**, the same as the server's own start at sign-in. Boot without a sign-in stays a documented recipe (Task Scheduler) for people who want it.

**Linux.** systemd is on every mainstream distribution.

- As a normal user: a user unit in `~/.config/systemd/user/`, `systemctl --user enable --now`. It starts at sign-in, and at boot once `loginctl enable-linger` is on (most systems allow it for your own user; otherwise it needs sudo, so the command says so instead of failing).
- As root (a homelab LXC or VM): a system unit in `/etc/systemd/system/`, `WantedBy=multi-user.target`, after `network-online.target`.
- `Restart=on-failure`, so a crash comes back but a runner that removed itself (exit 0) doesn't.
- No systemd (Alpine with OpenRC, containers): say so and point to `watchwright runner start`, which runs it in the background, for whatever starts programs there.

**macOS.** A LaunchAgent in `~/Library/LaunchAgents/` with `RunAtLoad` and `KeepAlive` on unsuccessful exit, loaded with `launchctl bootstrap gui/<uid>`. Starts at sign-in, no admin.

**Docker.** A runner in a container only reaches that container's loopback; it's the wrong tool for "a site on my PC". Not built.

## Which program the start-up entry runs

The page's command is `npx watchwright@<version> runner …`, and npx's cache isn't a stable place to point a start-up entry at. So:

- from a global install or a checkout: the same `node` and script that ran the command;
- from npx: npx itself, with the same pinned version (`npx --yes watchwright@<version> runner …`), so it still works if the cache is cleared (it downloads again).

Linux and macOS start programs with a short `PATH`, so the entry sets `PATH` to start with the folder of the `node` that ran the command (nvm installs work).

## Removing

**While the runner is connected**, the server tells it first (a new `removed` control message) and waits up to three seconds for its answer. The runner forgets that server's token in `runner.json`, removes its start-up entry when it was set up for that server, answers `cleaned`, and exits with 0 (so systemd and launchd don't start it again). The page says it removed itself from its machine.

**While it is offline**, it learns the next time it starts: the server refuses its token with a reason (`unknown_token`), and the runner cleans up the same way. A token that doesn't work any more never will (the runner was removed, or paired again from another machine), so cleaning up is right in both cases. A server whose database was lost refuses every runner the same way; they remove themselves and are paired again with the page's command, which sets the start-up entry up again.

**By hand**, on that machine: `watchwright runner uninstall --forget`. The remove dialog shows this command, so it can be run on a machine that will never connect again.

Older runners ignore `removed`; the server closes them as before after the wait. Older servers send no reason; newer runners then leave the machine as it is.

## What the page shows

- The runner says how it runs when it connects (`service`: windows, systemd, launchd or none); the server keeps it (migration 2), and the list says "Starts by itself at sign-in" or "Runs in a terminal".
- Adding a runner offers two commands: **Start by itself** (`runner install --pair …`, the default) and **Only while a terminal is open** (today's command).
- The remove dialog says whether it will clean up its machine now (connected) or next time it starts, with the command to run there.

## Commands

```
watchwright runner [--server] [--pair] [--allow]            in this terminal (as today)
watchwright runner install [--server] [--pair] [--allow]    start by itself from now on, and now
watchwright runner status                                   paired servers, start-up entry, running or not
watchwright runner start | stop                             the runner in the background, now
watchwright runner uninstall [--forget]                     stop it and remove the start-up entry (and the tokens)
```

One start-up entry per machine; installing for another server replaces it. Background runners log to `logs/runner.log` in the config folder (systemd: the journal), and keep a `runner.pid` so a second one doesn't start.

## Not doing

- A Windows service or anything compiled; nothing that needs an admin prompt.
- One runner process for several servers at once.
- Updating a started runner by itself: `runner install` again with a newer version replaces the entry.
