# Packs edited outside Watchwright

## What happened

A pack's files were changed outside Watchwright (in a code editor, by `git pull`, by an agent writing files), and the web page kept showing the pack as it was: a new parameter didn't show on the pack page or on New run, and adding the pack's first task didn't bring the **Tasks** tab.

## Why

The server builds a pack (esbuild, then imports the bundle) and stores what the page shows (tests, parameters, flags, tasks, hooks, dashboard) in the `packs` table. It builds a pack again only:

- when the server starts;
- when a file is saved in Watchwright's own editor, or a proposal is applied;
- before each attempt of a run, when a source file changed (`registry.refresh`, the build's stamp: size and modification time of every file esbuild read, plus the test glob's result);
- when someone presses **Reload** (a text button on the pack page and in the Packs list, `POST /packs/:id/reload`).

So a change made anywhere else shows only after a press of Reload, a run, or a restart. The button was there, but nothing pointed at it, and the pack page's error card said "the server builds the pack again by itself", which is true only for saves in its own editor. New run didn't listen for pack events at all, so even a reload elsewhere left its form on the old parameters until the page was opened again.

## Options

1. **A refresh button only.** Cheap, works everywhere, but you have to know the page is stale. The complaint is exactly that it doesn't look stale.
2. **Watch the files with `fs.watch`** (recursive). Instant, but:
   - Bind mounts in Docker Desktop on Windows and macOS, network shares (SMB, NFS) and some sync folders deliver no change events into the container. Watchwright's Docker image with `/packs` mounted from the host is a main way to run it, so the feature would silently not work there.
   - A recursive watch covers `node_modules`, `.git` and test output in the pack's folder (thousands of folders on Linux, one inotify watch each), unless every folder is filtered by hand.
   - It misses files outside the pack's folder that the pack imports (a shared `../shared.ts`), unless every outside file gets its own watcher.
   - Saving in an editor fires several events per save (temp file, rename, write); it needs a debounce anyway.
3. **Check the stamp on a timer (polling).** Every few seconds, compare each pack's build stamp with the files on disk, using the list of files esbuild actually read (inside or outside the folder). It's a `stat` per source file, nothing is read unless something changed. Works the same on every file system, mount and OS, and only rebuilds when a file the build uses changed, so editing a README or a test's output never triggers it. A few hundred `stat` calls every 2 seconds cost nothing measurable.
4. **Check on read** (`GET /packs/:id` looks at the stamp). Covers agents too, but a page left open still goes stale, and every request would pay for the check.

## Decision

Options 3 and 1 together, with the page following along:

- **Automatic rebuild (polling).** The packs plugin checks every pack's stamp every 2 seconds and rebuilds the ones whose files changed. A pack whose build fails isn't rebuilt again until its files change again (the broken stamp is remembered, as `refresh` already does before attempts). A pack that has never loaded has no list of source files; for it the check stamps the pack's own folder instead (every file's size and time, skipping `node_modules`, hidden folders and build output, at most 2,000 files), so fixing it brings it back without a press. On by default; an admin can turn it off (**Admin › Packs**, setting `packs.watch`) for packs on a slow network share, where Refresh still works.
- **A refresh icon** (the circular arrow) replaces the Reload text button on the pack page and in the Packs list, and joins the pack line on New run. It spins while the pack builds and says what happened: built again with no change, what changed (tests, parameters, tasks), or why it doesn't load. Pressing it always builds the pack again, even when no stamp changed, so it also picks up changes the check can't see (a shared folder above the pack copied onto the server after the pack failed to load).
- **Pages follow.** Every rebuild sends `pack.loaded` (with `by: "files"` when the timer found the change), which the pack page and the Packs list already reload on. New run now listens too: it adds new parameters with their defaults, drops ones that are gone, keeps values you already typed, and drops chosen tests the pack no longer has.
- The error card no longer says the server rebuilds by itself unless the setting is on.

Runs are unaffected: a run holds its build, and before each attempt it already takes the newest good build, so a rebuild from the timer during a run is the same as a save in the editor during a run.

Not done: `fs.watch`, for the reasons above. If polling turns out too slow for someone, a watcher can be added later as a faster trigger for the same check, without changing what the check does.
