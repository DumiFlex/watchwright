// The live view as a video stream (see the live plugin's stream.ts on the server): each page's VP9
// or VP8 chunks are decoded with WebCodecs into pictures, which the live view shows like JPEG frames.
import type { FrameHeader } from "./api";

/** How a person's live views come (the `live.video` setting). */
export type LiveVideoMode = "auto" | "video" | "frames";

/** The server's codec names and what WebCodecs calls them (VP9 profile 0, level 4.1, 8 bits). */
const CODECS: Record<string, string> = { vp9: "vp09.00.41.08", vp8: "vp8" };

let support: Promise<string[]> | null = null;
/** The stream codecs this browser can decode with WebCodecs (none without it). */
export function decodableCodecs(): Promise<string[]> {
  support ??= (async () => {
    if (typeof VideoDecoder === "undefined") return [];
    const ok: string[] = [];
    for (const [name, codec] of Object.entries(CODECS)) {
      try {
        if ((await VideoDecoder.isConfigSupported({ codec })).supported === true) ok.push(name);
      } catch {
        // Not this one.
      }
    }
    return ok;
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
  codec: string;
  /** Chunks wait for a key frame after the decoder (re)starts or fails. */
  needKey: boolean;
  /** The header of each chunk being decoded, by its timestamp in microseconds. */
  headers: Map<number, FrameHeader>;
}

export class VideoPictures {
  private readonly pages = new Map<string, PageDecoder>();

  constructor(private readonly onPicture: (header: FrameHeader, picture: ImageBitmap) => void) {}

  push(header: FrameHeader & { key?: boolean }, data: Uint8Array): void {
    const codec = CODECS[header.video ?? ""];
    if (!codec) return;
    let page = this.pages.get(header.pageId);
    if (page && page.codec !== codec) this.reset(header.pageId);
    page = this.pages.get(header.pageId);
    if (!page || page.decoder.state === "closed") {
      page = this.open(header.pageId, codec);
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

  private open(pageId: string, codec: string): PageDecoder {
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
          (bitmap) => {
            frame.close();
            this.onPicture(header, bitmap);
          },
          () => frame.close(),
        );
      },
      error: () => this.reset(pageId),
    });
    decoder.configure({ codec, optimizeForLatency: true });
    return { decoder, codec, needKey: true, headers };
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
