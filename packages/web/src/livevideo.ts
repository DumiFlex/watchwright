// The live view as a video stream (see the live plugin's stream.ts on the server): each page's VP8
// chunks are decoded with WebCodecs into pictures, which the live view shows like JPEG frames.
import type { FrameHeader } from "./api";

/** How a person's live views come (the `live.video` setting). */
export type LiveVideoMode = "auto" | "video" | "frames";

let support: Promise<boolean> | null = null;
/** Whether this browser can decode the stream (WebCodecs with VP8). */
export function canDecodeVideo(): Promise<boolean> {
  support ??= (async () => {
    if (typeof VideoDecoder === "undefined") return false;
    try {
      return (await VideoDecoder.isConfigSupported({ codec: "vp8" })).supported === true;
    } catch {
      return false;
    }
  })();
  return support;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Whether to ask for a video stream: `auto` does when the page isn't opened on the server's own machine. */
export function wantsVideo(mode: unknown, hostname: string): boolean {
  if (mode === "video") return true;
  if (mode === "frames") return false;
  return !LOOPBACK.has(hostname) && !hostname.endsWith(".localhost");
}

interface PageDecoder {
  decoder: VideoDecoder;
  /** Chunks wait for a key frame after the decoder (re)starts or fails. */
  needKey: boolean;
  /** The header of each chunk being decoded, by its timestamp in microseconds. */
  headers: Map<number, FrameHeader>;
}

export class VideoPictures {
  private readonly pages = new Map<string, PageDecoder>();

  constructor(private readonly onPicture: (header: FrameHeader, picture: ImageBitmap) => void) {}

  push(header: FrameHeader & { key?: boolean }, data: Uint8Array): void {
    let page = this.pages.get(header.pageId);
    if (!page || page.decoder.state === "closed") {
      page = this.open(header.pageId);
      this.pages.set(header.pageId, page);
    }
    if (page.needKey) {
      if (!header.key) return;
      page.needKey = false;
    }
    const us = header.timestamp * 1000;
    page.headers.set(us, header);
    try {
      page.decoder.decode(new EncodedVideoChunk({ type: header.key ? "key" : "delta", timestamp: us, data }));
    } catch {
      this.reset(header.pageId);
    }
  }

  private open(pageId: string): PageDecoder {
    const headers = new Map<number, FrameHeader>();
    const decoder = new VideoDecoder({
      output: (frame) => {
        const header = headers.get(frame.timestamp);
        headers.delete(frame.timestamp);
        if (!header) {
          frame.close();
          return;
        }
        createImageBitmap(frame).then(
          (bitmap) => this.onPicture(header, bitmap),
          () => undefined,
        );
        frame.close();
      },
      error: () => this.reset(pageId),
    });
    decoder.configure({ codec: "vp8", optimizeForLatency: true });
    return { decoder, needKey: true, headers };
  }

  /** A page's decoder failed: it starts again at the next key frame. */
  private reset(pageId: string): void {
    const page = this.pages.get(pageId);
    if (!page) return;
    if (page.decoder.state !== "closed") page.decoder.close();
    this.pages.delete(pageId);
  }

  /** Every decoder starts again at its next key frame (a new subscription). */
  clear(): void {
    for (const id of [...this.pages.keys()]) this.reset(id);
  }
}
