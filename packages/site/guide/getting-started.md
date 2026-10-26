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
pnpm serve            # builds, then starts the server at http://127.0.0.1:7420/
```

Open `http://127.0.0.1:7420/` to see the web page. It shows whether the server is up, whether the live connection is open, the data folder and the loaded plugins.

## Options

`watchwright serve` takes these options:

| Option | Default | What it does |
| --- | --- | --- |
| `--port` | `7420` | Port for the web page and the API. |
| `--host` | `127.0.0.1` | Address to bind. Only loopback addresses are allowed until token auth is built. |
| `--data` | see below | Folder for the database and everything runs save. |

## Data folder

Watchwright keeps its SQLite database and everything runs save in one folder. It picks the first of:

1. the `--data` option,
2. the `WATCHWRIGHT_DATA` environment variable,
3. the usual app data folder: `%LOCALAPPDATA%\Watchwright` on Windows, `~/Library/Application Support/Watchwright` on macOS, `~/.local/share/watchwright` on Linux.

## Next steps

- [How it works](./how-it-works) explains runs, attempts and plugins.
- [Writing a test pack](./test-packs) shows what a pack will look like.
- [HTTP and WebSocket API](../reference/http-api) lists what you can call today.
