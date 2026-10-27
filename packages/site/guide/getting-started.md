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

The second line downloads the browsers Playwright drives. On the web page, open **Packs** and add a test pack by its folder path. Then press **New run**: search or pick tests by section and tag, set the parameter values and options (attempts per test, trace, video, pausing on a broken test), and start it. The **Planned** panel shows every attempt in the order it will run, and which tests join because a chosen one needs them. The run page shows the browser live with the current test and step, and has the controls to pause, retry, skip and stop. While it runs you can skip attempts that haven't started or move tests up and down the queue, and **Mark** saves what the live view shows to the current attempt with a note. The log filters by test and by warnings. Click an attempt in the queue to open its page: the error, flags (robot problems apart from findings), metrics and notes, then tabs for the screenshots (with a full-size viewer; scroll shots as one strip), kept texts, the log, collector records in a table, the video, and the trace, which opens in Playwright's trace viewer served by Watchwright. J and K step to the next and previous attempt. **Runs**, the home page, lists the runs that are going and every earlier one, with filters by pack and status; from there you can open a run again, start a new one with the same choices, or delete it.

## Options

`watchwright serve` takes these options:

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
