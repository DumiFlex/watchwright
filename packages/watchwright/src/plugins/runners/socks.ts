import net from "node:net";

// A SOCKS5 listener on 127.0.0.1 for one run's browser (docs/plans/self-hosting.md, section 6.3):
// no authentication, CONNECT only. Each connection is handed to `onConnect`, which carries it
// over a runner; the browser's own name for the host (`localhost`) is kept, so the site sees the
// address the pack uses.

export interface SocksServer {
  port: number;
  close(): Promise<void>;
}

/** `onConnect` answers with true once the far end is open (or false to refuse), then owns the socket. */
export type SocksConnect = (host: string, port: number, socket: net.Socket) => Promise<boolean>;

const REPLY_OK = Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
const REPLY_FAILED = Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]);
const REPLY_NOT_SUPPORTED = Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]);

/** Reads exactly `n` bytes from a socket that is paused between reads. */
function reader(socket: net.Socket): (n: number) => Promise<Buffer> {
  let buffered = Buffer.alloc(0);
  let want: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  const settle = () => {
    if (want && buffered.length >= want.n) {
      const out = buffered.subarray(0, want.n);
      buffered = buffered.subarray(want.n);
      const w = want;
      want = null;
      w.resolve(out);
    }
  };
  const onData = (d: Buffer) => {
    buffered = Buffer.concat([buffered, d]);
    settle();
  };
  socket.on("data", onData);
  socket.once("close", () => want?.reject(new Error("closed")));
  const read = (n: number) =>
    new Promise<Buffer>((resolve, reject) => {
      want = { n, resolve, reject };
      settle();
    });
  read.done = () => {
    socket.off("data", onData);
    return buffered;
  };
  return read as ((n: number) => Promise<Buffer>) & { done(): Buffer };
}

async function handshake(socket: net.Socket): Promise<{ host: string; port: number; rest: Buffer } | null> {
  const read = reader(socket) as ((n: number) => Promise<Buffer>) & { done(): Buffer };
  const [ver, nMethods] = await read(2);
  if (ver !== 5) return null;
  const methods = await read(nMethods!);
  if (!methods.includes(0)) {
    socket.end(Buffer.from([5, 0xff]));
    return null;
  }
  socket.write(Buffer.from([5, 0]));
  const [, cmd, , atyp] = await read(4);
  let host: string;
  if (atyp === 1) host = [...(await read(4))].join(".");
  else if (atyp === 3) host = (await read((await read(1))[0]!)).toString("utf8");
  else if (atyp === 4) {
    const b = await read(16);
    host = Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
  } else return null;
  const port = (await read(2)).readUInt16BE(0);
  if (cmd !== 1) {
    socket.end(REPLY_NOT_SUPPORTED);
    return null;
  }
  return { host, port, rest: read.done() };
}

export async function startSocks(onConnect: SocksConnect): Promise<SocksServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.setNoDelay(true);
    void (async () => {
      const req = await handshake(socket).catch(() => null);
      if (!req) return void socket.destroy();
      socket.pause();
      if (req.rest.length) socket.unshift(req.rest);
      const ok = await onConnect(req.host, req.port, socket).catch(() => false);
      if (socket.destroyed) return;
      if (!ok) return void socket.end(REPLY_FAILED);
      socket.write(REPLY_OK);
      socket.resume();
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
