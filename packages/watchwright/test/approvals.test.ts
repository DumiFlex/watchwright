import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ActionError, defineAction } from "../src/actions/registry.js";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { definePlugin, migrationsOf } from "../src/core/plugin.js";
import { APPROVALS, type Approval } from "../src/plugins/approvals/plugin.js";
import { Client } from "../src/cli/client.js";
import { actionCommand, EXIT, guarded, type Io } from "../src/cli/commands.js";
import { buildServer } from "../src/server/app.js";
import { freePort } from "./helpers/harness.js";
import { openStore, type Store } from "../src/store/db.js";

// A destructive action called by anything but the web page waits for the person's approval.

const HOST = "127.0.0.1:7420";
const ORIGIN = "http://127.0.0.1:7420";
const open: { app: FastifyInstance; store: Store }[] = [];
afterEach(async () => {
  for (const { app, store } of open.splice(0)) {
    await app.close();
    store.close();
  }
});

async function make(holdMs = 2000, port = 7420) {
  const dropped: string[] = [];
  const demo = definePlugin({
    name: "demo",
    actions: () => [
      defineAction<{ id: string }>({
        name: "demo.drop",
        title: "Drop a thing",
        method: "DELETE",
        path: "/things/:id",
        destructive: true,
        explain: ({ id }) => `Drop the thing ${id}`,
        input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        handler: ({ id }, { client }) => {
          if (id === "bad") throw new ActionError("nope", "That one can't go.", 409);
          dropped.push(`${id} as ${client}`);
          return { dropped: id };
        },
      }),
    ],
  });
  const plugins = [...BUILTIN_PLUGINS, demo];
  const store = openStore(":memory:", migrationsOf(plugins));
  const app = await buildServer({ store, port, plugins });
  open.push({ app, store });
  app.watchwright.services.get(APPROVALS).holdMs = holdMs;
  const req = (method: "GET" | "POST" | "DELETE", url: string, opts: { page?: boolean; client?: string; body?: object; confirmed?: boolean } = {}) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        host: port === 7420 ? HOST : `127.0.0.1:${port}`,
        ...(opts.page ? { origin: port === 7420 ? ORIGIN : `http://127.0.0.1:${port}` } : {}),
        ...(opts.client ? { "x-watchwright-client": opts.client } : {}),
        ...(opts.confirmed ? { "x-watchwright-confirmed": "terminal" } : {}),
      },
      ...(opts.body ? { payload: opts.body } : {}),
    });
  const waiting = async () => {
    for (let i = 0; i < 100; i++) {
      const list = (await req("GET", "/approvals?status=waiting")).json() as { data: Approval[] };
      if (list.data.length) return list.data;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("no approval came");
  };
  return { app, req, dropped, waiting };
}

describe("approvals", () => {
  it("runs at once from the web page or after a yes at a terminal", async () => {
    const { req, dropped } = await make();
    expect((await req("DELETE", "/things/a", { page: true, client: "web" })).json()).toEqual({ data: { dropped: "a" } });
    expect((await req("DELETE", "/things/b", { confirmed: true, client: "cli" })).statusCode).toBe(200);
    expect(dropped).toEqual(["a as web", "b as cli"]);
  });

  it("holds an agent's call until the person approves, then runs it as the agent asked", async () => {
    const { req, dropped, waiting } = await make();
    const call = req("DELETE", "/things/x", { client: "Claude Code" });
    const [a] = await waiting();
    expect(a).toMatchObject({ action: "demo.drop", client: "Claude Code", summary: "Drop the thing x", status: "waiting", input: { id: "x" } });
    expect(dropped).toEqual([]);
    // Only the web page answers.
    expect((await req("POST", `/approvals/${a!.id}/answer`, { body: { approve: true }, client: "Claude Code" })).statusCode).toBe(403);
    const answered = (await req("POST", `/approvals/${a!.id}/answer`, { page: true, client: "web", body: { approve: true } })).json() as { data: Approval };
    expect(answered.data).toMatchObject({ status: "approved", answeredBy: "web", result: { dropped: "x" } });
    const res = await call;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { dropped: "x" } });
    expect(dropped).toEqual(["x as Claude Code"]);
    // A second answer is refused.
    expect((await req("POST", `/approvals/${a!.id}/answer`, { page: true, body: { approve: true } })).statusCode).toBe(409);
  });

  it("answers a refused call with an error, and runs nothing", async () => {
    const { req, dropped, waiting } = await make();
    const call = req("DELETE", "/things/y", { client: "Codex" });
    const [a] = await waiting();
    await req("POST", `/approvals/${a!.id}/answer`, { page: true, body: { approve: false } });
    const res = await call;
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "refused" } });
    expect(dropped).toEqual([]);
  });

  it("hands over an approval to wait on when the person takes longer than the hold", async () => {
    const { req, dropped } = await make(30);
    const res = await req("DELETE", "/things/z", { client: "Claude Code" });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { data: { approval: Approval; message: string } };
    expect(body.data.approval.status).toBe("waiting");
    expect(body.data.message).toContain("Drop the thing z");
    const id = body.data.approval.id;
    const quiet = (await req("GET", `/approvals/${id}/wait?timeout=0.05`)).json() as { data: Approval };
    expect(quiet.data.status).toBe("waiting");
    // Asking again while it waits gets the same approval, not a second one.
    const again = (await req("DELETE", "/things/z", { client: "Claude Code" })).json() as { data: { approval: Approval } };
    expect(again.data.approval.id).toBe(id);
    expect(((await req("GET", "/approvals?status=waiting")).json() as { data: Approval[] }).data).toHaveLength(1);
    const wait = req("GET", `/approvals/${id}/wait?timeout=10`);
    await req("POST", `/approvals/${id}/answer`, { page: true, body: { approve: true } });
    expect(((await wait).json() as { data: Approval }).data).toMatchObject({ status: "approved", result: { dropped: "z" } });
    expect(dropped).toEqual(["z as Claude Code"]);
  });

  it("files a failure when the approved action fails", async () => {
    const { req, waiting } = await make();
    const call = req("DELETE", "/things/bad", { client: "Claude Code" });
    const [a] = await waiting();
    const answered = (await req("POST", `/approvals/${a!.id}/answer`, { page: true, body: { approve: true } })).json() as { data: Approval };
    expect(answered.data).toMatchObject({ status: "failed", error: { code: "nope" } });
    expect((await call).json()).toMatchObject({ error: { code: "nope" } });
  });

  it("expires approvals nobody answers, and logs every step as events", async () => {
    const { app, req } = await make(10);
    const approvals = app.watchwright.services.get(APPROVALS);
    const res = (await req("DELETE", "/things/old", { client: "cli" })).json() as { data: { approval: Approval } };
    const id = res.data.approval.id;
    app.watchwright.store.db.prepare("UPDATE approvals SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), id);
    expect(approvals.get(id)!.status).toBe("expired");
    const types = app.watchwright.events.after(0).map((e) => `${e.type}:${String(e.data.status ?? e.data.client)}`);
    expect(types).toEqual(expect.arrayContaining(["approval.requested:cli", "approval.answered:expired"]));
  });

  it("marks the built-in actions that delete things", async () => {
    const { req } = await make();
    const actions = ((await req("GET", "/actions")).json() as { data: { name: string; destructive?: boolean }[] }).data;
    expect(actions.filter((a) => a.destructive).map((a) => a.name).sort()).toEqual(["alerts.channel-create", "alerts.channel-delete", "alerts.channel-update", "alerts.rule-create", "alerts.rule-delete", "alerts.rule-update", "core.stop", "demo.drop", "packs.file-delete", "packs.remove", "record.save-sign-in", "runs.delete", "runs.presets.delete", "schedules.create", "schedules.delete", "schedules.resume", "schedules.set-startup", "schedules.update", "secrets.delete", "secrets.set", "signins.delete"]);
  });

  it("makes the CLI wait for the approval when no person is at a terminal", async () => {
    const port = await freePort();
    const { app, req, waiting, dropped } = await make(30, port);
    await app.listen({ port, host: "127.0.0.1" });
    const client = new Client(`http://127.0.0.1:${port}/`, "Claude Code");
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), interactive: false, confirm: async () => true };
    const run = actionCommand(client, io, ["demo", "drop", "q"], "watchwright");
    const [a] = await waiting();
    await new Promise((r) => setTimeout(r, 80));
    await req("POST", `/approvals/${a!.id}/answer`, { page: true, body: { approve: true } });
    expect(await run).toBe(EXIT.ok);
    expect(err[0]).toContain("Waiting for the person to approve");
    expect(JSON.parse(out[0]!)).toEqual({ dropped: "q" });
    expect(dropped).toEqual(["q as Claude Code"]);

    const refused = guarded(io, false, () => actionCommand(client, io, ["demo", "drop", "r"], "watchwright"));
    const [b] = await waiting();
    await req("POST", `/approvals/${b!.id}/answer`, { page: true, body: { approve: false } });
    expect(await refused).toBe(EXIT.failed);
    expect(err.at(-1)).toMatch(/refused/);
  });
});
