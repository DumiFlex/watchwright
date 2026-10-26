# Safety

Watchwright drives a real browser on your machine, so its server is careful about who can talk to it.

## Who can reach the server

The server listens on `127.0.0.1` only. A server on localhost is still reachable from any web page open in the same browser, through a form post or a DNS-rebinding page, so it also checks every request:

- The `Host` header must be `127.0.0.1`, `localhost` or `[::1]` with the server's port. Anything else gets `403` with the code `bad_host`.
- A request that changes something, and every WebSocket connection, must come from the server's own page. A request with another `Origin` gets `403` with the code `bad_origin`. Requests with no `Origin` at all, such as curl, scripts and agents, are allowed.

Binding to another address (`--host 0.0.0.0`) is refused until token auth is built.

## What packs can do

A test pack is code that runs on your machine with your permissions. Only add packs you wrote or trust.

## What runs save

Results, screenshots, videos and traces are written to the [data folder](./getting-started#data-folder), and the server only serves files from inside it. Collectors that save network traffic will drop `Authorization`, `Cookie` and `Set-Cookie` headers before saving.
