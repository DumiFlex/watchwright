import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { corePlugin } from "../src/core/core-plugin.js";
import { migrationsOf } from "../src/core/plugin.js";
import { EventLog } from "../src/events/log.js";
import { Alerter, verdictOf, type RunFacts } from "../src/plugins/alerts/alerter.js";
import { checkUrl, fill, outgoing, shownUrl, type AlertMessage, type Outgoing } from "../src/plugins/alerts/channels.js";
import { alertsPlugin } from "../src/plugins/alerts/plugin.js";
import { openStore } from "../src/store/db.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";
import { startHarness, type Harness } from "./helpers/harness.js";

// Alerts: what each channel sends, rules on the event log (only on change, passes again, scope,
// broken tests, schedules, approvals), retries, and the API.

const MESSAGE: AlertMessage = { trigger: "failed", title: "Shop: failed", text: "Run 0a1b2c3d failed: 3 passed, 1 failed of 4.", link: "http://127.0.0.1:7420/#/runs/0a1b2c3d" };
const SECRETS: Record<string, string> = { HOOK: "https://hooks.example.com/T000/secret-path", TOKEN: "tk_123456" };
const secret = (n: string) => SECRETS[n];

describe("channels", () => {
  it("fills secrets, shows only the site and checks URLs", () => {
    expect(fill("${secret.HOOK}", secret)).toBe(SECRETS.HOOK);
    expect(() => fill("${secret.NOPE}", secret)).toThrow(/NOPE isn't set/);
    expect(shownUrl("https://discord.com/api/webhooks/1/abc")).toBe("https://discord.com/…");
    expect(shownUrl("${secret.HOOK}")).toBe("${secret.HOOK}");
    expect(checkUrl("${secret.HOOK}")).toBeNull();
    expect(checkUrl("https://ntfy.sh/topic")).toBeNull();
    expect(checkUrl("ntfy.sh/topic")).toMatch(/isn't a URL/);
    expect(checkUrl("ftp://x/")).toMatch(/https:/);
  });

  it("shapes the message for each kind of channel", () => {
    const hook = outgoing("webhook", { url: "${secret.HOOK}", token: "${secret.TOKEN}" }, MESSAGE, secret);
    expect(hook.url).toBe(SECRETS.HOOK);
    expect(hook.headers.authorization).toBe("Bearer tk_123456");
    expect(JSON.parse(hook.body)).toMatchObject({ source: "watchwright", trigger: "failed", title: "Shop: failed", link: MESSAGE.link });
    const ntfy = outgoing("ntfy", { url: "https://ntfy.sh/ww" }, { ...MESSAGE, title: "Shop – failed" }, secret);
    expect(ntfy.body).toBe(MESSAGE.text);
    expect(ntfy.headers).toMatchObject({ "x-title": "Shop ? failed", "x-click": MESSAGE.link, "x-tags": "warning" });
    expect(ntfy.headers.authorization).toBeUndefined();
    expect(JSON.parse(outgoing("discord", { url: "https://discord.com/api/webhooks/1/a" }, MESSAGE, secret).body).content).toBe(`**Shop: failed**\n${MESSAGE.text}\n${MESSAGE.link}`);
    expect(JSON.parse(outgoing("slack", { url: "https://hooks.slack.com/x" }, { ...MESSAGE, text: "a < b" }, secret).body).text).toBe(`*Shop: failed*\na &lt; b\n<${MESSAGE.link}|Open in Watchwright>`);
  });

  it("reads how a run went", () => {
    const counts = { passed: 3, failed: 0, broken: 0, skipped: 0, stopped: 0, planned: 3 };
    expect(verdictOf({ status: "finished", counts })).toBe("passed");
    expect(verdictOf({ status: "finished", counts: { ...counts, broken: 1 } })).toBe("broken");
    expect(verdictOf({ status: "finished", counts: { ...counts, failed: 1, broken: 1 } })).toBe("failed");
    expect(verdictOf({ status: "stopped", counts })).toBe("stopped");
    expect(verdictOf({ status: "failed_to_start", counts })).toBe("failed_to_start");
  });
});

function world(sendImpl?: (out: Outgoing) => Promise<void>) {
  const store = openStore(":memory:", migrationsOf([corePlugin, alertsPlugin]));
  const events = new EventLog(store.db);
  const runs = new Map<string, RunFacts>();
  const sent: { url: string; body: string }[] = [];
  const alerter = new Alerter({
    db: store.db,
    events,
    run: (id) => runs.get(id) ?? null,
    scheduleId: (name) => (name === "Nightly" ? "5c4ed01e" : null),
    secret,
    mask: (t) => t.split("tk_123456").join("•••"),
    base: () => "http://127.0.0.1:7420/",
    delays: [1, 1, 1],
    send:
      sendImpl ??
      (async (out) => {
        sent.push({ url: out.url, body: out.body });
      }),
  });
  alerter.begin();
  let n = 0;
  /** Ends a run of a pack the way the engine does. */
  const finish = (verdict: "passed" | "failed" | "broken" | "stopped", opts: { pack?: string; by?: string } = {}) => {
    const id = `0000000${++n}`.slice(-8);
    const counts = { passed: 2, failed: verdict === "failed" ? 1 : 0, broken: verdict === "broken" ? 1 : 0, skipped: 0, stopped: 0, planned: 3 };
    runs.set(id, { id, packId: opts.pack ?? "aaaa1111", packName: opts.pack === "bbbb2222" ? "Blog" : "Shop", label: "", status: verdict === "stopped" ? "stopped" : "finished", startedBy: opts.by ?? "web", error: null, counts });
    events.append("run.finished", { status: verdict === "stopped" ? "stopped" : "finished", counts }, { runId: id });
    return id;
  };
  const titles = () => sent.map((s) => (JSON.parse(s.body) as { title: string }).title);
  const flush = () => new Promise((r) => setTimeout(r, 30));
  return { store, events, alerter, runs, sent, finish, titles, flush };
}

const worlds: ReturnType<typeof world>[] = [];
const harnesses: Harness[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) {
    w.alerter.close();
    w.store.close();
  }
  for (const h of harnesses.splice(0)) await h.close();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  cleanTempDirs();
});
function make(sendImpl?: (out: Outgoing) => Promise<void>) {
  const w = world(sendImpl);
  worlds.push(w);
  return w;
}

describe("Alerter", () => {
  it("sends once per change with only on change, and every time without", async () => {
    const w = make();
    const ch = w.alerter.createChannel({ name: "Hook", type: "webhook", url: "${secret.HOOK}" });
    w.alerter.createRule({ name: "Failures", triggers: ["failed"], channels: [ch.id] });
    w.alerter.createRule({ name: "Every failure", triggers: ["failed"], channels: [ch.id], onlyOnChange: false });
    w.alerter.createRule({ name: "Back", triggers: ["recovered"], channels: [ch.id] });
    w.finish("failed");
    w.finish("failed");
    w.finish("passed");
    w.finish("passed");
    w.finish("failed");
    await w.flush();
    expect(w.titles()).toEqual(["Shop: failed", "Shop: failed", "Shop: failed", "Shop: passes again", "Shop: failed", "Shop: failed"]);
    expect(w.sent[0]!.url).toBe(SECRETS.HOOK);
    const log = w.alerter.log();
    expect(log).toHaveLength(6);
    expect(log.every((d) => d.status === "sent" && d.tries === 1)).toBe(true);
    expect(w.events.after(0).filter((e) => e.type === "alert.sent")).toHaveLength(6);
  });

  it("keeps to the rule's packs and schedules, and compares a schedule's runs with its own", async () => {
    const w = make();
    const ch = w.alerter.createChannel({ name: "Hook", type: "webhook", url: "https://hooks.example.com/a" });
    w.alerter.createRule({ name: "Blog", triggers: ["failed", "passed"], packs: ["bbbb2222"], channels: [ch.id] });
    w.alerter.createRule({ name: "Nightly", triggers: ["failed"], schedules: ["5c4ed01e"], channels: [ch.id] });
    w.finish("failed"); // Shop by hand: neither rule
    w.finish("failed", { by: "schedule:Nightly" }); // Nightly: first failure
    w.finish("passed", { pack: "bbbb2222" }); // Blog
    await w.flush();
    expect(w.titles()).toEqual(["Shop: failed", "Blog: passed"]);
    expect((JSON.parse(w.sent[0]!.body) as { text: string }).text).toMatch(/\(schedule Nightly\) failed: 2 passed, 1 failed of 3\./);
  });

  it("tells about a broken test once per run with only on change", async () => {
    const w = make();
    const ch = w.alerter.createChannel({ name: "Hook", type: "webhook", url: "https://hooks.example.com/a" });
    w.alerter.createRule({ name: "Broken", triggers: ["test_broken"], channels: [ch.id] });
    w.runs.set("abcdef01", { id: "abcdef01", packId: "aaaa1111", packName: "Shop", label: "smoke", status: "running", startedBy: "web", error: null, counts: { passed: 0, failed: 0, broken: 0, skipped: 0, stopped: 0, planned: 2 } });
    w.events.append("attempt.finished", { testId: "LOGIN", status: "broken", error: "Timeout tk_123456\nat line 3" }, { runId: "abcdef01", attemptId: "0123456789ab" });
    w.events.append("attempt.finished", { testId: "CART", status: "broken", error: null }, { runId: "abcdef01", attemptId: "0123456789ac" });
    w.events.append("attempt.finished", { testId: "HOME", status: "passed" }, { runId: "abcdef01", attemptId: "0123456789ad" });
    await w.flush();
    expect(w.sent).toHaveLength(1);
    const body = JSON.parse(w.sent[0]!.body) as { title: string; text: string; link: string };
    expect(body).toMatchObject({ title: "Shop: LOGIN is broken", text: "LOGIN broke in run abcdef01 (smoke): Timeout •••", link: "http://127.0.0.1:7420/#/runs/abcdef01/attempts/0123456789ab" });
  });

  it("tells about missed schedule times and approvals", async () => {
    const w = make();
    const ch = w.alerter.createChannel({ name: "Hook", type: "webhook", url: "https://hooks.example.com/a" });
    w.alerter.createRule({ name: "Ops", triggers: ["schedule_missed", "approval"], channels: [ch.id] });
    w.events.append("schedule.skipped", { id: "5c4ed01e", name: "Nightly", dueAt: "2026-10-28T02:00:00.000Z" });
    w.events.append("approval.requested", { id: "x", action: "packs.remove", client: "mcp:claude", summary: "Remove the pack Shop" });
    await w.flush();
    expect(w.titles()).toEqual(["Schedule Nightly: skipped a time", "Watchwright: waiting for your approval"]);
  });

  it("tries again with back-off, then logs alert.failed", async () => {
    let calls = 0;
    const w = make(async () => {
      calls++;
      if (calls < 3) throw new Error("hooks.example.com answered 502.");
    });
    const ch = w.alerter.createChannel({ name: "Flaky", type: "webhook", url: "https://hooks.example.com/a" });
    w.alerter.createRule({ name: "Failures", triggers: ["failed"], channels: [ch.id] });
    w.finish("failed");
    await w.flush();
    expect(w.alerter.log()[0]).toMatchObject({ status: "sent", tries: 3, error: null });

    const down = make(async () => {
      throw new Error("Couldn't reach hooks.example.com with tk_123456.");
    });
    const c2 = down.alerter.createChannel({ name: "Down", type: "webhook", url: "https://hooks.example.com/a" });
    down.alerter.createRule({ name: "Failures", triggers: ["failed"], channels: [c2.id] });
    down.finish("failed");
    await down.flush();
    expect(down.alerter.log()[0]).toMatchObject({ status: "failed", tries: 4, error: "Couldn't reach hooks.example.com with •••." });
    const failed = down.events.after(0).find((e) => e.type === "alert.failed");
    expect(failed?.data).toMatchObject({ rule: "Failures", channel: "Down", tries: 4 });
  });

  it("checks rules and channels, and takes a deleted channel out of its rules", () => {
    const w = make();
    expect(() => w.alerter.createChannel({ name: "Bad", type: "webhook", url: "hooks" })).toThrow(/isn't a URL/);
    const a = w.alerter.createChannel({ name: "A", type: "ntfy", url: "https://ntfy.sh/ww", token: "${secret.TOKEN}" });
    const b = w.alerter.createChannel({ name: "B", type: "slack", url: "https://hooks.slack.com/services/x" });
    expect(a).toMatchObject({ url: "https://ntfy.sh/…", hasToken: true });
    expect(() => w.alerter.createChannel({ name: "a", type: "slack", url: "https://hooks.slack.com/y" })).toThrow(/already a channel/);
    expect(() => w.alerter.createRule({ name: "R", triggers: [], channels: [a.id] })).toThrow(/trigger/);
    expect(() => w.alerter.createRule({ name: "R", triggers: ["failed"], channels: ["ffffffff"] })).toThrow(/No channel/);
    const r = w.alerter.createRule({ name: "R", triggers: ["failed"], channels: [a.id, b.id] });
    expect(r).toMatchObject({ onlyOnChange: true, enabled: true, packs: [], schedules: [] });
    expect(w.alerter.updateChannel(a.id, { token: "" }).hasToken).toBe(false);
    w.alerter.deleteChannel(a.id);
    expect(w.alerter.rule(r.id).channels).toEqual([b.id]);
  });
});

describe("alerts through the API", () => {
  it("adds a channel, sends a test, and keeps the URL to itself", async () => {
    const got: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        got.push({ headers: req.headers, body });
        res.writeHead(req.url === "/down" ? 500 : 200).end(req.url === "/down" ? "nope" : "ok");
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const page = async <T>(method: "POST" | "GET" | "DELETE", path: string, payload?: object) => {
      const res = await h.app.inject({ method, url: `/api/v1${path}`, headers: { host: h.host, origin: `http://${h.host}` }, ...(payload ? { payload } : {}) });
      return { status: res.statusCode, data: (res.json() as { data: T }).data, body: res.body };
    };
    const made = await page<{ id: string; url: string }>("POST", "/alerts/channels", { name: "Local", type: "webhook", url: `${url}/hook`, token: "abc" });
    expect(made.status).toBe(201);
    expect(made.data.url).toBe(`${url}/…`);
    expect((await h.api<{ url: string }[]>("GET", "/alerts/channels")).data[0]!.url).not.toContain("/hook");
    const test = await page<{ sent: boolean }>("POST", `/alerts/channels/${made.data.id}/test`);
    expect(test.data).toEqual({ sent: true });
    expect(got[0]!.headers.authorization).toBe("Bearer abc");
    expect(JSON.parse(got[0]!.body)).toMatchObject({ trigger: "test", link: `http://${h.host}/` });

    const down = await page<{ id: string }>("POST", "/alerts/channels", { name: "Down", type: "ntfy", url: `${url}/down` });
    const failed = await page("POST", `/alerts/channels/${down.data.id}/test`);
    expect(failed.status).toBe(502);
    expect(failed.body).toMatch(/send_failed.*answered 500: nope/);

    const rule = await page<{ id: string; triggers: string[] }>("POST", "/alerts/rules", { name: "Failures", triggers: ["failed", "recovered"], channels: [made.data.id] });
    expect(rule.status).toBe(201);
    expect((await page("POST", "/alerts/rules", { name: "Bad", triggers: ["sometimes"], channels: [made.data.id] })).status).toBe(400);
    expect((await h.api<unknown[]>("GET", "/alerts/rules")).data).toHaveLength(1);
    expect((await h.api<unknown[]>("GET", "/alerts/log")).data).toEqual([]);
    expect((await page("DELETE", `/alerts/rules/${rule.data.id}`)).status).toBe(200);
  });

  it("asks agents before changing channels and rules", async () => {
    const h = await startHarness(tempDir("ww-data-"));
    harnesses.push(h);
    const actions = await h.api<{ name: string; destructive?: boolean }[]>("GET", "/actions");
    const destructive = actions.data.filter((a) => a.name.startsWith("alerts.") && a.destructive).map((a) => a.name);
    expect(destructive.sort()).toEqual(["alerts.channel-create", "alerts.channel-delete", "alerts.channel-update", "alerts.rule-create", "alerts.rule-delete", "alerts.rule-update"]);
  });
});
