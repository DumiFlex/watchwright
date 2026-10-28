import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RunDetail } from "../src/plugins/runs/engine.js";
import { SignInStore } from "../src/plugins/signins/plugin.js";
import { cleanTempDirs, startSite, tempDir, writeFiles } from "./helpers/fixtures.js";
import { engineOf, hasChromium, requireBrowsers, startHarness, type Harness } from "./helpers/harness.js";

// Saved sign-ins: one storage state per site key, saved by a test or a recording, used by runs
// that start signed in.

function store(): SignInStore {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE signins (site_key TEXT PRIMARY KEY, state TEXT NOT NULL, saved_at TEXT NOT NULL, source TEXT NOT NULL);");
  return new SignInStore(db);
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

const STATE = {
  cookies: [{ name: "sid", value: "abc", domain: "example.test", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" as const }],
  origins: [{ origin: "http://example.test", localStorage: [{ name: "token", value: "t" }] }],
};

describe("SignInStore", () => {
  it("saves, replaces, lists what it holds and deletes", () => {
    const s = store();
    s.save("shop", { cookies: [], origins: [] }, "record");
    const info = s.save("shop", STATE, "run abc123");
    expect(info).toMatchObject({ siteKey: "shop", source: "run abc123", cookies: 1, origins: ["http://example.test"] });
    expect(s.get("shop")).toEqual(STATE);
    expect(s.list()).toEqual([info]);
    expect(s.delete("shop")).toBe(true);
    expect(s.delete("shop")).toBe(false);
    expect(s.get("shop")).toBeUndefined();
  });
});

describe("sign-ins through the API", () => {
  it("lists them without their cookies and deletes as a destructive action", async () => {
    const h = await harness();
    expect((await h.api("GET", "/signins")).data).toEqual([]);
    expect((await h.api("DELETE", "/signins/shop")).status).toBe(404);
    const actions = await h.api<{ name: string; destructive?: boolean }[]>("GET", "/actions");
    const of = (name: string) => actions.data.find((a) => a.name === name);
    expect(of("signins.delete")?.destructive).toBe(true);
    expect(of("record.save-sign-in")?.destructive).toBe(true);
    expect(of("signins.list")?.destructive).toBeFalsy();
  });

  it("refuses a pack whose site.signIn isn't saved", async () => {
    const h = await harness();
    const dir = tempDir("ww-pack-");
    writeFiles(dir, { "pack.yaml": "name: Bad\nsite: { key: bad, signIn: always }\n", "tests/a.yaml": "tests:\n  - id: A\n    steps:\n      - reload\n" });
    const added = await h.api<{ problems: string[] }>("POST", "/packs", { path: dir });
    expect(JSON.stringify(added.data.problems)).toMatch(/signIn/);
  });
});

const engine = hasChromium || requireBrowsers ? describe : describe.skip;

engine("sign-ins in runs", { timeout: 90_000 }, () => {
  let site: { url: string; close(): Promise<void> };
  beforeAll(async () => {
    site = await startSite();
  });
  afterAll(async () => {
    await site.close();
  });

  it("saves one in a login test and starts later runs signed in, or fails to start without one", async () => {
    const h = await harness();
    const key = `signin-${Math.random().toString(36).slice(2, 8)}`;
    const dir = tempDir("ww-pack-");
    writeFiles(dir, {
      "pack.yaml": `name: Sign-ins\nsite: { key: ${key}, baseURL: "${site.url}" }\nrun: { video: false }\n`,
      "tests/save.yaml": `tests:
  - id: SAVE
    needs: [LOGIN]
    steps:
      - goto: /
      - saveSignIn
`,
      "tests/login.ts": `import { test } from "watchwright";
test("LOGIN", async ({ h, page }) => { await h.goto("/"); await page.evaluate(() => localStorage.setItem("token", "signed-in")); });`,
      "tests/check.ts": `import { test } from "watchwright";
test("CHECK", async ({ h, page }) => { await h.goto("/"); const t = await page.evaluate(() => localStorage.getItem("token")); if (t !== "signed-in") throw new Error("not signed in: " + t); });`,
    });
    const added = await h.api<{ id: string }>("POST", "/packs", { path: dir });
    const run = async (body: Record<string, unknown>) => {
      const res = await h.api<{ id: string }>("POST", "/runs", { packId: added.data.id, pauseOnBroken: false, video: false, ...body });
      const id = res.data.id;
      await h.waitFor((e) => e.runId === id && (e.type === "run.finished" || e.type === "run.failed_to_start"), 45_000);
      await engineOf(h).settled(id);
      return (await h.api<RunDetail>("GET", `/runs/${id}`)).data;
    };

    const login = await run({ tests: ["SAVE"] });
    expect(login.attempts.map((a) => [a.testId, a.status])).toEqual([["LOGIN", "passed"], ["SAVE", "passed"]]);
    const list = await h.api<{ siteKey: string; source: string; origins: string[] }[]>("GET", "/signins");
    expect(list.data).toEqual([expect.objectContaining({ siteKey: key, source: `run ${login.id}`, origins: [new URL(site.url).origin] })]);

    expect((await run({ tests: ["CHECK"] })).attempts.map((a) => a.status)).toEqual(["broken"]);
    expect((await run({ tests: ["CHECK"], signIn: true })).attempts.map((a) => a.status)).toEqual(["passed"]);

    expect((await h.api("DELETE", `/signins/${key}`)).status).toBe(200);
    const none = await run({ tests: ["CHECK"], signIn: true });
    expect(none.status).toBe("failed_to_start");
    expect(none.error).toMatch(/No saved sign-in/);
  });
});
