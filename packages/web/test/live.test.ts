import { afterEach, describe, expect, it, vi } from "vitest";
import type { WwEvent } from "../src/api";
import { LiveConnection } from "../src/live";

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = "";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {}
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const ev = (seq: number): WwEvent => ({ seq, time: "", type: "attempt.log", data: { message: `line ${seq}` } });

afterEach(() => vi.unstubAllGlobals());

describe("live connection", () => {
  function start(handlers: ConstructorParameters<typeof LiveConnection>[1]) {
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("window", { location: { protocol: "http:", host: "127.0.0.1:7420" } });
    const conn = new LiveConnection({ runId: "1a2b3c4d", after: 0 }, handlers);
    const socket = FakeSocket.last!;
    socket.open();
    return { conn, socket };
  }

  it("asks for the backlog in batches", () => {
    const { conn, socket } = start({});
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "subscribe", runId: "1a2b3c4d", after: 0, batch: true });
    conn.close();
  });

  it("hands a batch to onEvents in one call, or each event to onEvent", () => {
    const batches: number[][] = [];
    const a = start({ onEvents: (list) => batches.push(list.map((e) => e.seq)) });
    a.socket.receive({ type: "events", data: [ev(1), ev(2), ev(3)] });
    expect(batches).toEqual([[1, 2, 3]]);
    a.conn.close();

    const seen: number[] = [];
    const b = start({ onEvent: (e) => seen.push(e.seq) });
    b.socket.receive({ type: "events", data: [ev(1), ev(2)] });
    b.socket.receive({ type: "event", data: ev(3) });
    expect(seen).toEqual([1, 2, 3]);
    b.conn.close();
  });
});
