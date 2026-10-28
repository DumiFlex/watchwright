# Getting started

Watchwright runs as one long-lived server on your machine. You start it once, and it serves its web page and its HTTP API on `http://127.0.0.1:7420/`.

## Requirements

- Node.js 22 or newer
- pnpm 9 (`corepack enable` sets it up from `package.json`)
- Windows, macOS or Linux. Windows is the first platform the run engine is checked on.

## Install and start

Watchwright isn't published to npm yet, so you run it from a clone of the repository:

```bash
pnpm install
pnpm --filter watchwright exec playwright install chromium firefox
pnpm serve            # builds, starts the server at http://127.0.0.1:7420/ and opens it
```

The second line downloads the browsers Playwright drives.

## A first run

1. On the web page, open **Packs** and add a test pack: type its folder (the field completes folders as you type), or press **Browse…** and pick it, or let **Find packs in a folder…** search for it. You can also name pack folders when you start the server: `watchwright serve path/to/pack`. See [Adding a pack](./test-packs#adding-a-pack).
2. Press **New run**. It opens on the pack of your latest run, filled with that run's choices (**Use pack defaults** starts over; Settings can make it always start from the defaults). Search or pick tests by section and tag, set the parameter values and the options (attempts per test, trace, video, pausing on a broken test), give the run a label if you like, and start it with the button or Ctrl+Enter (Cmd+Enter on a Mac). Choices you use often can be saved as a **preset** with the menu beside the preset list, and picked again later; agents can start a preset by name. The **Planned** panel shows every attempt in the order it will run, and which tests join because a chosen one needs them.
3. The run page shows the browser live with the current test and step, and has the controls to pause, retry, skip and stop. While it runs you can skip attempts that haven't started, move tests up and down the queue, or add tests to the end of it. **Rewind** under the live view scrubs back through the last 30 seconds, with the steps that ran then. **Mark** saves what the live view shows (or the rewound moment) to the current attempt with a note. The log filters by test and by warnings.

## Looking at results

Click an attempt in the queue to open its page. It shows the error (with **In your code**, the line of your test it broke on), the flags (robot problems apart from findings), metrics and notes. When the test names its steps (`h.step`), a **Steps** timeline shows when each ran and how long it took, with warnings from the log as marks; picking a step jumps the video there. The same timeline sits under the video and follows it as it plays, and dragging either one moves the video. When steps are too short for their names, the timeline opens zoomed in and scrolls sideways with the playhead (also while you drag the playhead against an edge); zoom with its buttons, + and -, or Ctrl (Cmd on a Mac) with the mouse wheel. Hovering shows the time, the step and any warning under the pointer above the timeline, and warnings too close together show as one mark with their count. Attempts recorded before steps were kept read their steps from the log's `Step:` lines (without outcomes). Then come tabs for:

- the screenshots, with a full-size viewer (scroll shots show as one strip),
- kept texts,
- the log,
- collector records in a table,
- the video,
- the trace, which opens in Playwright's trace viewer served by Watchwright.

J and K step to the next and previous attempt. Beside the results, the **Review** panel scores the attempt on the pack's rubric (see [Reviewing results](./reviewing)).

A finished run's page shows every test's attempts and scores as a grid, with **Compare** and **Export** (Markdown, or a zip with the screenshots). **Compare** in the top bar lines up runs of one pack side by side; it opens on the latest finished run's pack with its two latest finished runs.

**Runs**, the home page, lists the runs that are going and every earlier one, with a search (words in the label, id, pack name, values or status; `lang=de` finds a value) and filters by pack and status. From there you can open a run, **Run again** (the same pack, tests, values and options, started at once), start a new one from its choices with **New run like this…**, or delete it. A run's page has the same buttons, and the pencil beside its title gives it a name that shows in the lists, Compare and exports.

Above the list, **At a glance** shows the last 7, 14 or 30 days: how many runs, the pass rate (passed out of passed, failed and broken), broken attempts and the median attempt time, each with its change against the same number of days before and a small trend line, and a chart of attempts per day by outcome (point at a day for its numbers). It follows the pack filter, so picking a pack shows that pack's numbers. Days are your computer's calendar days.

Press Ctrl+K (Cmd+K on a Mac) anywhere, or the search button at the top, to find a pack, a run (by pack, label, id, values or status) or a test, or to run a command: run the latest run again, start a new run of a pack, add a pack, go to a page, or switch the look and mode.

### Watching a run

While a run goes, the browser tab's title says how it's going (`Running 4/12`, `Paused: S1 broke`, `Done 12/12`) and the tab's icon gets a dot in the state's color, so a tab in the background still tells you. On the run's page these keys work the run (press `?` for the list):

| Key | What it does |
| --- | --- |
| Space | Pause, or resume a pause you made |
| R | Retry the broken attempt the run paused on |
| S | Skip it: keep its result and go on |
| M | Mark: save the live view to the running attempt, with a note |
| Shift+S | Stop after this test |

Watchwright can also send a desktop notification when a run finishes, pauses on a broken test (with the minutes left before it skips the test by itself) or fails to start, while its tab is in the background; clicking one opens the run. Switch them on under **Notifications** in **Settings**, or answer the offer that shows the first time you start a run. The choice is kept by each browser. While the tab is in front, the same news shows as a short message in the corner, except on that run's own page.

File names of your tests, build errors and the line a test broke on are links that open in your editor at that line. Pick the editor (VS Code, Cursor, Windsurf, IntelliJ IDEA, WebStorm, or none) on the **Settings** page (the gear at the top), which also has the look and mode, notifications, what a new run starts from, the list of recent folders, and **Stop Watchwright**. That button stops the server, as Ctrl+C in its terminal does. Runs going at the time can be resumed after it starts again.

## Options

`watchwright serve [pack folder…]` adds the pack folders you name (or reloads them when they are already added). When Watchwright is already running on the port, it adds them there, opens the page and exits; when another program has the port, it says so. It takes these options:

| Option | Default | What it does |
| --- | --- | --- |
| `--port` | `7420` | Port for the web page and the API. |
| `--host` | `127.0.0.1` | Address to bind. Only loopback addresses are allowed until token auth is built. |
| `--data` | see below | Folder for the database and everything runs save. |
| `--no-open` | off | Don't open the web page in your browser on start. |

## Data folder

Watchwright keeps its SQLite database and everything runs save in one folder. It picks the first of:

1. the `--data` option,
2. the `WATCHWRIGHT_DATA` environment variable,
3. the usual app data folder: `%LOCALAPPDATA%\Watchwright` on Windows, `~/Library/Application Support/Watchwright` on macOS, `~/.local/share/watchwright` on Linux.

## Next steps

- [How it works](./how-it-works) explains runs, attempts and plugins.
- [Writing a test pack](./test-packs) shows how to write a pack.
- [HTTP and WebSocket API](../reference/http-api) lists every route, event and the live WebSocket.
