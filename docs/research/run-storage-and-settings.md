# Run storage, run video and settings during a run

Dumi asked for this on 2 November 2026, after the [functional audit](functional-audit.md):

- change a run's settings while it goes, starting with how long a broken pause waits, instead of keeping what was set at the start;
- an optional video of the whole run (off by default);
- a warning about storage for per-test videos and the run video;
- how much space each run takes on the drive.

The audit adds three items that fit here: no cleanup of old runs (finding 6), keeping videos only for attempts with problems (6), and resuming runs a restart interrupted (7).

## What is there now

- A run's options (`pauseOnBroken`, `pauseLimitMinutes`, `attempts`, `trace`, `video`, `signIn`) are set at the start and saved with the run. The engine reads them into its run context once. A broken pause gets its deadline when it begins.
- Video: when `video` is on, each page records one `.webm` per top-level attempt. Playwright's screencast does the recording through its own ffmpeg, and the files sit in the attempt's folder.
- The live view gets JPEG frames of every page. Nothing writes them to disk.
- Nothing measures how big a run's folder is or how much space the drive has left. Nothing deletes old runs, and deleting a run keeps its events.
- A restart leaves runs interrupted until someone presses Resume. Alert rules have no trigger for that.

## Design

### 1. Settings that change during a run

A new action, `runs.settings` (`POST /runs/:id/settings`), changes a run that is going (or queued). It takes only what can safely change mid-run:

| Setting | When it takes effect |
|---|---|
| `pauseOnBroken` | the next broken attempt |
| `pauseLimitMinutes` | at once: a broken pause that is going gets a new deadline counted from when it began (already past means it skips now) |
| `testTimeout` (ms, the run's own, over the pack's) | the next attempt |
| `trace` (`problems`, `always`, `never`) | the next attempt |
| `video` (`always`, `problems`, `never`) | the next attempt |
| `runVideo` (on or off) | at once |

The new values are saved with the run, so a resume keeps them, and announced as `run.settings` (who changed what). Settings that would change the plan (`attempts`, parameters, tests) don't change here: queue edits and Add tests already cover the plan.

- Web: a **Settings** button on a going run's page opens a small panel with these controls, set to the run's current values. The broken-pause banner gets a **More time** button (+10 minutes) next to Retry and Skip.
- CLI: `watchwright runs settings <run> --pause-limit-minutes 60`, generated from the action. MCP: reached through `call_action` (no tool of its own: a person usually makes these changes).

### 2. Video: per attempt, on problems, and the whole run

`video` takes a mode, and `true` and `false` keep meaning `always` and `never`:

- `always`: what `true` does now.
- `problems`: record each attempt, and delete the video when the attempt passes or is skipped. Same rule as `trace`.
- `never`.

`runVideo` (pack option `run.runVideo`, run option, off by default) records one video of the whole run: whatever the live view follows, for the whole run, pauses included. The engine feeds the live frames it already gets into Playwright's own ffmpeg: JPEG frames in, a VP8 `.webm` out, the same encoder Playwright uses for its own videos. It is checked here: the bundled ffmpeg reads `image2pipe` MJPEG and writes VP8 WebM. A timer writes the newest frame of the followed page 10 times a second, so pauses and slow pages come out at real time. The file is `runs/<run>/run-video.webm`, shown on the run page and in the zip export. A resumed run starts a second part (`run-video-2.webm`) instead of appending. If ffmpeg is missing or fails, the run goes on without it and logs one warning, as it does for per-attempt video now.

Size: Playwright's per-attempt videos run at about 1 Mbit/s, roughly 450 MB an hour (a 26-second attempt on the bench PC is 4.9 MB). The run video uses 10 frames a second and a lower bit rate, an estimated 200 MB an hour; it will be measured when it's built. The run page shows the file's size as it grows.

### 3. Storage: per run, the whole data folder, warnings

- **Per run:** the engine adds up the bytes it writes for each run (artifacts as they are registered, plus the run video) and keeps the total on the run row (`size_bytes`, a new migration). A finished run's size is measured once from its folder, so files written by hand count too. Older runs get theirs measured the first time they are listed, in the background. Shown on the run page (next to the counts), as a column in the runs list, and in `runs.get` / `get_run`.
- **Whole data folder:** a **Storage** section in Settings shows the drive's free space, the space runs take, and the largest runs, each with a link.
- **Warnings:** before a run starts, and every minute while one goes, the engine checks the drive's free space (`fs.statfs`). Below a threshold (setting `storage.warnBelowGB`, default 5 GB) it warns once per run: a banner on the run page, a log line and a `storage.low` event that alert rules can use (a new `storage_low` trigger). Below a hard floor (`storage.stopBelowGB`, default 1 GB) it stops recording videos for the rest of the run and says so, so the run can finish without filling the disk. It does not stop the run.
- **Cleanup:** the Storage section also has **Keep runs for N days** and **Keep the last N runs of each pack** (both off by default). Labeled runs and runs that are going are always kept. A daily sweep, and a **Clean up now** button with a preview ("deletes 42 runs, 18.3 GB"), delete the rest through the same path as `runs.delete`. Deleting a run now also deletes its events.

### 4. Resume after a restart

- A setting, **Resume interrupted runs when Watchwright starts** (off by default). When it is on, at start the runs left interrupted by a stop or a crash are queued to resume, oldest first. A run a person stopped stays stopped.
- A new alert trigger, `interrupted`, so a crash at 2 am can send a message.

## Order of the work

1. Settings during a run (1). Small to medium.
2. Video modes and the run video (2). Medium.
3. Per-run size, the Storage section, warnings and cleanup (3). Medium to large.
4. Resume after restart and the interrupted alert (4). Small.

Each part is its own PR, with tests, docs and screenshots.

## Choices made (say if any should go the other way)

- The run video follows what the live view follows (the active page). It is not one video per tab.
- `video: "problems"` keeps a video for failed and broken attempts, as `trace: "problems"` does.
- Low disk space never stops a run on its own. It only stops recording videos below the hard floor.
- Cleanup is off until someone turns it on, and it never deletes a labeled run.
