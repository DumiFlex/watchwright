import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunsRepo } from "../src/plugins/runs/repo.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Sharing without an account (docs/plans/self-hosting.md, section 4): share links and the public
// dashboard. Runs are written straight into the store, so these tests need no browser.

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

const RUN = "0000000a";
const PACK = "aaaaaaaa";
const ATTEMPT = "00000000000a";

async function withRun() {
  const dataDir = tempDir("ww-data-");
  const h = await startHarness(dataDir);
  harnesses.push(h);
  const repo = new RunsRepo(h.app.watchwright.store.db);
  repo.insertRun({ id: RUN, pack_id: PACK, pack_name: "Shop", pack_path: "/packs/shop", site_key: "shop", job_kind: "test", tests: "[]", params: "{}", options: "{}", label: "nightly", status: "finished", started_by: "web", created_at: "2026-11-01T10:00:00.000Z" });
  const folder = `runs/${RUN}/${ATTEMPT}`;
  repo.insertAttempt({ id: ATTEMPT, runId: RUN, kind: "test", itemId: "checkout", title: "Checkout", number: 1, of: 1, parentId: null, folder: () => folder });
  repo.finishAttempt(ATTEMPT, { status: "passed", flags: [], metrics: {}, notes: [], texts: {}, log: [], error: null });
  mkdirSync(path.join(dataDir, folder), { recursive: true });
  for (const [kind, name, contentType] of [
    ["shot", "cart.png", "image/png"],
    ["trace", "trace.zip", "application/zip"],
  ] as const) {
    writeFileSync(path.join(dataDir, folder, name), `${kind} bytes`);
    repo.addArtifact(ATTEMPT, RUN, { kind, name, contentType, path: `${folder}/${name}`, size: 10 });
  }
  // Something else in the data folder a share must never hand out.
  writeFileSync(path.join(dataDir, "watchwright.db.secret"), "no");
  /** A request from someone with nothing but the link: no cookie, no token, no page origin. */
  const anon = (url: string) => h.app.inject({ method: "GET", url, headers: { host: h.host } });
  return { h, anon, folder };
}

describe("share links", () => {
  it("opens one run read-only for anyone with the link, without traces unless asked", async () => {
    const { h, anon, folder } = await withRun();
    const made = await h.api<{ id: string; token: string; page: string }>("POST", "/shares", { run: RUN, days: 7 });
    expect(made.status).toBe(201);
    expect(made.data.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(made.data.page).toBe(`#/s/${made.data.token}`);
    const base = `/api/v1/shared/${made.data.token}`;

    const run = (await anon(base)).json().data;
    expect(run).toMatchObject({ id: RUN, packName: "Shop", label: "nightly", status: "finished", traces: false, running: false });
    expect(run.live).toBeUndefined();
    const attempt = (await anon(`${base}/attempts/${ATTEMPT}`)).json().data;
    expect(attempt.artifacts.map((a: { kind: string }) => a.kind)).toEqual(["shot"]);
    expect(attempt.artifacts[0].url).toBe(`${base}/files/${folder}/cart.png`);

    const shot = await anon(`${base}/files/${folder}/cart.png`);
    expect(shot.statusCode).toBe(200);
    expect(shot.body).toBe("shot bytes");
    expect((await anon(`${base}/files/${folder}/trace.zip`)).statusCode).toBe(404);
    expect((await anon(`${base}/files/watchwright.db.secret`)).statusCode).toBe(404);
    expect((await anon(`${base}/files/${folder}/../../../watchwright.db.secret`)).statusCode).toBe(404);
    // The run's own routes still need the server.
    expect((await anon(`/api/v1/shared/${"x".repeat(22)}`)).statusCode).toBe(404);

    // The link can be copied again from the list.
    const list = await h.api<{ id: string; views: number; page: string; run: { packName: string } }[]>("GET", `/shares?run=${RUN}`);
    expect(list.data).toMatchObject([{ id: made.data.id, views: 1, page: made.data.page, run: { packName: "Shop" } }]);

    expect((await h.api("DELETE", `/shares/${made.data.id}`)).status).toBe(200);
    const after = await anon(base);
    expect(after.statusCode).toBe(404);
    expect(after.json().error.code).toBe("not_shared");
  });

  it("shares traces when asked", async () => {
    const { h, anon, folder } = await withRun();
    const made = await h.api<{ token: string }>("POST", "/shares", { run: RUN, traces: true });
    const base = `/api/v1/shared/${made.data.token}`;
    expect((await anon(`${base}/attempts/${ATTEMPT}`)).json().data.artifacts.map((a: { kind: string }) => a.kind)).toEqual(["shot", "trace"]);
    expect((await anon(`${base}/files/${folder}/trace.zip`)).statusCode).toBe(200);
  });

  it("refuses a run that doesn't exist", async () => {
    const { h } = await withRun();
    expect((await h.api("POST", "/shares", { run: "0000000f" })).status).toBe(404);
  });
});

describe("public dashboard", () => {
  it("is off until an admin turns it on, and opens only its packs' runs", async () => {
    const { h, anon, folder } = await withRun();
    expect((await anon("/api/v1/public/status")).statusCode).toBe(404);
    expect((await anon(`/api/v1/public/runs/${RUN}`)).statusCode).toBe(404);

    await h.api("POST", "/shares/dashboard", { on: true, packs: [PACK], title: "Shop flows" });
    const status = (await anon("/api/v1/public/status")).json().data;
    // The pack isn't loaded in this server, so it is left out rather than shown half.
    expect(status).toEqual({ title: "Shop flows", linkRuns: false, packs: [] });
    expect((await anon(`/api/v1/public/runs/${RUN}`)).statusCode).toBe(404);

    await h.api("POST", "/shares/dashboard", { linkRuns: true });
    expect((await anon(`/api/v1/public/runs/${RUN}`)).json().data).toMatchObject({ id: RUN, traces: false });
    expect((await anon(`/api/v1/public/runs/${RUN}/files/${folder}/trace.zip`)).statusCode).toBe(404);
    expect((await anon(`/api/v1/public/runs/${RUN}/files/${folder}/cart.png`)).statusCode).toBe(200);

    await h.api("POST", "/shares/dashboard", { packs: ["bbbbbbbb"] });
    expect((await anon(`/api/v1/public/runs/${RUN}`)).statusCode).toBe(404);
  });
});
