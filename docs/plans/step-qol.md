# Quality-of-life step plan

Status: planned (2026-10-27). It comes after step 3 and before step 4 in the build order ([docs/plan.md](../plan.md), section 1). [docs/plan.md](../plan.md) holds the base design, [step-2.md](step-2.md) the web app.

Steps 1 and 2 built what Watchwright can do. This step makes it pleasant to do it: fewer things to type, fewer things to remember, fewer pages to visit, and no layout that breaks. It started from Dumi's complaint that adding a pack means typing its folder path by hand (2026-10-27), so the pack-location work comes first.

Everything here is general. Nothing is for one site or one pack.

## 1. The audit

I ran the app from `dev` (v0.3.0) with three demo packs and two finished runs, used every page at desktop and phone width, ran the CLI, and read the views and the packs plugin. Screenshots are in [docs/screenshots/qol-audit/](../screenshots/qol-audit/).

| What I tried | What happened | Screenshot |
|---|---|---|
| Add a pack | The only way is to type or paste the folder's absolute path. There is no way to browse to it, no list of recent folders, no way to find packs in a folder. | `packs-quoted-path.png` |
| Paste a path from Windows Explorer ("Copy as path") | Explorer wraps the path in quotes, and the server answers "Give the pack's absolute path." The path was absolute; the quotes weren't stripped. | `packs-quoted-path.png` |
| Look at a pack with a long path | The path runs out of its card into the next one. At phone width it makes the whole page 625 px wide in a 390 px window, so the page scrolls sideways. | `packs-path-overflow.png`, `packs-phone-overflow.png` |
| Remove a pack, or point a moved pack at its new folder | Neither is on the page. The API has `DELETE /packs/:id`; nothing can move a pack and keep its runs. | |
| Open the pack's folder, or a test file | The card shows the path to `pack.ts` as text. Nothing opens the folder or the file in an editor. | `pack-recent-runs.png` |
| Start a second run with the same values | New run always opens on the first pack in the list, with the pack's defaults (`en`, `boots`), even though the last run used `de` and `hat`. "New run like this" exists, but only from a run's page or menu. | `new-run-defaults.png` |
| Run the same thing again | There's no one-click "Run again"; it always goes through the form. | |
| Find an older run | Runs are named by pack and an 8-character id. There is no search and no way to give a run a name. The pack page's "Recent runs" lists only ids. | `runs-list.png`, `pack-recent-runs.png` |
| Compare | Opens empty every time: pick the pack, then the runs, even when there is one pack and the last two runs are the obvious pair. | `compare-empty.png` |
| Wait for a long run in another tab | Nothing tells you it finished or that it paused on a broken test (which skips by itself after 20 minutes). The tab title is always "Watchwright". | |
| Control a live run from the keyboard | Pause, Resume, Retry, Skip and Stop are buttons only. Ctrl+K only goes to pages and themes; it can't find a run, a pack or a test. | |
| `watchwright serve` when it's already running | `listen EADDRINUSE: address already in use 127.0.0.1:7420`, and the page doesn't open. | |
| Start the server for a pack you're writing | `serve` takes no pack, so you start it, then add the pack on the page. | |
| Write a first pack | You start from an empty folder and the docs. There's no starter. | |

## 2. Research

**Why the server has to do the folder browsing.** A web page can't learn a folder's absolute path. `showDirectoryPicker()` returns a handle with a name and no path (and Firefox, which the PC uses, doesn't have it). `<input webkitdirectory>` gives the files with paths relative to the picked folder, never the folder's own path. A dropped folder is the same. The browser hides paths on purpose, so every self-hosted tool that needs one (Jupyter, code-server's "Open Folder", Portainer, Syncthing) lists folders from the server and draws its own picker. Watchwright's server runs on the same machine as the pack, so it can do the same.

**Why not the system's own dialog.** The server could open a native folder dialog (PowerShell's `FolderBrowserDialog`, `osascript`, `zenity`). It would appear on the machine running the server, which isn't always the screen you look at, it can't be themed, and on Linux it needs a desktop. The project rule is no default-looking UI. So: a themed folder browser in the page, and the native "Open folder" only for showing a folder in Explorer or Finder.

**Is listing folders safe?** The request guard already makes sure only the server's own page (or a client without `Origin`, like an agent) can call the API, and pack code already runs with the user's rights, so listing folder names adds no new reach. The browser action lists names of folders and pack files only (no other file names, no contents), never follows a path outside what the OS lets the server read, and has a cap on entries. It is still a read of the disk, so it's an action like any other and agents get it too.

**How others do "find projects".** VS Code and JetBrains remember recent folders; Playwright's own VS Code extension finds `playwright.config.*` files in the workspace. Watchwright does both: recent folders, and a scan of a folder for pack files (skipping `node_modules`, `.git`, `dist` and hidden folders, a few levels deep).

**Notifications.** The Notification API needs a secure context. `http://127.0.0.1` and `http://localhost` count as secure in Chromium and Firefox, so desktop notifications work without HTTPS. The page asks for permission only when you turn them on.

**Open in editor.** Editors register URL schemes: `vscode://file/<path>:<line>`, `cursor://file/…`, `jetbrains://…`/`idea://open?file=…`. A link is enough, no server work, and the editor is a setting.

**Remembered choices: server or browser.** Things that describe a run (the last values for a pack, presets) already live in the store as runs, so the server derives them; nothing new to keep in sync, and agents see the same. Things that belong to one browser (notification permission, a collapsed panel) stay in that browser's storage. A few machine-wide preferences (the editor, recent folders) go in a small settings table.

## 3. The improvements

Grouped by area, in the order they'd be built. Group A is the pack-location fix.

### A. Adding and finding packs

1. **Folder browser.** "Browse…" beside the path field opens a themed dialog: a path bar with breadcrumbs, the folders inside (pack folders marked with a badge and their pack name), places on the left (home, the drives on Windows, recent folders, the folders of packs already added), and "Add this pack" when the open folder has a pack file. Keyboard: type to filter, Enter to open, Backspace to go up. A new kit component, `FolderBrowser`, shown at `#/kit`. Server: action `folders.list` (`GET /folders?path=`) in a new built-in `folders` plugin, so later capabilities that need a folder (a scrape's output, a dataset) reuse it.
2. **Path field that completes.** Typing in the path field suggests matching folders (the same action), Tab completes like a terminal, and it shows whether the folder has a pack before you press Add.
3. **Forgiving paths.** The server strips surrounding quotes, accepts `file://` URLs, `~`, forward or back slashes on Windows, a trailing slash, and a path to the pack file itself. A relative path gets a clear message and the folder it would have meant.
4. **Find packs in a folder.** "Find packs…" scans a folder you pick (4 levels deep by default, skipping `node_modules`, `.git`, `dist`, `build` and hidden folders) and lists the pack files it finds with checkboxes; "Add selected". Action `packs.discover`.
5. **Recent folders.** The browser remembers the last 10 folders you added or opened (server-side, so every browser on the machine sees them), with a way to clear them.
6. **Add packs when you start the server.** `watchwright serve [folder…]` adds (or reloads) each pack folder given, so `watchwright serve ./watchwright` is the one command while writing a pack.
7. **Remove and move.** Remove on the pack card and page (with a confirm; runs stay). When a pack's folder is gone, the card says so and offers "Locate…", which opens the folder browser and points the pack at the new folder, keeping its id and runs (action `packs.move`).
8. **Paths that fit and do something.** Cards show the pack's folder, not `pack.ts`, with the home folder as `~` and a middle ellipsis, a copy button, and "Open folder" (Explorer, Finder or the Linux file manager; only for folders the server already knows: pack folders and run folders, action `folders.open`). Fixes the overflow on desktop and the sideways scroll at phone width.
9. **Starter pack.** In the folder browser, "New pack here" writes a starter (`pack.ts`, `tests/example.ts` that opens the site and takes a screenshot, a `README.md`) after asking for the name and the site's URL, then adds it. It refuses a folder that already has a pack file. Action `packs.create`.

### B. Starting runs

1. **New run remembers.** Opens on the pack of your latest run, and fills tests, values and options from that pack's latest run. A line says "Choices from run 3407449a" with "Use pack defaults" to reset. Opening a pack's New run from its card still works the same way, per pack.
2. **Run again.** One click on a run page and in the runs list's menu starts the same pack, tests, values and options right away (action `runs.again`). "New run like this" stays for changing something first.
3. **Presets.** Save the current choices under a name ("full, German"), pick one from a menu at the top of New run, rename or delete them. Stored per pack (actions `runs.presets.*`), so agents can start a preset by name.
4. **Name a run.** An optional label on New run (and editable on the run page), shown in the runs list, the pack page, Compare columns and exports. Default empty; the id still works.
5. **Ctrl+Enter starts the run** from anywhere in the New run form.

### C. Watching a run

1. **Tab title and icon.** The title shows the run's state and progress (`▶ 5/12 Shop smoke`, `Paused: S1 broke`, `Done 12/12`), and the favicon gets a dot in the state's color, so a background tab tells you where things are.
2. **Desktop notifications.** Opt-in (Settings, and a prompt the first time you start a run): a run finished, a run paused on a broken test (with the minutes left before it skips by itself), a run failed to start. Clicking one opens that run.
3. **Run shortcuts.** On the run page: Space pause or resume, R retry, S skip, M mark, Shift+S stop after this test. Each button shows its key, and `?` opens a sheet with every shortcut on the current page.
4. **Better `serve` start-up.** When Watchwright is already running on the port, `serve` says so, opens the page and exits cleanly. When something else holds the port, it says which port and suggests `--port`.

### D. Finding things

1. **Ctrl+K finds everything.** Packs, runs (by pack, label, id, values, status) and tests, plus commands: New run of a pack, Run again the last run, Add a pack, Browse for a pack, Settings.
2. **Search runs.** A search box on the runs list (label, id, pack, values), and the pack page's recent runs show label, time, values and results instead of ids alone.
3. **Compare opens ready.** With no pack chosen it opens on the pack of the latest run with its latest two finished runs side by side.

### E. Writing packs

1. **Open in your editor.** Test files on the pack page, file and line in a pack's load error, and stack frames in an attempt's error open in your editor (VS Code, Cursor, a JetBrains IDE, or none), chosen in Settings.

### F. Settings

1. **A Settings page** (`#/settings`, in the menu and Ctrl+K): look and mode (also still in the header), notifications, editor, recent folders (clear), and how New run starts (latest run or pack defaults). Server-side preferences go through a small `settings` plugin (actions `settings.get`, `settings.set`); per-browser ones stay in local storage.

## 4. Not in this step

- CLI commands beyond `serve [folder…]` (step 5 builds the CLI from the action registry, so every action here gets a command then).
- Anything that overlaps step 3: choice labels for params, run info, the Files tab, the step timeline, "Compare with the last run".
- A native OS folder dialog (section 2).

## 5. How it is checked

- **Server tests** (`app.inject`): `folders.list` on a temp tree (pack badges, only folders and pack files, the entry cap, a missing folder, Windows drive roots behind a platform check), the path clean-up cases, `packs.discover` skip rules and depth, `packs.move` keeping runs, `packs.create` refusing an existing pack, `runs.again`, presets, labels, settings, `serve [folder…]` and the "already running" check.
- **Web tests** (Vitest): the folder browser's keyboard and filtering, path completion, title and favicon text per state, palette search, New run prefill and reset.
- **Screenshots** of every changed page, light, dark and phone width, in each PR. The phone check includes the page's scroll width.
- **On the PC**, once, when no bench is running: add a pack with the folder browser on Windows (drives, a quoted Explorer path), "Open folder", one notification in Firefox.

## 6. Pull requests

1. This plan.
2. **A1 to A8**: the `folders` plugin, the folder browser and path completion, forgiving paths, find packs, recent folders, `serve [folder…]`, remove and move, the pack card fixes.
3. **A9 and E1**: starter pack, open in editor, and the Settings page they need (F1).
4. **B1 to B5**: New run remembers, Run again, presets, run labels, Ctrl+Enter.
5. **C1 to C4 and D1 to D3**: title and favicon, notifications, run shortcuts, `serve` start-up, palette search, run search, Compare defaults.
6. Sign-off: the PC check, docs site pages, this plan marked done.

Each PR updates the docs site (guide and API reference) for what it adds, and ships screenshots.
