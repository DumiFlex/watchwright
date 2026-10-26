import { describe, expect, it } from "vitest";
import { decodeFrame, getJson, liveUrl, parseRoute, sendJson } from "../src/api";

const reply = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("api", () => {
  it("builds the live URL from the page origin", () => {
    expect(liveUrl({ protocol: "http:", host: "127.0.0.1:7420" })).toBe("ws://127.0.0.1:7420/api/v1/live");
    expect(liveUrl({ protocol: "https:", host: "example.test" })).toBe("wss://example.test/api/v1/live");
  });

  it("unwraps the data envelope", async () => {
    expect(await getJson("/x", reply(200, { data: { a: 1 } }))).toEqual({ ok: true, data: { a: 1 } });
  });

  it("passes the error envelope through", async () => {
    const res = await getJson("/x", reply(403, { error: { code: "bad_host", message: "no" } }));
    expect(res).toEqual({ ok: false, error: { code: "bad_host", message: "no" } });
  });

  it("names the status when the body isn't an envelope", async () => {
    const res = await getJson("/x", (async () => new Response("oops", { status: 502 })) as typeof fetch);
    expect(res).toEqual({ ok: false, error: { code: "http_502", message: "The server answered 502." } });
  });

  it("reports an unreachable server", async () => {
    const res = await getJson("/x", (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("unreachable");
  });

  it("sends JSON with the web client header", async () => {
    let seen: RequestInit | undefined;
    const fetcher = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ data: { ok: 1 } }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendJson("/api/v1/runs", { packId: "abcd1234" }, "POST", fetcher)).toEqual({ ok: true, data: { ok: 1 } });
    expect(seen?.body).toBe('{"packId":"abcd1234"}');
    expect((seen?.headers as Record<string, string>)["x-watchwright-client"]).toBe("web");
  });

  it("decodes a binary frame message", () => {
    const header = new TextEncoder().encode(JSON.stringify({ runId: "r", pageId: "p1", timestamp: 5, width: 10, height: 20 }));
    const buf = new Uint8Array(4 + header.length + 3);
    new DataView(buf.buffer).setUint32(0, header.length, false);
    buf.set(header, 4);
    buf.set([0xff, 0xd8, 0xff], 4 + header.length);
    const { header: h, jpeg } = decodeFrame(buf.buffer);
    expect(h).toEqual({ runId: "r", pageId: "p1", timestamp: 5, width: 10, height: 20 });
    expect([...jpeg]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("parses hash routes", () => {
    expect(parseRoute("#/runs/0a1b2c3d")).toEqual({ name: "run", id: "0a1b2c3d" });
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/runs/nope")).toEqual({ name: "home" });
  });
});
