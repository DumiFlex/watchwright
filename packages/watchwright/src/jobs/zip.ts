import { deflateRawSync, inflateRawSync } from "node:zlib";

// A small zip writer and reader: exports (deflates text, stores files that are already compressed,
// PNG, JPEG) and traces the engine rewrites. No folder entries, no zip64 (both stay far below 4 GB).

export interface ZipEntry {
  /** Path inside the zip, with forward slashes. */
  name: string;
  data: Buffer;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date and time for the zip headers. */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const STORED = /\.(png|jpe?g|gif|webp|zip|webm|mp4)$/i;

export function zip(entries: readonly ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const store = STORED.test(e.name);
    const body = store ? e.data : deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** Limits for a zip that came from someone else: how many entries, and how many bytes once unpacked. */
export interface UnzipLimits {
  maxEntries?: number;
  maxBytes?: number;
}

/** Thrown when a zip is over its limits. */
export class ZipLimitError extends Error {}

/** Every entry of a zip (stored or deflated), in order. Throws when `buf` isn't a zip this reads. */
export function unzip(buf: Buffer, limits: UnzipLimits = {}): ZipEntry[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Not a zip file.");
  const count = buf.readUInt16LE(end + 10);
  if (limits.maxEntries !== undefined && count > limits.maxEntries) throw new ZipLimitError(`The zip has ${count} entries; at most ${limits.maxEntries} are allowed.`);
  let left = limits.maxBytes ?? Infinity;
  let at = buf.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("Broken zip directory.");
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    if (method !== 0 && method !== 8) throw new Error(`Zip method ${method} isn't supported.`);
    if (dataAt + size > buf.length) throw new Error("Broken zip entry.");
    let data: Buffer;
    try {
      data = method === 8 ? inflateRawSync(raw, Number.isFinite(left) ? { maxOutputLength: Math.max(1, left) } : {}) : Buffer.from(raw);
    } catch (err) {
      if (err instanceof RangeError) throw new ZipLimitError(`The zip unpacks to more than ${limits.maxBytes} bytes.`);
      throw err;
    }
    left -= data.length;
    if (left < 0) throw new ZipLimitError(`The zip unpacks to more than ${limits.maxBytes} bytes.`);
    out.push({ name, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
