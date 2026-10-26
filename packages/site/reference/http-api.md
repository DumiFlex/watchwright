# HTTP and WebSocket API

Everything the web page does is an HTTP call, so scripts and AI agents can do the same. All routes live under `/api/v1` on the server's address, by default `http://127.0.0.1:7420/api/v1`.

## Responses

A success is `{ "data": … }`. A failure is `{ "error": { "code", "message", "detail"? } }`, with a snake_case `code` you can match on:

```json
{
  "error": { "code": "not_found", "message": "No API route GET /api/v1/nope" }
}
```

Requests must pass the [request guard](../guide/safety#who-can-reach-the-server).

## Available now

### `GET /health`

Whether the server is up, its version, its data folder and the loaded plugins with the newest store migration each one applied.

```bash
curl http://127.0.0.1:7420/api/v1/health
```

```json
{
  "data": {
    "name": "watchwright",
    "version": "0.1.0",
    "dataDir": "/home/you/.local/share/watchwright",
    "plugins": [{ "name": "core", "schemaVersion": 1 }]
  }
}
```

### `WS /live`

The live channel. Today it sends one greeting when the connection opens:

```json
{ "type": "hello", "data": { "version": "0.1.0" } }
```

With the run engine it will stream events as JSON text messages and screencast frames as binary messages.

## Planned

These routes come with the run engine:

| Method and path | Does |
| --- | --- |
| `GET /packs`, `POST /packs`, `GET /packs/:id` | List packs, add one by path, read one with its tests, params and flag kinds. |
| `POST /packs/:id/reload` | Reload a pack now. |
| `GET /runs`, `POST /runs`, `GET /runs/:id` | List runs, start one, read one with its attempts. |
| `POST /runs/:id/pause`, `/resume`, `/retry`, `/skip`, `/stop?when=after\|now`, `/redo-broken` | Control a run. |
| `GET /runs/:id/attempts/:attemptId` | One attempt's result document, versioned with `schemaVersion: 1`. |
| `GET /files/*` | Files runs saved, from the data folder only. |
| `GET /events?after=<seq>&wait=<s>` | Events after a cursor, waiting up to `wait` seconds (at most 110) when there are none. |

Events share one shape on the WebSocket and in `GET /events`: `{ seq, time, type, runId?, attemptId?, data }`.
