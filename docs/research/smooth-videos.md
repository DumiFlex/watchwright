# Smoother, sharper videos

Dumi asked on 9 November 2026 why run videos are still blocky with an uneven frame rate, even at High, and whether the graphics card could help. This note measures real videos from Dumi's PC (Windows, Firefox, 1920×1080), finds the causes, looks at the options, and picks a design. Everything here is general: any pack's videos get it.

## What the videos look like now

Two kinds of video were on the PC from the last week:

- **Bench runs** (Wildcard Pipeline AI bench, 1600×960): every one at **Compact** (the server's Video quality setting): VP9 at CRF 40, encoded live at the fastest setting, 180–400 kbit/s. Compact was made to save room (see [video-size.md](video-size.md)), and CRF 40 is soft and blocky by design: text smears and flat dark areas break into squares when much moves at once.
- **Tutorial runs** (1920×1080): at **High** (CRF 24). Still frames are sharp (a crop of a dialog at full size reads cleanly), so the encoder isn't what makes them look rough. The frame timing is:

| Time between two frames | Share of frames (189 s tutorial video, 3,333 frames) |
|---|---|
| 30–39 ms | 64% |
| 40–49 ms | 24% |
| 60–99 ms | 8% |
| 100 ms or more (page still) | 4% |

And in busy stretches (a dialog opening, the canvas redrawing while ComfyUI generates), runs of frames 75–95 ms apart: about **12 frames a second** for a second or more.

## Why

1. **Frames land on a timer, not when they come.** Watchwright writes its own videos (`RunVideo`) by looking for the newest screencast frame on a `setInterval` (30 a second at High, 25 at the others) and stamping it with the time it looked. The browser sends frames at its own pace (about 25–60 a second), so frames are shifted onto a 33 ms grid, and Node's timer slips by up to 15 ms when the server is busy: the 33 / 45 / 66 ms pattern above. On screen that's judder: motion that speeds up and slows down although the page moved evenly. Measured on a 1080p capture from Chromium (483 frames in 8.2 s, 59 a second): the timer kept 241 of them, and that video is 37.4 dB against the real sequence, while the same encoder fed every frame at its real time gets 54.0 dB.
2. **The encoder runs live, beside the browser.** VP9 at 1080p takes one to two cores while the test runs. When the machine is busy (a browser repainting a big canvas, ComfyUI on the same PC), ffmpeg can't keep up, its input pipe fills, and `RunVideo` skips frames rather than queue them. That's the 12 frames a second in busy stretches, exactly when something is happening. Firefox's screencast itself also slows when the page is busy; Watchwright can't change that, but it shouldn't add to it.
3. **Compact is meant to be small, not sharp.** The bench uses it, so most videos Dumi opens are CRF 40.

## Options

**A. Record now, encode later.** Write the screencast's JPEG frames into a Matroska file as they arrive, each with the time it came (no ffmpeg, no CPU, just a file write), and encode the video after the attempt ends, in the background. Fixes 1 and 2 completely: every frame the browser sent is in the video at its real time, and encoding never competes with the test. Costs disk while an attempt records (JPEG frames: 50–200 kB each at 1080p, only when the page changes; a 3-minute tutorial attempt in Firefox is a few hundred MB, and the worst case, a page animating everywhere at Chromium's 60 frames a second, measured 35 MB for 5 seconds at 1280×720) and the video appears a little after the attempt ends. With `video: problems` a passed attempt's frames are simply deleted, so its video is never encoded at all.

**B. Constant frame rate output** (`-r 30`, repeating frames). Players then show a fixed 30 frames a second, but a frame that came 45 ms after the last is pushed to 33 or 66 ms, which is the judder of cause 1 again. With A, each frame already has its real time; a WebM with variable frame rate plays smoothly in every browser. Not chosen.

**C. Make frames up between real ones** (ffmpeg `minterpolate`). Motion interpolation was made for camera footage; on a page it bends text and smears edges, and it runs far slower than real time. Not chosen.

**D. The graphics card.** Every recent GPU has a video encoder that is separate from the part that runs AI models, so it doesn't slow ComfyUI:

| GPU | WebM-friendly hardware encoder in ffmpeg |
|---|---|
| NVIDIA RTX 40 and 50 (Dumi's RTX 5060 Ti) | `av1_nvenc` |
| Intel Arc, Core Ultra | `av1_qsv` (VP9: `vp9_qsv` on Intel from Ice Lake) |
| AMD RX 7000 and up | `av1_amf` |
| Linux (Intel/AMD) | `av1_vaapi`, `vp9_vaapi` |

AV1 is the newer codec: in software it reached the same picture as VP9 at about half the size on the test clip (libaom realtime, 0.93 MB vs 1.76 MB at the same 46 dB). A WebM can hold AV1, so files keep their names and play in Chrome, Edge and Firefox. Two limits: Playwright's own ffmpeg has no hardware encoders (it carries only what Playwright needs: VP8 or VP9, MJPEG), so the GPU needs a full ffmpeg on the machine (`winget install ffmpeg`, `apt install ffmpeg`, or `WATCHWRIGHT_FFMPEG`); and having the encoder in ffmpeg doesn't mean the GPU has it, so it has to be tried once. NVIDIA cards older than RTX 40 encode only H.264 and HEVC, which need MP4; that's left out (VP9 on the CPU is fine there once encoding is after the attempt).

**E. Better CPU settings.** With A, encoding no longer has to keep up with the run, but a bench of hundreds of attempts still needs the backlog to clear. On 4 cores, on the 8 s, 59 fps, 1080p clip:

| VP9 settings | Time | Size | PSNR |
|---|---|---|---|
| realtime, cpu-used 6, 4 threads, CRF 24 | 5.3–6.9 s | 3.9 MB | 54.0 dB |
| realtime, cpu-used 6, 4 threads, CRF 28 | 5.3 s | 3.2 MB | 52.3 dB |
| good, cpu-used 4, CRF 30 | 18.8 s | 2.4 MB | 51.6 dB |
| good, cpu-used 5, CRF 36 | 24.7 s | 1.6 MB | 48.7 dB |
| realtime, cpu-used 8, 1 thread, CRF 40 (Compact now) | 7.5 s | 1.8 MB | 46.4 dB |
| good, cpu-used 5, CRF 40 | 24.7 s | 1.2 MB | 46.9 dB |

"good" saves a third of the size but takes three times as long as the video, too slow for a bench backlog. The realtime setting with more threads keeps up with real time and loses nothing when it's fed every frame, so it stays, with the threads raised to half the cores (at the lowest priority, so a running test always comes first).

## Design

**Videos are recorded now and finished after the attempt** (option A), for every attempt video Watchwright writes itself: High, Compact and Small in every browser, Full in Firefox, and the attempt video that follows the live view. Full in Chromium and WebKit stays Playwright's own recorder, as before.

- While an attempt records, each kept frame goes into `video-<page>.capture.mkv` (or `video.capture.mkv` when the video follows the live view) as it arrives, stamped with the time the session got it. A frame that matches the one before isn't written twice. No ffmpeg runs during the test.
- When the attempt ends, its video row is added at once with size 0 and the capture goes into a queue. One ffmpeg at a time encodes it to the `.webm` it always had, at the run's quality, at the lowest CPU priority. When it's done the capture is deleted and the row gets its size; `result.json` is written again.
- A capture whose attempt doesn't keep its video (`video: problems`, a passed attempt) is deleted without encoding.
- A server stopped while captures wait finishes them when it starts again: each capture has a small `.capture.json` beside it with what the row needs.
- Deleting a run stops its encoding first (Windows can't delete a file ffmpeg has open).
- The attempt page shows "Finishing this video…" in place of a video that's still being made, and looks again every few seconds.
- The run video (one video of the whole run) still encodes live: a run can last hours, and its frames would take too much disk. It's a record to skim, at 10 frames a second.

**The graphics card finishes videos when it can** (option D).

- A new setting, Admin > Storage > Videos > **Encoder**: Automatic (default) or CPU only.
- Automatic looks for a full ffmpeg (`WATCHWRIGHT_FFMPEG`, else `ffmpeg` on the PATH) with `av1_nvenc`, `av1_qsv` or `av1_amf`, encodes a tiny test clip with each in that order, and uses the first that works. The answer is kept until the server restarts. Without one, Playwright's ffmpeg encodes VP9 on the CPU as before.
- The Videos section says which encoder finishes videos ("Graphics card (NVIDIA, AV1)" or "CPU (VP9)") and, on the CPU, that installing ffmpeg lets the graphics card do it.
- AV1 qualities follow the VP9 ones: same constant-quality idea, a level per quality (High 22, Full 30, Compact 36, Small 40 on the encoder's 0–51 scale). Compress kept videos leaves AV1 videos alone: Playwright's ffmpeg can't read them, and they're already small.

**Get ffmpeg** (added after, at Dumi's ask). Installing ffmpeg by hand is a step most people won't take, so the Videos section offers a button. Bundling ffmpeg as a dependency was left out: it would add 150–200 MB to every install (Docker and machines without a suitable card too), and the npm ffmpeg packages don't reliably carry the hardware AV1 encoders. Running `winget` for the person was left out too: ffmpeg only reaches the PATH of new processes, so the server would still need a restart, and on Linux it needs sudo. Instead the button downloads the [BtbN build](https://github.com/BtbN/FFmpeg-Builds) of the ffmpeg release branch (GPL, with `av1_nvenc`, `av1_qsv` and `av1_amf`; Windows x64 and Linux x64/arm64; macOS has no hardware AV1 encoder) into `<data>/tools/ffmpeg`, checks its SHA-256 against the `checksums.sha256` published in the same release, keeps only the `ffmpeg` binary, checks that it runs, and asks again who finishes videos. No admin rights, nothing on the PATH, no restart. An ffmpeg installed by hand comes first. In Docker it lands in `/data`, so it survives a new image. Remove ffmpeg deletes it again.

**Not in this change:** a slower, smaller CPU encoding for idle times; H.264/MP4 for older NVIDIA cards; a cursor or presentation mode for tutorials.

## Noise in dark areas

Dumi then saw noise all over a High tutorial video, worst in the shadows of ComfyUI's dark canvas. Measured on a page like it (a 1 px grid on dark grey, a node with a shadow), against a lossless screenshot, as the mean error in the dark area in brightness levels:

| Path | Error |
|---|---|
| High before: JPEG 90 frames, VP9 CRF 24 in the TV range (16–235) | 0.93 |
| JPEG 90 frames alone | 0.73 |
| JPEG 100 frames, VP9 CRF 24, TV range | 0.98 |
| JPEG 100 frames, VP9 CRF 24, full range | 0.31 |
| JPEG 100 frames, VP9 CRF 18, full range | 0.17 |

Two causes, about equal. JPEG at 90 scatters small blocks and streaks around every fine line; a level or two at most, but it changes every frame, so on dark grey it reads as moving noise. And JPEG keeps the full 0–255 range, while the encode squeezed it into 16–235, dropping about one dark level in seven. The tutorial's MP4 (x264 CRF 18) adds almost nothing on top.

So: High takes frames at JPEG 100 (Compact and Small at 90 or more), VP9 and AV1 videos keep the full range and say so in the stream (Chromium plays it exactly: the canvas grey of 32 comes back as 32, where the TV-range video gave 31; VP8 can't say it, so VP8 stays in the TV range), and High's CRF goes from 24 to 20 (AV1 level 26 to 22). JPEG 100 frames are about 1.8 times as big, which costs disk while an attempt records and bandwidth for the live view at High.

## The live view

Dumi also asked whether the live view could be smoother, and whether Playwright's recorder is what limits it. The live view doesn't use Playwright's video recorder: it shows the same screencast frames the videos are made from, sent over the page's WebSocket as soon as the session has them (the newest per page when the connection lags), decoded with `createImageBitmap` and drawn on the next animation frame. So what limits it:

1. **The browser's screencast rate.** Chromium sends up to about 60 frames a second (59 measured at 1080p in the sandbox); Firefox's screencast, the one Dumi's runs use, sends far fewer when the page is busy (the 12 a second stretches above). That's inside the browser. A recorder of our own would read the same screencast (Chromium's CDP `Page.startScreencast` is what Playwright calls; Firefox has nothing else to call from outside), or take screenshots, which are slower still. So building our own capture wouldn't add frames.
2. **Frames are drawn when they arrive, not when they were taken.** Network and decoding jitter of a few tens of milliseconds goes straight to the screen, so even a steady 30 frames a second can look uneven, more so over a network than on the same machine. A small playback buffer (show each frame at its capture time, 100–150 ms behind) evens that out, as video players do. The cost is that delay, which matters while someone drives the browser from the live view (Record), so it would be on for watching runs and off while recording.
3. **Firefox's flash filter** holds each frame until the next one comes (up to 120 ms on a page that stopped changing), which adds a frame of delay but no unevenness.
4. **Bandwidth.** JPEG frames at quality 90 and 1080p are 100–200 kB each; 30 a second is 3–6 MB/s. On the same machine that's nothing; to a phone or over the internet, frames pile up and the server drops all but the newest. Sending a video stream instead (H.264 or AV1, encoded on the graphics card, decoded in the browser with WebCodecs) would take a tenth of that. That's a bigger build of its own.

So the live view's smoothness can be improved with the playback buffer (small, worth doing) and, for remote viewers, a video stream (larger). Neither is in this change; they're proposed to Dumi as next steps.

**The playback buffer is built** (`packages/web/src/playout.ts`). While the live view only watches (not while someone drives the browser from it, as Record does), each frame is shown at its capture time, a steady 150 ms past the quickest delivery seen in the last 4 seconds, instead of when it arrived. The viewer and the browser have different clocks, so the buffer learns the gap from the frames: the smallest (arrival − capture time) is the clock difference plus the quickest delivery. A slower network is learned within those 4 seconds. Frames that come too late to show at their turn are skipped, one older than a frame already shown is dropped, and at most 60 wait. Turning interaction on shows the newest waiting frame at once and goes back to drawing frames as they come. The video stream for remote viewers is the next step.

## Checking it

- Unit tests: the capture writer (frames, times, repeats, the last frame's length), the encoder choice and its arguments, the queue (order, restart, cancel on delete, failures), the pending video in results.
- A real run in Chromium in the sandbox: the finished video has every frame the browser sent at its real time (frame gaps follow the capture's, not a 33 ms grid).
- On Dumi's PC: a Firefox run at High and at Compact, with and without a full ffmpeg installed, looking at frame gaps and the encoder the Videos section names. The GPU path can't be tried in the cloud (no GPU), so the first real check is there; when the test clip fails, Watchwright uses the CPU and says why.
