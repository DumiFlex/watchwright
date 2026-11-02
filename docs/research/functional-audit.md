# Functional audit: what breaks on long runs

A pass over Watchwright as it stands on `dev` (after #153), looking for bugs, slow paths and gaps in what exists today: the run engine, the live view, logs, the CLI and MCP, and how it behaves on Windows. New capabilities (scraping and the rest) are out of scope. The UX audit of October 2026 ([ux-audit.md](ux-audit.md)) covered layout traps; this one goes after correctness and robustness.

## How it was checked

- Read the engine, run control, queue, browser session, event log, live channel, CLI, MCP door, schedules, recordings and the run pages of the web app.
- Ran the test suite: 917 tests pass.
- Ran a real server with a probe pack against a small local site, for the cases the tests don't cover: a test that leaves a promise un-awaited, a test stuck in one long Playwright call, popups, a secret typed into a field on a broken attempt.
- Timed `GET /runs/:id` and the run wait against a seeded store (500 and 2,000 attempts with logs).

Not checked here: Firefox and real Windows paths. Those need a pass on the PC.

## Findings, worst first

| # | Where | What happens | Fix | Size |
|---|---|---|---|---|
| 1 | Engine, whole server | **One un-awaited promise in a test kills the server.** A test that starts a Playwright call without `await` (`void page.waitForSelector(…)`) and ends before it does: the call fails later, Node treats it as an unhandled rejection, and the server exits mid-run. Every run on the server becomes interrupted and nothing resumes it. Reproduced with a two-test pack. Easy to write by hand, easier for an agent writing tests. | Handle `unhandledRejection` (and errors thrown from pack code outside an attempt) in `serve`: log them on the attempt that is running (or the run's log) as a warning and keep going. Exit only on errors that come from Watchwright itself. | Small |
| 2 | Secrets | **Secret values are in plain text in `trace.zip`.** Masking covers logs, events and results, but a trace records every action's parameters, so `fill` with `${secret.X}` lands in `trace.trace` as typed. Traces are kept on every broken or failed attempt by default, served at `/files/…` and go into the zip export. Reproduced: the secret was found in the trace of a broken attempt. | Scrub every secret value from the text entries of a trace zip before it is registered (the same mask the engine uses), and say in the docs that video and screenshots still show what the page shows. | Small to medium |
| 3 | Run wait (CLI `--wait`, `wait`, MCP `wait_for_run`) | **Waiting on a run re-reads the whole run after every event.** Each wake loads every attempt row (log and steps included) and builds the digest: about 20 ms at 500 attempts and 85 ms at 2,000 (measured). A busy run sends many log events a second, so one agent waiting on a big bench can keep the server's event loop busy most of the time, which slows the live view and the run itself. | Check the run's status with one cheap row read on each wake; build the digest only when the wait returns. | Small |
| 4 | Editor, run dock | **The run dock beside the editor replays the run's whole event log**, the slowness #153 fixed on the run page: it subscribes from event 0 with no tail. While it replays, old steps show as the current one (the banner bug #137 fixed on the run page). | Subscribe from the server's head, take the step and pages from the run's snapshot, as the run page does. | Small |
| 5 | Run page | **The run page fetches the full run after every attempt starts or finishes.** At 2,000 attempts that is about 780 KB of JSON and 90 ms on the server each time; quick tests make it several times a second. | Patch the plan and counts from `attempt.started` / `attempt.finished` events, and fetch the full run only on open, on reconnect and at the end. | Medium |
| 6 | Disk | **Nothing is ever cleaned up.** Runs, their videos (on by default, one per attempt) and the event log grow until the disk is full; deleting a run leaves its events behind. An overnight bench of 2,000 attempts makes thousands of videos. | Feature: a Storage section in Settings: keep runs for N days or the last N per pack (labeled runs kept), delete a run's events with it, show the data folder's size. Plus `video: "problems"` (keep a video only for failed and broken attempts), as `trace` already has. Needs a short design note. | Medium |
| 7 | Restarts | **An interrupted run waits for a person.** After a crash (see 1), an update or a reboot, every run that was going stays interrupted until someone presses Resume; an overnight bench that stopped at 2 am is still stopped at 9, and no alert says so: alert rules have no trigger for an interrupted run. | Feature: a setting to resume interrupted runs when the server starts (off by default), and an `interrupted` alert trigger. | Small to medium |
| 8 | Windows | **Test ids that differ only by case share a folder.** Results go to `runs/<run>/<test id>/attempt-N`; NTFS doesn't tell `a1` from `A1`, so the second test's files overwrite the first's. Ids such as `CON` or `NUL`, or ones that end in a dot, can't be folders on Windows at all. | Refuse such ids when the pack loads, with a message that names the clash (the same on every OS, so a pack that works on Linux works on Windows). | Small |
| 9 | Engine, browser | **Tabs and popups a test opens stay open for the rest of the run.** Later tests share them, each keeps its own screencast running, and the live view can stay on a stale popup while the next test works on the main page. Over a long run they pile up. | Close every page but the main one between attempts (a pack option to keep them for packs that rely on it). | Small |
| 10 | Attempt log | **An attempt's log has no limit.** A test that logs in a loop grows one database row without end and sends one event per line. | Keep the first and last few thousand lines of an attempt and count the rest. | Small |
| 11 | Files route | `/files/runs/…` checks the path but not where a link inside the run folder leads; `runs.file` (the agents' route) does both. | Add the same real-path check. | Tiny |
| 12 | Windows, shutdown | Closing the console window (or Ctrl+Break) ends the server without its shutdown: browsers are killed and runs are marked interrupted only at the next start. | Handle `SIGHUP` and `SIGBREAK` like `SIGINT`. | Tiny |
| 13 | CLI | CLI requests have no time limit: a server that hangs makes `watchwright status` hang too. | A timeout on requests other than waits. | Tiny |

### A question, not a bug

**Stop after this test, while paused in the middle of a test**, ends that test as stopped right away, the same as Stop now. The tests say this is on purpose. The other reading is that the paused test should finish first and the run stop after it. Worth a decision; no change until then.

## Checked and fine

- A test stuck inside one long Playwright call past its time limit: the context is replaced after 10 s, the attempt breaks with a clear message, and the next tests run normally (tried by hand).
- Popups are followed by the live view; queue skip and move, adding tests, resume after a restart and redo of broken attempts (covered by tests).
- The rewind buffer is bounded (30 s per page, at most 5 frames a second); frames to slow viewers drop instead of piling up.
- Recording and explore sessions close themselves when idle (30 min, 15 for agents), so a forgotten session doesn't hold a site's runs for good.
- MCP sessions are swept when idle; after a restart clients are told to initialize again.
- Schedules: missed times run once or are skipped as set; a schedule whose last run still goes skips its time.

## Suggested order

1. The three that can lose or leak a run: **1** (server crash), **2** (secrets in traces), **3** (wait load). One PR each.
2. The small fixes: **4, 8, 9, 10, 11, 12, 13**.
3. **5** (run page refetch).
4. The two features, each with a short design note first: **6** (storage and retention, video on problems) and **7** (resume after restart).
5. A pass on Dumi's PC for what this sandbox can't check: Firefox, Windows paths, closing the console window.
