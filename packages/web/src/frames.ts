// Stills taken from a recorded video in the page: the filmstrip on an attempt's page and the
// frames before and after a step. The video must come from this server so its pixels can be
// read. The timing helpers are kept apart from the DOM to test them.

/** `count` times spread over `0..duration` ms, each in the middle of its slice. */
export function frameTimes(duration: number, count: number): number[] {
  if (!(duration > 0) || count < 1) return [];
  const slice = duration / count;
  return Array.from({ length: count }, (_, i) => Math.round(slice * i + slice / 2));
}

/** How many frames fit a strip `width` px wide at about `frameWidth` px each, between 3 and `max`. */
export function frameCount(width: number, frameWidth = 120, max = 16): number {
  return Math.max(3, Math.min(max, Math.floor(width / frameWidth)));
}

/** Just before a step starts and a little after it ends (the page needs a moment to show the
 *  result), kept inside the video. */
export function aroundStep(step: { start: number; end: number }, duration: number, lead = 150, settle = 400): { before: number; after: number } {
  const last = Math.max(0, duration - 50);
  const before = Math.min(last, Math.max(0, step.start - lead));
  const after = Math.min(last, Math.max(before, step.end + settle));
  return { before, after };
}

/** A hidden video to take stills from; `close` lets it go. */
export interface FrameSource {
  /** The video's size in pixels. */
  width: number;
  height: number;
  /** A still at `ms` as a data URL, `width` px wide (the video's own width when left out). */
  grab(ms: number, width?: number, type?: "image/png" | "image/jpeg"): Promise<string>;
  close(): void;
}

function once(el: HTMLMediaElement, ok: string, timeout = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fail: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(ok, good);
      el.removeEventListener("error", bad);
      if (fail) reject(new Error(`The video could not be read (${ok})`));
      else resolve();
    };
    const good = () => done(false);
    const bad = () => done(true);
    const timer = setTimeout(bad, timeout);
    el.addEventListener(ok, good);
    el.addEventListener("error", bad);
  });
}

/** Opens `url` in a hidden video. Grabs run one at a time, in the order asked. */
export async function openFrames(url: string): Promise<FrameSource> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.src = url;
  await once(video, "loadeddata");
  let queue: Promise<unknown> = Promise.resolve();
  const canvas = document.createElement("canvas");
  async function take(ms: number, width: number | undefined, type: "image/png" | "image/jpeg") {
    const t = ms / 1000;
    if (Math.abs(video.currentTime - t) > 0.001) {
      const seeked = once(video, "seeked");
      video.currentTime = t;
      await seeked;
    }
    const w = Math.round(width ?? video.videoWidth);
    canvas.width = w;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * w);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, 0.82);
  }
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    grab(ms, width, type = "image/jpeg") {
      const next = queue.then(() => take(ms, width, type));
      queue = next.catch(() => undefined);
      return next;
    },
    close() {
      video.removeAttribute("src");
      video.load();
    },
  };
}
