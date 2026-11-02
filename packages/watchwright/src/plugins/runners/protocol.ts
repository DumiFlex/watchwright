// The runner's wire format (docs/plans/self-hosting.md, section 6.3): JSON text messages for
// control, binary frames for the connections it carries. A binary frame is one byte of type, four
// bytes of stream id (big-endian) and the payload. The `watchwright runner` command and the
// server's runners plugin both use this file.

export const OPEN = 1; // server → runner: payload = port (u16) + host (UTF-8)
export const OPENED = 2; // runner → server
export const REFUSED = 3; // runner → server: payload = reason (UTF-8)
export const DATA = 4; // both ways: payload = bytes
export const END = 5; // both ways: the stream is done
export const CREDIT = 6; // both ways: payload = bytes taken (u32), so the sender may send that much more

/** How much one stream may have in flight before its sender waits for credit. */
export const WINDOW = 256 * 1024;

export interface Frame {
  type: number;
  stream: number;
  payload: Buffer;
}

export function encode(type: number, stream: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(5);
  head[0] = type;
  head.writeUInt32BE(stream >>> 0, 1);
  return Buffer.concat([head, payload]);
}

export function decode(buf: Buffer): Frame | null {
  if (buf.length < 5) return null;
  return { type: buf[0]!, stream: buf.readUInt32BE(1), payload: buf.subarray(5) };
}

export function openPayload(host: string, port: number): Buffer {
  const p = Buffer.alloc(2);
  p.writeUInt16BE(port);
  return Buffer.concat([p, Buffer.from(host, "utf8")]);
}

export function readOpen(payload: Buffer): { host: string; port: number } | null {
  if (payload.length < 3) return null;
  return { port: payload.readUInt16BE(0), host: payload.subarray(2).toString("utf8") };
}

/**
 * Control messages (JSON text). The runner opens with `auth` (its token, version, allow list and
 * system); the server answers `hello` (the runner's name and the server's version) or `refused`
 * and closes.
 */
export type Control =
  | { type: "auth"; token: string; version: string; allow: string[]; platform: string }
  | { type: "hello"; name: string; version: string }
  | { type: "refused"; message: string }
  | { type: "ping" }
  | { type: "pong" };
