import type net from "node:net";
import type { WebSocket } from "ws";
import type { EventLog } from "../../events/log.js";
import { allows } from "./allow.js";
import { Mux } from "./mux.js";
import { DATA, decode, encode, END, OPEN, OPENED, openPayload, REFUSED, type Control } from "./protocol.js";
import { startSocks, type SocksServer } from "./socks.js";
import type { RunnerInfo } from "./store.js";

// The runners connected now, and a SOCKS listener per run that carries the run's browser through
// one of them (docs/plans/self-hosting.md, section 6.3).

/** How long a runner has to answer an open before the browser gets a failed connection. */
const OPEN_TIMEOUT_MS = 15_000;
/** A runner that sends nothing (it pings every 30 s) for this long is gone. */
const SILENT_MS = 90_000;

interface Conn {
  runner: RunnerInfo;
  allow: string[];
  version: string;
  platform: string;
  connectedAt: string;
  ws: WebSocket;
  mux: Mux;
  nextId: number;
  opening: Map<number, { socket: net.Socket; done: (result: true | string) => void }>;
  lastHeard: number;
}

export interface RunnerStatus {
  online: boolean;
  connectedAt: string | null;
  /** Connections open through it now. */
  streams: number;
}

export interface RunnerProxy {
  /** For Playwright's `proxy.server`. */
  server: string;
  close(): Promise<void>;
}

export class RunnerHub {
  private readonly conns = new Map<string, Conn>();
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly events: EventLog) {
    this.timer = setInterval(() => {
      for (const c of this.conns.values()) if (Date.now() - c.lastHeard > SILENT_MS) c.ws.terminate();
    }, 15_000);
    this.timer.unref();
  }

  status(id: string): RunnerStatus {
    const c = this.conns.get(id);
    return { online: !!c, connectedAt: c?.connectedAt ?? null, streams: c ? c.mux.size + c.opening.size : 0 };
  }

  /** A runner that passed `auth` on `ws`: from now on its connections go over it. A second connection of the same runner replaces the first. */
  attach(ws: WebSocket, runner: RunnerInfo, hello: { allow: string[]; version: string; platform: string }): void {
    this.conns.get(runner.id)?.ws.close(4000, "The runner connected again from somewhere else.");
    const c: Conn = {
      runner,
      allow: hello.allow,
      version: hello.version,
      platform: hello.platform,
      connectedAt: new Date().toISOString(),
      ws,
      mux: new Mux((frame) => ws.send(frame)),
      nextId: 1,
      opening: new Map(),
      lastHeard: Date.now(),
    };
    this.conns.set(runner.id, c);
    this.events.append("runner.connected", { id: runner.id, name: runner.name, version: hello.version });
    ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      c.lastHeard = Date.now();
      const buf = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (!isBinary) {
        try {
          const msg = JSON.parse(buf.toString("utf8")) as Control;
          if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" } satisfies Control));
        } catch {
          // Not JSON: ignored.
        }
        return;
      }
      const f = decode(buf);
      if (!f) return;
      const waiting = c.opening.get(f.stream);
      if (waiting && (f.type === OPENED || f.type === REFUSED)) {
        c.opening.delete(f.stream);
        if (f.type === OPENED && !waiting.socket.destroyed) {
          c.mux.attach(f.stream, waiting.socket);
          waiting.done(true);
        } else {
          if (f.type === OPENED) ws.send(encode(END, f.stream));
          waiting.done(f.type === REFUSED ? f.payload.toString("utf8") || "The runner couldn't open it." : "The browser gave up on it.");
        }
        return;
      }
      // A stream that is gone here (it timed out, or the browser closed it): tell the runner to close its end.
      if (!c.mux.handle(f) && (f.type === OPENED || f.type === DATA)) ws.send(encode(END, f.stream));
    });
    ws.on("close", () => {
      c.mux.closeAll();
      for (const w of c.opening.values()) w.done("The runner went offline.");
      c.opening.clear();
      if (this.conns.get(runner.id) === c) {
        this.conns.delete(runner.id);
        if (!this.closed) this.events.append("runner.disconnected", { id: runner.id, name: runner.name });
      }
    });
  }

  /** Closes a runner's connection (it was removed). */
  drop(id: string): void {
    this.conns.get(id)?.ws.close(4001, "This runner was removed on the server.");
  }

  /** Opens host:port on the runner's machine for `socket`; true once open, else why not. */
  open(id: string, host: string, port: number, socket: net.Socket): Promise<true | string> {
    const c = this.conns.get(id);
    if (!c) return Promise.resolve("The runner is offline.");
    if (!allows(c.allow, host, port)) return Promise.resolve(`The runner doesn't allow ${host}:${port}. Its allow list is ${c.allow.join(", ")}; change it on that machine with watchwright runner --allow.`);
    const stream = c.nextId++;
    if (c.nextId > 0xffffffff) c.nextId = 1;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        c.opening.delete(stream);
        resolve(`The runner didn't open ${host}:${port} within ${OPEN_TIMEOUT_MS / 1000} s.`);
      }, OPEN_TIMEOUT_MS);
      c.opening.set(stream, {
        socket,
        done: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      });
      c.ws.send(encode(OPEN, stream, openPayload(host, port)));
    });
  }

  /** A SOCKS listener on 127.0.0.1 for one run: its browser's connections go through the runner. `onRefused` hears about each one the runner didn't open. */
  async proxy(id: string, onRefused: (message: string) => void): Promise<RunnerProxy> {
    const socks: SocksServer = await startSocks(async (host, port, socket) => {
      const r = await this.open(id, host, port, socket);
      if (r !== true) onRefused(`${host}:${port}: ${r}`);
      return r === true;
    });
    return { server: `socks5://127.0.0.1:${socks.port}`, close: () => socks.close() };
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    for (const c of this.conns.values()) c.ws.terminate();
  }
}
