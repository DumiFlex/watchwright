import { describe, expect, it } from "vitest";
import { getJson, liveUrl } from "../src/api";

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
});
