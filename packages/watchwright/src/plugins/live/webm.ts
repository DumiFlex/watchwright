// Reads the blocks out of a live WebM stream as ffmpeg writes it (a Segment and Clusters of
// unknown or known size), chunk by chunk: each video block with its time in milliseconds. Only
// what the live video stream needs: one track, Cluster timecodes, SimpleBlocks and Blocks.

export interface WebmBlock {
  /** Cluster time + the block's own offset, in milliseconds (the muxer's default time scale). */
  ms: number;
  data: Buffer;
}

const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const BLOCK_GROUP = 0xa0;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;
/** Master elements whose children are read (the rest are skipped whole). */
const DESCEND = new Set([SEGMENT, CLUSTER, BLOCK_GROUP]);

/** An EBML variable-length number at `at`: its value (with the length marker kept for ids), its length, and whether it says "unknown". */
function vint(buf: Buffer, at: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
  if (at >= buf.length) return null;
  const first = buf[at]!;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error("Bad EBML number in the video stream.");
  if (at + length > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = buf[at + i]!;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

export class WebmReader {
  private buf: Buffer = Buffer.alloc(0);
  private clusterMs = 0;

  constructor(private readonly onBlock: (block: WebmBlock) => void) {}

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let at = 0;
    for (;;) {
      const id = vint(this.buf, at, true);
      if (!id) break;
      const size = vint(this.buf, at + id.length, false);
      if (!size) break;
      const body = at + id.length + size.length;
      if (DESCEND.has(id.value)) {
        at = body; // read its children in place, whatever its size says
        continue;
      }
      if (size.unknown) throw new Error("A video stream element of unknown size.");
      if (body + size.value > this.buf.length) break;
      const data = this.buf.subarray(body, body + size.value);
      if (id.value === TIMECODE) this.clusterMs = data.length ? data.readUIntBE(0, Math.min(6, data.length)) : 0;
      else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) this.block(data);
      at = body + size.value;
    }
    this.buf = at >= this.buf.length ? Buffer.alloc(0) : Buffer.from(this.buf.subarray(at));
  }

  private block(data: Buffer): void {
    const track = vint(data, 0, false);
    if (!track || data.length < track.length + 3) return;
    const offset = data.readInt16BE(track.length);
    this.onBlock({ ms: this.clusterMs + offset, data: Buffer.from(data.subarray(track.length + 3)) });
  }
}

/** A VP8 frame is a key frame when the first bit of its first byte is 0. */
export const isVp8Key = (data: Buffer): boolean => data.length > 0 && (data[0]! & 1) === 0;
