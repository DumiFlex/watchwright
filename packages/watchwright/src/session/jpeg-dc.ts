// The brightness of every 8×8 block of a baseline JPEG, without decoding the picture: the DC
// coefficient of each luma block is its average, so walking the entropy-coded data and keeping
// those is enough to compare two frames block by block. Used by the flash filter (flash-filter.ts).
// Progressive and arithmetic-coded JPEGs (which screencasts don't send) give null.

export interface LumaGrid {
  /** Blocks across and down. */
  cols: number;
  rows: number;
  /** Each block's average brightness, 0–255, row by row. */
  luma: Float32Array;
}

/** A colour component of the frame and its scan settings. */
interface Comp { id: number; h: number; v: number; tq: number; td: number; ta: number; pred: number }

interface Huffman {
  /** For the first 9 bits: (code length << 8) | symbol, or 0 when the code is longer. */
  fast: Uint16Array;
  maxcode: Int32Array;
  valptr: Int32Array;
  mincode: Int32Array;
  values: Uint8Array;
}

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const fast = new Uint16Array(512);
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1]!;
    valptr[len] = k;
    mincode[len] = code;
    for (let i = 0; i < n; i++, k++, code++) {
      if (len <= 9) {
        const shift = 9 - len;
        for (let j = 0; j < 1 << shift; j++) fast[(code << shift) | j] = (len << 8) | values[k]!;
      }
    }
    maxcode[len] = n ? code - 1 : -1;
    code <<= 1;
  }
  return { fast, maxcode, valptr, mincode, values };
}

/** Reads the entropy-coded bits, dropping stuffed zero bytes; past a marker it reads zeros. */
class Bits {
  private acc = 0;
  private n = 0;
  constructor(
    private readonly buf: Buffer,
    public pos: number,
  ) {}

  private fill(): void {
    while (this.n <= 24) {
      let byte: number;
      const b = this.buf[this.pos];
      if (b === undefined) {
        byte = 0;
      } else if (b === 0xff) {
        const next = this.buf[this.pos + 1];
        if (next === 0x00) {
          byte = 0xff;
          this.pos += 2;
        } else {
          byte = 0; // a marker: stay before it
        }
      } else {
        byte = b;
        this.pos++;
      }
      this.acc = ((this.acc << 8) | byte) >>> 0;
      this.n += 8;
    }
  }

  peek(k: number): number {
    if (this.n < k) this.fill();
    return (this.acc >>> (this.n - k)) & ((1 << k) - 1);
  }

  skip(k: number): void {
    this.n -= k;
    if (this.n < 32) this.acc = (this.acc & ((1 << this.n) - 1)) >>> 0;
  }

  get(k: number): number {
    if (k === 0) return 0;
    const v = this.peek(k);
    this.skip(k);
    return v;
  }

  /** After a restart interval: drop the leftover bits and step over the RSTn marker. */
  restart(): void {
    this.acc = 0;
    this.n = 0;
    while (this.pos < this.buf.length - 1 && !(this.buf[this.pos] === 0xff && this.buf[this.pos + 1]! >= 0xd0 && this.buf[this.pos + 1]! <= 0xd7)) this.pos++;
    this.pos += 2;
  }
}

/** Huffman decode, fast table for codes up to 9 bits, else the slow canonical walk. */
function decode(bits: Bits, h: Huffman): number {
  const f = h.fast[bits.peek(9)]!;
  if (f) {
    bits.skip(f >> 8);
    return f & 255;
  }
  let code = bits.get(9);
  for (let len = 10; len <= 16; len++) {
    code = (code << 1) | bits.get(1);
    if (code <= h.maxcode[len]!) return h.values[h.valptr[len]! + code - h.mincode[len]!]!;
  }
  throw new Error("Bad Huffman code.");
}

function extend(v: number, t: number): number {
  return t === 0 ? 0 : v < 1 << (t - 1) ? v - (1 << t) + 1 : v;
}

/** The luma block averages of a baseline JPEG, or null for one this doesn't read. */
export function jpegLuma(buf: Buffer): LumaGrid | null {
  try {
    return read(buf);
  } catch {
    return null;
  }
}

function read(buf: Buffer): LumaGrid | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const qt: number[] = [];
  const dc: Huffman[] = [];
  const ac: Huffman[] = [];
  let comps: Comp[] = [];
  let width = 0;
  let height = 0;
  let restartInterval = 0;
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1]!;
    pos += 2;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (marker === 0xd9) return null;
    const len = buf.readUInt16BE(pos);
    const seg = buf.subarray(pos + 2, pos + len);
    pos += len;
    if (marker === 0xdb) {
      for (let i = 0; i < seg.length; ) {
        const pq = seg[i]! >> 4;
        const tq = seg[i]! & 15;
        qt[tq] = pq ? seg.readUInt16BE(i + 1) : seg[i + 1]!; // only the DC step is needed
        i += 1 + 64 * (pq ? 2 : 1);
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      height = seg.readUInt16BE(1);
      width = seg.readUInt16BE(3);
      comps = [];
      for (let i = 0, n = seg[5]!; i < n; i++) {
        const o = 6 + i * 3;
        comps.push({ id: seg[o]!, h: seg[o + 1]! >> 4, v: seg[o + 1]! & 15, tq: seg[o + 2]!, td: 0, ta: 0, pred: 0 });
      }
    } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return null; // progressive, lossless or arithmetic
    } else if (marker === 0xc4) {
      for (let i = 0; i < seg.length; ) {
        const tc = seg[i]! >> 4;
        const th = seg[i]! & 15;
        const counts = seg.subarray(i + 1, i + 17);
        const total = counts.reduce((a, b) => a + b, 0);
        const table = buildHuffman(counts, seg.subarray(i + 17, i + 17 + total));
        (tc === 0 ? dc : ac)[th] = table;
        i += 17 + total;
      }
    } else if (marker === 0xdd) {
      restartInterval = seg.readUInt16BE(0);
    } else if (marker === 0xda) {
      return scan(buf, pos, seg, comps, width, height, qt, dc, ac, restartInterval);
    }
  }
  return null;
}

function scan(
  buf: Buffer,
  pos: number,
  seg: Buffer,
  comps: Comp[],
  width: number,
  height: number,
  qt: number[],
  dcTables: Huffman[],
  acTables: Huffman[],
  restartInterval: number,
): LumaGrid | null {
  if (!width || !height || comps.length === 0) return null;
  const ns = seg[0]!;
  const inScan: Comp[] = [];
  for (let i = 0; i < ns; i++) {
    const c = comps.find((x) => x.id === seg[1 + i * 2]);
    if (!c) return null;
    c.td = seg[2 + i * 2]! >> 4;
    c.ta = seg[2 + i * 2]! & 15;
    inScan.push(c);
  }
  const luma = comps[0]!;
  if (!inScan.includes(luma)) return null;
  const hmax = Math.max(...comps.map((c) => c.h));
  const vmax = Math.max(...comps.map((c) => c.v));
  const single = ns === 1;
  const mcuCols = single ? Math.ceil(Math.ceil((width * luma.h) / hmax) / 8) : Math.ceil(width / (8 * hmax));
  const mcuRows = single ? Math.ceil(Math.ceil((height * luma.v) / vmax) / 8) : Math.ceil(height / (8 * vmax));
  const cols = single ? mcuCols : mcuCols * luma.h;
  const rows = single ? mcuRows : mcuRows * luma.v;
  const out = new Float32Array(cols * rows);
  const step = qt[luma.tq] ?? 1;
  const bits = new Bits(buf, pos);
  for (const c of inScan) c.pred = 0;
  const block = (c: Comp): number => {
    const dcT = dcTables[c.td];
    const acT = acTables[c.ta];
    if (!dcT || !acT) throw new Error("Missing Huffman table.");
    const t = decode(bits, dcT);
    c.pred += extend(bits.get(t), t);
    for (let k = 1; k < 64; ) {
      const rs = decode(bits, acT);
      const r = rs >> 4;
      const s = rs & 15;
      if (s === 0) {
        if (r !== 15) break;
        k += 16;
      } else {
        k += r;
        bits.get(s);
        k++;
      }
    }
    return c.pred;
  };
  let mcu = 0;
  const total = mcuCols * mcuRows;
  for (let my = 0; my < mcuRows; my++) {
    for (let mx = 0; mx < mcuCols; mx++) {
      if (restartInterval && mcu > 0 && mcu % restartInterval === 0) {
        bits.restart();
        for (const c of inScan) c.pred = 0;
      }
      if (single) {
        out[my * cols + mx] = (block(luma) * step) / 8 + 128;
      } else {
        for (const c of inScan) {
          for (let v = 0; v < c.v; v++) {
            for (let h = 0; h < c.h; h++) {
              const val = block(c);
              if (c === luma) out[(my * c.v + v) * cols + mx * c.h + h] = (val * step) / 8 + 128;
            }
          }
        }
      }
      mcu++;
    }
  }
  if (mcu !== total) return null;
  return { cols, rows, luma: out };
}
