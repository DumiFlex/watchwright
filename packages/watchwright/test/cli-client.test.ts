import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client, NoServer } from "../src/cli/client.js";

// The CLI's client gives up on a server that takes the request and never answers.

let server: Server | null = null;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server?.close(r));
  server = null;
});

async function hanging(): Promise<string> {
  server = createServer(() => undefined); // takes every request, answers none
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

describe("CLI client", () => {
  it("gives up on a server that doesn't answer, with a message", async () => {
    const client = new Client(await hanging(), "test", 0.3);
    const started = Date.now();
    const err = await client.request("GET", "/runs").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoServer);
    expect((err as Error).message).toMatch(/didn.t answer within/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("gives a wait its own timeout on top", async () => {
    const client = new Client(await hanging(), "test", 0.2);
    const started = Date.now();
    await client.request("GET", "/runs/0a1b2c3d/wait", { timeout: 0.5 }).catch(() => undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(650);
  });
});
