# Smaller run videos

Dumi asked on 2 November 2026 for optional quality and compression settings for run videos, so they take less room. This note looks at how videos are written now, measures the options on real bench videos, and picks a design.

## How videos are written now

- **Attempt videos** (`video: always | problems | never`). Chromium and WebKit: Playwright's screencast writes the `.webm` itself with its own ffmpeg. Playwright 1.64 encodes VP9 at a bit rate that grows with the pixel rate: 1 Mbit/s for 800×450 at 25 frames a second, so about 2.5 Mbit/s at 1280×720. Firefox: Watchwright drops the screencast's flashing frames and writes the video itself from the kept frames (`RunVideo`), with the same ffmpeg, at 25 frames a second and 1 Mbit/s.
- **The run video** (`runVideo`): Watchwright writes it from the live frames, 10 frames a second, 600 kbit/s.
- **Storage** (Admin > Storage): drive space, the largest runs, warn and stop-recording limits, keep rules that delete old runs. `video: problems` already drops the videos of attempts that passed.
- **ffmpeg** is always Playwright's own build (`ffmpeg-<rev>` in the Playwright browsers folder), on Windows, macOS, Linux and in the Docker image (Playwright's base image ships it). Its build options, read from the binaries:
  - revision 1013 (Playwright 1.64, current): `libvpx_vp9` encoder and decoder, `mjpeg` decoder, `matroska` demuxer, `webm` muxer, `crop`, `pad` and **`scale`** filters.
  - revision 1011 (older): the same with VP8 instead of VP9.

  So Playwright's ffmpeg can both encode at another quality and size, and decode a finished `.webm` to encode it again. Nothing else needs to be installed.

## Measurements

Six attempt videos from a real bench run on Dumi's PC (Firefox, 1600×960, 15 s to 6 min, written by `RunVideo` at 1 Mbit/s). That run's 262 videos take 2.9 GB. Each was encoded again with VP9 at the realtime speed recording uses (`-deadline realtime -cpu-used 8`, one thread).

The bit rate is what keeps files big. The current settings (`-crf 10 -b:v 1M`) spend close to the full 1 Mbit/s even on a still page. Constant quality (`-b:v 0 -crf N`) spends bits only when the page changes, which suits a browser: mostly still, with bursts of typing and scrolling.

| Encoding | 6-min video | 49-s video | 39-s video | Share of now | Picture |
|---|---|---|---|---|---|
| now: 1 Mbit/s, 25 fps | 49.4 MB | 8.3 MB | 6.4 MB | 100% | |
| 500 kbit/s | 39.6 MB | | 4.2 MB | 66–80% | same |
| constant quality, CRF 30 | | 2.2 MB | 1.7 MB | 27% | same |
| **constant quality, CRF 40** | 9.7 MB | 1.4 MB | 1.1 MB | **17–20%** | small text still sharp (SSIM 0.99) |
| CRF 50 | | 1.0 MB | 0.76 MB | 12% | text readable, soft edges |
| 3/4 size, 10 fps, 350 kbit/s | 24.7 MB | | 2.7 MB | 43–50% | |
| **3/4 size, 10 fps, CRF 42** | 2.7 MB | | 0.38 MB | **5–6%** | readable, motion choppier |

Recording from the frames directly (JPEG frames in, the way `RunVideo` records) gives the same picture: the 49-s video is 6.6 MB at the current settings, 1.5 MB at CRF 40 (−78%) and 0.43 MB at 3/4 size, 10 fps, CRF 42 (−93%). VP8 (ffmpeg 1011) at CRF 40 is 1.4 MB against 4.7 MB now.

Encoding again after the fact costs CPU: a 6-minute video took 57 s on one core at CRF 40 (35 s at 3/4 size and 10 fps). Recording at that quality costs nothing extra, since the frames are encoded as they arrive either way.

## Options

1. **Lower the bit rate.** Little gain (−20 to −35%), because the encoder doesn't reach a low target on busy pages.
2. **Constant quality.** −80% with no visible loss. The biggest win for the least.
3. **Smaller size and frame rate.** On top of 2: −94%. Good for long benches where the video is a record to skim.
4. **Encode again after each attempt.** Same sizes as 2 and 3, but each attempt then costs CPU twice, while tests run. Only worth it for videos that already exist.
5. **Keep only failed attempts' videos.** Already there (`video: problems`).

## Design

- A server-wide setting, **Video quality** (`runs.videoQuality`), in Admin > Storage, under a new **Videos** heading:
  - **Full** (default, what runs record now),
  - **Compact**: same size and smoothness, constant quality (CRF 40), about 80% smaller,
  - **Small**: 3/4 size, 10 frames a second, CRF 42, about 94% smaller.

  It applies to attempt videos and the run video of runs that start after the change. With Compact or Small, Watchwright writes every attempt video itself from the screencast frames (as it already does for Firefox), for every browser; the live view keeps its full frames. When Playwright's ffmpeg is missing, runs go on without video as they do now.
- **Compress kept videos**, a button under the setting: encodes again, at the chosen quality, the videos runs already kept, one at a time on one core, oldest run first. It never touches a run that is going, and stops by itself when a run starts, so a bench run never shares the CPU with it. A file is replaced only when the new one is smaller. Each video written by Watchwright carries its quality in its title (`watchwright-video:compact`), so a video already at that quality (or smaller) is skipped. The section shows how many videos and how much room they take, how many the button would compress, and its progress with a Stop button. It's an admin action and `destructive` (the old files are gone), so an agent's call waits for approval on the page.
- The quality is a server setting, not a run option: room on the drive is the server's concern. A per-pack or per-run override can come later if a pack needs full-quality videos.

## Expected effect

At Compact, the bench run above would take about 0.6 GB instead of 2.9 GB, and Compress kept videos would bring the existing runs down by the same share.
