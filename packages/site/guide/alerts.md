# Alerts

Alerts send a message to your phone or a chat when something needs you: a run fails, a pack passes again, a test breaks, a schedule misses a time, or an agent waits for your approval. Set them up in Settings, under Alerts. **Channels** say where messages go, and **rules** say when.

## Channels

| Type | Where it goes | What to paste |
|---|---|---|
| ntfy | The [ntfy](https://ntfy.sh) app on your phone or desktop | The topic's address, such as `https://ntfy.sh/some-long-unguessable-name`, or one on your own ntfy server |
| Discord | A Discord channel | The channel's webhook address (Edit channel > Integrations > Webhooks) |
| Slack | A Slack channel | An incoming webhook address of a Slack app |
| Webhook | Anything that takes a JSON POST | Its address |

ntfy and webhook channels can also send a token, as `Authorization: Bearer <token>`, for a protected topic or your own service.

Anyone who has a channel's address can send to it, so treat it like a password. Watchwright never shows it again once saved, only its site (`https://ntfy.sh/…`). You can keep it in [Secrets](./yaml-tests#secrets) instead: write `${secret.NAME}` as the address or token.

**Send test** sends a message now and says why if it didn't arrive.

## Rules

A rule picks when to send, for which packs or schedules, and to which channels.

- **A run fails**, **ends with broken tests**, **doesn't start**, **passes** or **is stopped**: when a run ends that way.
- **A run passes again**: when a run passes after the last run of the same pack (or the same schedule, for a scheduled run) didn't.
- **A test breaks**: while the run is still going, so you can look before it ends. It links to the attempt.
- **A schedule misses a time**: a time missed while Watchwright was off, or skipped because the schedule's last run was still going. See [Schedules](./schedules).
- **An agent waits for approval**: an agent asked for something that needs you to approve it on the Watchwright page.

With no packs or schedules picked, a rule covers all of them. Approvals aren't about a pack, so a rule sends them whatever packs it covers.

**Only on change** (on by default) sends one message when a pack's outcome changes, not one for every run. A pack that fails every night tells you the first night, and then again when it passes ("passes again") and fails another time. Turn it off to hear about every run. A rule that tells about broken tests sends one message per run with it on.

## Messages

A message says what happened in one line, and links to the run on the Watchwright page (`http://127.0.0.1:7420/#/runs/<id>`). The link works on the computer Watchwright runs on.

A webhook gets this JSON:

```json
{
  "source": "watchwright",
  "trigger": "failed",
  "title": "Shop: failed",
  "text": "Run 0a1b2c3d (nightly) failed: 11 passed, 1 failed of 12.",
  "link": "http://127.0.0.1:7420/#/runs/0a1b2c3d",
  "event": { "seq": 1234, "type": "run.finished", "runId": "0a1b2c3d", "data": { "status": "finished", "counts": { "passed": 11, "failed": 1 } } }
}
```

Secrets are masked (`•••`) in every message, as they are in what runs record.

## When a message doesn't arrive

A message that doesn't arrive is tried three more times: after 5 seconds, 30 seconds and 2 minutes. Then it gives up and says why under **Sent lately** in Settings, and the event log gets an `alert.failed` event.

## From an agent or a script

Channels, rules and what was sent lately are in the [HTTP API](../reference/http-api#alerts), and so on the command line and as MCP actions. Adding, changing or deleting a channel or a rule from anything but the web page waits for you to approve it there.
