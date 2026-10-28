import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import { maskDeep } from "../src/plugins/runs/engine.js";
import type { ResultDocument } from "../src/plugins/runs/results.js";
import { SecretStore } from "../src/plugins/secrets/plugin.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Secrets: kept in the store, never answered by the API, masked in everything a run records.

function store(): SecretStore {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, set_at TEXT NOT NULL);");
  return new SecretStore(db);
}

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  cleanTempDirs();
});

async function harness(): Promise<Harness> {
  const h = await startHarness(tempDir("ww-data-"));
  harnesses.push(h);
  return h;
}

describe("SecretStore", () => {
  it("sets, replaces, lists without values and deletes", () => {
    const s = store();
    s.set("SHOP_PASSWORD", "first");
    const info = s.set("SHOP_PASSWORD", "hunter22");
    expect(info).toMatchObject({ name: "SHOP_PASSWORD", length: 8 });
    expect(s.get("SHOP_PASSWORD")).toBe("hunter22");
    expect(s.list()).toEqual([{ name: "SHOP_PASSWORD", length: 8, setAt: info.setAt }]);
    expect(JSON.stringify(s.list())).not.toContain("hunter22");
    expect(s.delete("SHOP_PASSWORD")).toBe(true);
    expect(s.delete("SHOP_PASSWORD")).toBe(false);
    expect(s.get("SHOP_PASSWORD")).toBeUndefined();
  });

  it("refuses bad names and empty values", () => {
    const s = store();
    expect(() => s.set("1abc", "x")).toThrow(/letters, digits and _/);
    expect(() => s.set("has-dash", "x")).toThrow(/letters, digits and _/);
    expect(() => s.set("OK", "")).toThrow(/needs a value/);
  });

  it("masks every value of four or more characters, longest first", () => {
    const s = store();
    s.set("A", "token");
    s.set("B", "token-long");
    s.set("C", "abc");
    expect(s.mask("token-long and token and abc")).toBe("••• and ••• and abc");
    s.delete("B");
    expect(s.mask("token-long")).toBe("•••-long");
  });

  it("masks strings deep inside objects and arrays, leaving other values", () => {
    const s = store();
    s.set("P", "hunter22");
    expect(maskDeep({ a: "pw hunter22", b: ["hunter22", 3, true, null], c: { d: "x" } }, (t) => s.mask(t))).toEqual({ a: "pw •••", b: ["•••", 3, true, null], c: { d: "x" } });
  });
});

describe("secrets through the API", () => {
  it("never answers with a value", async () => {
    const h = await harness();
    const web = { host: h.host, origin: `http://${h.host}`, "content-type": "application/json" };
    const set = await h.app.inject({ method: "POST", url: "/api/v1/secrets", headers: web, payload: { name: "TOKEN", value: "abcd1234" } });
    expect(set.statusCode).toBe(201);
    expect(set.body).not.toContain("abcd1234");
    const list = await h.api<{ name: string; length: number }[]>("GET", "/secrets");
    expect(list.data).toEqual([expect.objectContaining({ name: "TOKEN", length: 8 })]);
    expect(JSON.stringify(list.data)).not.toContain("abcd1234");
    expect((await h.api("DELETE", "/secrets/TOKEN")).status).toBe(200);
    expect((await h.api("DELETE", "/secrets/TOKEN")).status).toBe(404);
  });

  it("lists setting and deleting a secret as destructive, so agents ask first", async () => {
    const h = await harness();
    const actions = await h.api<{ name: string; destructive?: boolean }[]>("GET", "/actions");
    const of = (name: string) => actions.data.find((a) => a.name === name);
    expect(of("secrets.set")?.destructive).toBe(true);
    expect(of("secrets.delete")?.destructive).toBe(true);
    expect(of("secrets.list")?.destructive).toBeFalsy();
  });
});

const engine = hasChromium || requireBrowsers ? describe : describe.skip;

engine("secrets in runs", { timeout: 90_000 }, () => {
  let site: { url: string; close(): Promise<void> };
  beforeAll(async () => {
    site = await startSite();
  });
  afterAll(async () => {
    await site.close();
  });

  it("fills ${secret.…} and h.secret values and masks them in the result and events", async () => {
    const h = await harness();
    const web = { host: h.host, origin: `http://${h.host}`, "content-type": "application/json" };
    await h.app.inject({ method: "POST", url: "/api/v1/secrets", headers: web, payload: { name: "SHOP_PASSWORD", value: "hunter22-secret" } });
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": `name: Secrets\nsite: { key: secrets-${Math.random().toString(36).slice(2, 8)}, baseURL: "${site.url}" }\nrun: { video: false }\n`,
      "tests/login.yaml": `tests:
  - id: S1
    steps:
      - goto: /form
      - fill: { target: { label: Email }, value: "\${secret.SHOP_PASSWORD}" }
      - expect: { target: { label: Email }, value: "hunter22-secret" }
      - log: "typed \${secret.SHOP_PASSWORD}"
  - id: S2
    steps:
      - fill: { target: { label: Email }, value: "\${secret.MISSING}" }
`,
      "tests/code.ts": `import { test } from "watchwright";
test("S3", async ({ h }) => { const pw = h.secret("SHOP_PASSWORD"); h.log("code saw " + pw); h.note("note " + pw); h.info("pw", pw); });`,
    });
    const added = await h.api<{ id: string }>("POST", "/packs", { path: dir });
    const res = await h.api<{ id: string }>("POST", "/runs", { packId: added.data.id, pauseOnBroken: false, video: false });
    const runId = res.data.id;
    await h.waitFor((e) => e.runId === runId && e.type === "run.finished", 45_000);
    await engineOf(h).settled(runId);
    const detail = (await h.api<RunDetail>("GET", `/runs/${runId}`)).data;
    const status = Object.fromEntries(detail.attempts.map((a) => [a.testId, a.status]));
    expect(status).toEqual({ S1: "passed", S2: "broken", S3: "passed" });

    const docs = await Promise.all(detail.attempts.map(async (a) => (await h.api<ResultDocument>("GET", `/runs/${runId}/attempts/${a.id}`)).data));
    const all = JSON.stringify(docs);
    expect(all).not.toContain("hunter22-secret");
    expect(docs.find((d) => d.test.id === "S2")?.error?.message).toMatch(/No secret named "MISSING".*Settings > Secrets/);
    const s3 = docs.find((d) => d.test.id === "S3")!;
    expect(s3.log.map((l) => l.message)).toContain("code saw •••");
    expect(s3.notes).toContain("note •••");
    expect(detail.info.pw).toBe("•••");
    const events = JSON.stringify(h.app.watchwright.events.after(0).filter((e) => e.runId === runId));
    expect(events).not.toContain("hunter22-secret");
  });
});
