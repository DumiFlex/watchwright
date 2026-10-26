import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ActionError, checkActions, defineAction } from "../src/actions/registry.js";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { definePlugin, migrationsOf } from "../src/core/plugin.js";
import { buildServer } from "../src/server/app.js";
import { openStore } from "../src/store/db.js";

const HOST = "127.0.0.1:7420";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

const echo = definePlugin({
  name: "echo",
  actions: () => [
    defineAction<{ id: string; n?: number; flag?: boolean }>({
      name: "echo.get",
      title: "Echo",
      method: "GET",
      path: "/echo/:id",
      input: { type: "object", properties: { id: { type: "string", pattern: "^[a-z]+$" }, n: { type: "integer", minimum: 1 }, flag: { type: "boolean" } }, required: ["id"] },
      handler: (input, call) => ({ ...input, client: call.client }),
    }),
    defineAction<{ text: string }>({
      name: "echo.post",
      title: "Post",
      method: "POST",
      path: "/echo",
      status: 201,
      input: { type: "object", properties: { text: { type: "string", minLength: 1 } }, required: ["text"] },
      handler: ({ text }) => {
        if (text === "teapot") throw new ActionError("teapot", "I'm a teapot.", 418, { hint: "coffee" });
        return { text };
      },
    }),
    defineAction({ name: "echo.empty", title: "No input", method: "POST", path: "/echo/empty", handler: () => "ok" }),
  ],
});

async function make() {
  const plugins = [...BUILTIN_PLUGINS, echo];
  const store = openStore(":memory:", migrationsOf(plugins));
  const app = await buildServer({ store, port: 7420, plugins });
  app.addHook("onClose", async () => store.close());
  apps.push(app);
  return app;
}

describe("actions", () => {
  it("builds routes with path, query and body input", async () => {
    const app = await make();
    const get = await app.inject({ url: "/api/v1/echo/abc?n=3&flag=true", headers: { host: HOST, "x-watchwright-client": "my-agent" } });
    expect(get.json()).toEqual({ data: { id: "abc", n: 3, flag: true, client: "my-agent" } });
    const post = await app.inject({ method: "POST", url: "/api/v1/echo", headers: { host: HOST }, payload: { text: "hi" } });
    expect(post.statusCode).toBe(201);
    expect(post.json()).toEqual({ data: { text: "hi" } });
    const empty = await app.inject({ method: "POST", url: "/api/v1/echo/empty", headers: { host: HOST } });
    expect(empty.json()).toEqual({ data: "ok" });
  });

  it("validates input with the error envelope", async () => {
    const app = await make();
    const bad = await app.inject({ url: "/api/v1/echo/ABC", headers: { host: HOST } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_input");
    const missing = await app.inject({ method: "POST", url: "/api/v1/echo", headers: { host: HOST }, payload: {} });
    expect(missing.json().error.code).toBe("invalid_input");
  });

  it("passes action errors through with their status and detail", async () => {
    const app = await make();
    const res = await app.inject({ method: "POST", url: "/api/v1/echo", headers: { host: HOST }, payload: { text: "teapot" } });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({ error: { code: "teapot", message: "I'm a teapot.", detail: { hint: "coffee" } } });
  });

  it("lists every action with its schema", async () => {
    const app = await make();
    const res = await app.inject({ url: "/api/v1/actions", headers: { host: HOST } });
    const names = (res.json().data as { name: string }[]).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["core.events", "packs.add", "runs.start", "runs.stop", "echo.get"]));
    const get = (res.json().data as { name: string; path: string }[]).find((a) => a.name === "echo.get");
    expect(get?.path).toBe("/api/v1/echo/:id");
  });

  it("refuses bad declarations", () => {
    const a = (name: string, path = "/x") => defineAction({ name, title: "", method: "GET", path, handler: () => null });
    expect(() => checkActions([a("Bad")])).toThrow(/look like/);
    expect(() => checkActions([a("x.a"), a("x.a", "/y")])).toThrow(/Two actions are named/);
    const withInput = (name: string, path: string, key: string) =>
      defineAction({ name, title: "", method: "GET", path, input: { type: "object", properties: { [key]: { type: "string" } } }, handler: () => null });
    expect(() => checkActions([withInput("x.a", "/z/:id", "id"), withInput("x.b", "/z/:other", "other")])).toThrow(/use the route/);
    expect(() => checkActions([a("x.a", "/z/:id")])).toThrow(/must be an input property/);
  });

  it("answers GET /events, waiting for the next event", async () => {
    const app = await make();
    const { events } = app.watchwright;
    const head = events.head();
    setTimeout(() => events.append("demo.ping", { n: 1 }), 30);
    const res = await app.inject({ url: `/api/v1/events?after=${head}&wait=5`, headers: { host: HOST } });
    const data = res.json().data as { events: { type: string }[]; next: number };
    expect(data.events.map((e) => e.type)).toEqual(["demo.ping"]);
    expect(data.next).toBe(head + 1);
    const none = await app.inject({ url: `/api/v1/events?after=${data.next}&wait=0`, headers: { host: HOST } });
    expect(none.json().data.events).toEqual([]);
    const tooLong = await app.inject({ url: "/api/v1/events?wait=500", headers: { host: HOST } });
    expect(tooLong.statusCode).toBe(400);
  });
});
