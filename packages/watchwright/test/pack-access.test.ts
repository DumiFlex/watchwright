import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS } from "../src/core/builtin.js";
import { ACTIONS } from "../src/core/keys.js";
import { migrationsOf } from "../src/core/plugin.js";
import { APPROVALS } from "../src/plugins/approvals/plugin.js";
import { AUTH_STORE } from "../src/plugins/auth/plugin.js";
import { PACK_ACCESS } from "../src/plugins/packs/access.js";
import { RunsRepo } from "../src/plugins/runs/repo.js";
import { buildServer } from "../src/server/app.js";
import { openStore, type Store } from "../src/store/db.js";
import { cleanTempDirs, tempDir, writeFiles } from "./helpers/fixtures.js";

// Pack access (docs/plans/pack-access.md): with login on, an admin keeps a pack to chosen people
// and groups. Everything that belongs to the pack follows it, and a hidden pack's things answer
// `not_found`, as if they didn't exist.

const HOST = "127.0.0.1:7420";
const PASSWORD = "correct horse battery";
const RUN = "abcd0001";
const OTHER_RUN = "abcd0002";

const open: { app: FastifyInstance; store: Store }[] = [];
afterEach(async () => {
  for (const { app, store } of open.splice(0)) {
    await app.close();
    store.close();
  }
  cleanTempDirs();
});

type Body = { data?: unknown; error?: { code: string; message: string } };

async function make() {
  const dataDir = tempDir("ww-data-");
  const store = openStore(dataDir, migrationsOf(BUILTIN_PLUGINS));
  const app = await buildServer({ store, port: 7420, plugins: BUILTIN_PLUGINS, login: true });
  open.push({ app, store });
  const auth = app.watchwright.services.get(AUTH_STORE);
  const ids: Record<string, string> = {};
  for (const [name, role] of [["ada", "admin"], ["uma", "user"], ["ulf", "user"], ["vic", "viewer"]] as const) ids[name] = (await auth.add({ name, password: PASSWORD, role })).id;
  const cookies: Record<string, string> = {};
  for (const name of Object.keys(ids)) {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signin", headers: { host: HOST, origin: `http://${HOST}` }, payload: { name, password: PASSWORD } });
    cookies[name] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
  const as = async (who: string, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) => {
    const res = await app.inject({ method, url: url.startsWith("/api") ? url : `/api/v1${url}`, headers: { host: HOST, origin: `http://${HOST}`, cookie: cookies[who]! }, ...(body === undefined ? {} : { payload: body as object }) });
    let json: Body = {};
    try {
      json = res.json() as Body;
    } catch {
      // a file
    }
    return { status: res.statusCode, body: json, raw: res.body };
  };
  const packOf = async (name: string) => {
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": `name: ${name}\nsite: { key: ${name.toLowerCase()}, baseURL: http://127.0.0.1:9/ }\n`,
      "tests/home.yaml": "id: H1\ntitle: Home\nsteps:\n  - goto: /\n",
    });
    return { dir, id: String(((await as("ada", "POST", "/packs", { path: dir })).body.data as { id: string }).id) };
  };
  const secret = await packOf("Secret");
  const shop = await packOf("Shop");
  // A finished run in each pack, with a file.
  const repo = new RunsRepo(store.db);
  for (const [runId, pack, name] of [[RUN, secret, "Secret"], [OTHER_RUN, shop, "Shop"]] as const) {
    repo.insertRun({ id: runId, pack_id: pack.id, pack_name: name, pack_path: pack.dir, site_key: name.toLowerCase(), job_kind: "test", tests: "[]", params: "{}", options: "{}", status: "finished", started_by: "web", created_at: "2026-11-01T10:00:00.000Z" });
    mkdirSync(path.join(dataDir, "runs", runId), { recursive: true });
    writeFileSync(path.join(dataDir, "runs", runId, "note.txt"), `${name} file`);
    app.watchwright.events.append("run.log", { level: "info", message: `${name} says hi` }, { runId });
  }
  return { app, as, ids, secret, shop };
}

describe("pack access", () => {
  it("has every action and plain route say which pack it reaches", async () => {
    const { app } = await make();
    const actions = app.watchwright.services.get(ACTIONS);
    expect(actions.filter((a) => a.pack === undefined).map((a) => a.name)).toEqual([]);
    const routes = app.watchwrightRoutes.filter((r) => r.url.startsWith("/api/v1") && r.method !== "HEAD" && r.access !== "public");
    expect(routes.filter((r) => r.pack === undefined).map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });

  it("opens every pack to everyone until an admin keeps one to chosen people", async () => {
    const { as, ids, secret } = await make();
    expect((await as("ulf", "GET", `/packs/${secret.id}`)).status).toBe(200);
    expect((await as("ada", "GET", `/packs/${secret.id}/access`)).body.data).toEqual({ mode: "everyone" });
    // Only admins read or change it.
    expect((await as("uma", "GET", `/packs/${secret.id}/access`)).status).toBe(403);
    expect((await as("uma", "POST", `/packs/${secret.id}/access`, { mode: "chosen", people: [ids.uma] })).status).toBe(403);
    const set = await as("ada", "POST", `/packs/${secret.id}/access`, { mode: "chosen", people: [ids.uma] });
    expect(set.body.data).toMatchObject({ mode: "chosen", people: [ids.uma], groups: [], updatedBy: "ada" });
    // And back.
    expect((await as("ada", "POST", `/packs/${secret.id}/access`, { mode: "everyone" })).body.data).toEqual({ mode: "everyone" });
  });

  it("hides a kept pack and everything in it from people who aren't let in", async () => {
    const { as, ids, secret, shop } = await make();
    await as("ada", "POST", `/packs/${secret.id}/access`, { mode: "chosen", people: [ids.uma] });
    const packNames = async (who: string) => ((await as(who, "GET", "/packs")).body.data as { name: string }[]).map((p) => p.name).sort();
    const runIds = async (who: string) => ((await as(who, "GET", "/runs")).body.data as { id: string }[]).map((r) => r.id).sort();

    // Admins and the people let in see it.
    for (const who of ["ada", "uma"]) {
      expect(await packNames(who), who).toEqual(["Secret", "Shop"]);
      expect(await runIds(who), who).toEqual([RUN, OTHER_RUN].sort());
      expect((await as(who, "GET", `/runs/${RUN}`)).status, who).toBe(200);
      expect((await as(who, "GET", `/files/runs/${RUN}/note.txt`)).raw, who).toBe("Secret file");
    }
    // Everyone else: as if it weren't there.
    for (const who of ["ulf", "vic"]) {
      expect(await packNames(who), who).toEqual(["Shop"]);
      expect(await runIds(who), who).toEqual([OTHER_RUN]);
      for (const url of [`/packs/${secret.id}`, `/packs/${secret.id}/files`, `/packs/${secret.id}/dashboard`, `/packs/${secret.id}/history`, `/runs/${RUN}`, `/runs/${RUN}/summary`, `/runs/${RUN}/changes`, `/compare?runs=${RUN}`, `/files/runs/${RUN}/note.txt`, `/packs/${secret.id}/download`,
        // The same file by other spellings of its path.
        `/files/runs/./${RUN}/note.txt`, `/files/runs//${RUN}/note.txt`, `/files/runs/x/../${RUN}/note.txt`, `/files/runs/%2e/${RUN}/note.txt`]) {
        const res = await as(who, "GET", url);
        expect(res.status, `${who} ${url}`).toBe(404);
        expect(res.body.error?.code, `${who} ${url}`).toBe("not_found");
      }
      // The other pack is as before.
      expect((await as(who, "GET", `/runs/${OTHER_RUN}`)).status).toBe(200);
      expect((await as(who, "GET", `/files/runs/${OTHER_RUN}/note.txt`)).raw).toBe("Shop file");
      // Events of the hidden pack's runs stay out.
      const events = (await as(who, "GET", "/events")).body.data as { events: { data: { message?: string } }[] };
      const said = events.events.map((e) => e.data.message).filter(Boolean);
      expect(said, who).toContain("Shop says hi");
      expect(said, who).not.toContain("Secret says hi");
    }
    // Starting, scheduling or changing things in it is refused the same way.
    expect((await as("ulf", "POST", "/runs", { packId: secret.id })).status).toBe(404);
    expect((await as("ulf", "POST", "/schedules", { name: "nightly", packId: secret.id, when: { every: "1d" } })).status).toBe(404);
    expect((await as("ulf", "POST", `/packs/${secret.id}/file`, { path: "tests/home.yaml", text: "x" })).status).toBe(404);
    expect((await as("ulf", "POST", "/shares", { run: RUN })).status).toBe(404);
    // Other packs stay open to everyone.
    expect((await as("ada", "GET", `/packs/${shop.id}/access`)).body.data).toEqual({ mode: "everyone" });
  });

  it("keeps a hidden pack's schedules and approvals out of the event feed", async () => {
    const { app, as, ids, secret, shop } = await make();
    await as("ada", "POST", `/packs/${secret.id}/access`, { mode: "chosen", people: [ids.uma] });
    expect((await as("ada", "POST", "/schedules", { name: "secret-nightly", packId: secret.id, when: { every: "1d" } })).status).toBe(201);
    expect((await as("ada", "POST", "/schedules", { name: "shop-nightly", packId: shop.id, when: { every: "1d" } })).status).toBe(201);
    // An agent's delete waits for approval; its summary names the run's pack.
    const approvals = app.watchwright.services.get(APPROVALS);
    const action = app.watchwright.services.get(ACTIONS).find((a) => a.name === "runs.delete")!;
    const secretAsk = await approvals.request(action, { id: RUN }, "agent", null);
    const shopAsk = await approvals.request(action, { id: OTHER_RUN }, "agent", null);
    const feed = async (who: string) => JSON.stringify(((await as(who, "GET", "/events")).body.data as { events: unknown[] }).events);
    for (const who of ["ada", "uma"]) {
      const seen = await feed(who);
      expect(seen, who).toContain("secret-nightly");
      expect(seen, who).toContain(secretAsk.id);
    }
    const seen = await feed("ulf");
    expect(seen).toContain("shop-nightly");
    expect(seen).toContain(shopAsk.id);
    expect(seen).not.toContain("secret-nightly");
    expect(seen).not.toContain(secretAsk.id);
  });

  it("lets people in by group", async () => {
    const { app, secret } = await make();
    const access = app.watchwright.services.get(PACK_ACCESS);
    access.set(secret.id, { people: [], groups: ["QA"] }, "ada");
    const person = { id: "u1", name: "gil", role: "user" as const, via: "session" as const };
    expect(access.sees({ ...person, groups: ["qa"] }, secret.id)).toBe(true);
    expect(access.sees({ ...person, groups: ["dev"] }, secret.id)).toBe(false);
    expect(access.sees(person, secret.id)).toBe(false);
    expect(access.sees({ ...person, role: "admin" }, secret.id)).toBe(true);
    expect(access.sees(undefined, secret.id)).toBe(true);
    expect(access.hiddenFrom(person)).toEqual([secret.id]);
  });
});

describe("groups", () => {
  it("lets people in by the groups an admin sets and the ones their sign-in brings", async () => {
    const { as, ids, secret } = await make();
    await as("ada", "POST", `/packs/${secret.id}/access`, { mode: "chosen", groups: ["QA"] });
    expect((await as("ulf", "GET", `/packs/${secret.id}`)).status).toBe(404);
    // Only admins set groups.
    expect((await as("ulf", "POST", `/auth/users/${ids.ulf}`, { groups: ["qa"] })).status).toBe(403);
    const changed = await as("ada", "POST", `/auth/users/${ids.ulf}`, { groups: [" qa ", "QA", "night shift"] });
    expect(changed.body.data).toMatchObject({ groups: ["night shift", "qa"], ssoGroups: [] });
    expect((await as("ulf", "GET", `/packs/${secret.id}`)).status).toBe(200);
    // The admin's overview lists kept packs only.
    const all = (await as("ada", "GET", "/packs/access")).body.data as Record<string, { mode: string; groups: string[] }>;
    expect(Object.keys(all)).toEqual([secret.id]);
    expect(all[secret.id]).toMatchObject({ mode: "chosen", groups: ["QA"] });
    expect((await as("uma", "GET", "/packs/access")).status).toBe(403);
  });
});
