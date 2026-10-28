import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { EventLog, WwEvent } from "../../events/log.js";
import { CHANNEL_TYPES, checkUrl, outgoing, send, shownUrl, type AlertMessage, type ChannelType, type Outgoing } from "./channels.js";

// Alerts (docs/plans/groundwork.md, section 7): rules read the event log and send a message to
// their channels when a run ends a certain way, passes again, a test breaks, a schedule misses a
// time or an agent waits for approval. "Only on change" sends one alert per change of a pack's (or
// a schedule's) outcome instead of one per run. A send that fails is tried three more times with
// back-off, then logged as `alert.failed`.

export const TRIGGERS = ["failed", "broken", "stopped", "passed", "failed_to_start", "recovered", "test_broken", "schedule_missed", "approval"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  /** The URL as the API shows it: a secret reference as written, otherwise only its site. */
  url: string;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelInput {
  name: string;
  type: ChannelType;
  url: string;
  token?: string | undefined;
}

export interface Rule {
  id: string;
  name: string;
  triggers: Trigger[];
  /** Pack ids; with `schedules`, empty for every pack and schedule. */
  packs: string[];
  /** Schedule ids. */
  schedules: string[];
  channels: string[];
  onlyOnChange: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RuleInput = Pick<Rule, "name" | "triggers" | "channels"> & Partial<Pick<Rule, "packs" | "schedules" | "onlyOnChange" | "enabled">>;

export interface Delivery {
  id: number;
  at: string;
  ruleId: string | null;
  ruleName: string;
  channelId: string;
  channelName: string;
  trigger: string;
  title: string;
  runId: string | null;
  status: "sending" | "sent" | "failed";
  tries: number;
  error: string | null;
}

/** What the alerter needs to know about a run. */
export interface RunFacts {
  id: string;
  packId: string;
  packName: string;
  label: string;
  status: string;
  startedBy: string;
  error: string | null;
  counts: { passed: number; failed: number; broken: number; skipped: number; stopped: number; planned: number };
}

export interface AlerterDeps {
  db: Database.Database;
  events: EventLog;
  run: (id: string) => RunFacts | null;
  /** The schedule a `schedule:<name>` run came from. */
  scheduleId: (name: string) => string | null;
  secret: (name: string) => string | undefined;
  mask: (text: string) => string;
  /** The web app's address, ending in a slash. */
  base: () => string;
  /** Waits between tries (default 5 s, 30 s, 2 min: three retries). */
  delays?: number[];
  send?: (out: Outgoing) => Promise<void>;
}

export class AlertError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface ChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  url: string;
  token: string | null;
  created_at: string;
  updated_at: string;
}

interface RuleRow {
  id: string;
  name: string;
  triggers: string;
  packs: string;
  schedules: string;
  channels: string;
  only_on_change: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const KEEP_LOG = 500;

/** How a finished run went, as one word. */
export function verdictOf(r: Pick<RunFacts, "status" | "counts">): string {
  if (r.status === "failed_to_start") return "failed_to_start";
  if (r.status === "stopped") return "stopped";
  if (r.counts.failed > 0) return "failed";
  if (r.counts.broken > 0) return "broken";
  return "passed";
}

function countsText(c: RunFacts["counts"]): string {
  const parts = [`${c.passed} passed`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.broken) parts.push(`${c.broken} broken`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  if (c.stopped) parts.push(`${c.stopped} stopped`);
  return `${parts.join(", ")} of ${c.planned}`;
}

const VERDICT_WORDS: Record<string, string> = { failed: "failed", broken: "broken", stopped: "stopped", passed: "passed", failed_to_start: "didn't start" };

export class Alerter {
  private readonly timers = new Set<NodeJS.Timeout>();
  private unsubscribe: (() => void) | null = null;
  private readonly delays: number[];
  private readonly sendOne: (out: Outgoing) => Promise<void>;
  /** Runs that already sent a `test_broken` alert for an only-on-change rule (rule:run). */
  private readonly brokenSent = new Set<string>();

  constructor(private readonly d: AlerterDeps) {
    this.delays = d.delays ?? [5_000, 30_000, 120_000];
    this.sendOne = d.send ?? ((out) => send(out));
  }

  // ---- channels

  private channelOf(r: ChannelRow): Channel {
    return { id: r.id, name: r.name, type: r.type, url: shownUrl(r.url), hasToken: r.token !== null, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  private channelRow(id: string): ChannelRow {
    const row = this.d.db.prepare("SELECT * FROM alerts_channels WHERE id = ?").get(id) as ChannelRow | undefined;
    if (!row) throw new AlertError("not_found", `No channel ${id}.`, 404);
    return row;
  }

  channels(): Channel[] {
    return (this.d.db.prepare("SELECT * FROM alerts_channels ORDER BY name COLLATE NOCASE").all() as ChannelRow[]).map((r) => this.channelOf(r));
  }

  private checkName(table: "alerts_channels" | "alerts_rules", what: string, name: string | undefined, id: string | null): void {
    if (name === undefined) return;
    if (!NAME.test(name)) throw new AlertError("bad_input", `A ${what}'s name is up to 64 letters, digits, spaces, dots, dashes or underscores.`);
    const other = this.d.db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`).get(name) as { id: string } | undefined;
    if (other && other.id !== id) throw new AlertError("name_taken", `There is already a ${what} named "${name}".`, 409);
  }

  private checkChannel(input: Partial<ChannelInput>, id: string | null): void {
    this.checkName("alerts_channels", "channel", input.name, id);
    if (input.type !== undefined && !CHANNEL_TYPES.includes(input.type)) throw new AlertError("bad_input", `A channel's type is one of ${CHANNEL_TYPES.join(", ")}.`);
    if (input.url !== undefined) {
      const bad = checkUrl(input.url);
      if (bad) throw new AlertError("bad_url", bad);
    }
  }

  createChannel(input: ChannelInput): Channel {
    this.checkChannel(input, null);
    const id = randomBytes(4).toString("hex");
    const at = new Date().toISOString();
    this.d.db
      .prepare("INSERT INTO alerts_channels (id, name, type, url, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.name, input.type, input.url.trim(), input.token ? input.token : null, at, at);
    this.d.events.append("alert.channel_changed", { id, name: input.name, change: "created" });
    return this.channelOf(this.channelRow(id));
  }

  /** Changes a channel. A missing `url` or `token` keeps the old one; an empty `token` removes it. */
  updateChannel(id: string, input: Partial<ChannelInput>): Channel {
    const old = this.channelRow(id);
    this.checkChannel(input, id);
    const token = input.token === undefined ? old.token : input.token === "" ? null : input.token;
    this.d.db
      .prepare("UPDATE alerts_channels SET name = ?, type = ?, url = ?, token = ?, updated_at = ? WHERE id = ?")
      .run(input.name ?? old.name, input.type ?? old.type, input.url?.trim() ?? old.url, token, new Date().toISOString(), id);
    this.d.events.append("alert.channel_changed", { id, name: input.name ?? old.name, change: "updated" });
    return this.channelOf(this.channelRow(id));
  }

  /** Deletes a channel and takes it out of every rule. */
  deleteChannel(id: string): void {
    const old = this.channelRow(id);
    this.d.db.transaction(() => {
      this.d.db.prepare("DELETE FROM alerts_channels WHERE id = ?").run(id);
      for (const r of this.rules().filter((r) => r.channels.includes(id))) {
        this.d.db.prepare("UPDATE alerts_rules SET channels = ? WHERE id = ?").run(JSON.stringify(r.channels.filter((c) => c !== id)), r.id);
      }
    })();
    this.d.events.append("alert.channel_changed", { id, name: old.name, change: "deleted" });
  }

  /** Sends a test message to a channel once, now. Throws with the reason it didn't arrive. */
  async test(id: string): Promise<void> {
    const ch = this.channelRow(id);
    const message: AlertMessage = { trigger: "test", title: "Watchwright: test alert", text: `This is a test from the channel "${ch.name}". Alerts sent here will look like this.`, link: this.d.base() };
    try {
      await this.sendOne(outgoing(ch.type, { url: ch.url, token: ch.token ?? undefined }, message, this.d.secret));
    } catch (err) {
      throw new AlertError("send_failed", this.d.mask(err instanceof Error ? err.message : String(err)), 502);
    }
  }

  // ---- rules

  private ruleOf(r: RuleRow): Rule {
    return {
      id: r.id,
      name: r.name,
      triggers: JSON.parse(r.triggers) as Trigger[],
      packs: JSON.parse(r.packs) as string[],
      schedules: JSON.parse(r.schedules) as string[],
      channels: JSON.parse(r.channels) as string[],
      onlyOnChange: r.only_on_change === 1,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  rules(): Rule[] {
    return (this.d.db.prepare("SELECT * FROM alerts_rules ORDER BY name COLLATE NOCASE").all() as RuleRow[]).map((r) => this.ruleOf(r));
  }

  rule(id: string): Rule {
    const row = this.d.db.prepare("SELECT * FROM alerts_rules WHERE id = ?").get(id) as RuleRow | undefined;
    if (!row) throw new AlertError("not_found", `No rule ${id}.`, 404);
    return this.ruleOf(row);
  }

  private checkRule(input: Partial<RuleInput>, id: string | null): void {
    this.checkName("alerts_rules", "rule", input.name, id);
    if (input.triggers !== undefined) {
      if (input.triggers.length === 0) throw new AlertError("bad_input", "A rule needs at least one trigger.");
      const bad = input.triggers.find((t) => !TRIGGERS.includes(t));
      if (bad) throw new AlertError("bad_input", `Unknown trigger "${bad}". Triggers are ${TRIGGERS.join(", ")}.`);
    }
    if (input.channels !== undefined) {
      if (input.channels.length === 0) throw new AlertError("bad_input", "A rule needs at least one channel.");
      const known = new Set(this.channels().map((c) => c.id));
      const missing = input.channels.find((c) => !known.has(c));
      if (missing) throw new AlertError("bad_input", `No channel ${missing}.`);
    }
  }

  createRule(input: RuleInput): Rule {
    this.checkRule(input, null);
    const id = randomBytes(4).toString("hex");
    const at = new Date().toISOString();
    this.d.db
      .prepare(
        "INSERT INTO alerts_rules (id, name, triggers, packs, schedules, channels, only_on_change, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.name, JSON.stringify(input.triggers), JSON.stringify(input.packs ?? []), JSON.stringify(input.schedules ?? []), JSON.stringify(input.channels), input.onlyOnChange === false ? 0 : 1, input.enabled === false ? 0 : 1, at, at);
    this.d.events.append("alert.rule_changed", { id, name: input.name, change: "created" });
    return this.rule(id);
  }

  updateRule(id: string, input: Partial<RuleInput>): Rule {
    const old = this.rule(id);
    this.checkRule(input, id);
    const r = { ...old, ...input };
    this.d.db
      .prepare("UPDATE alerts_rules SET name = ?, triggers = ?, packs = ?, schedules = ?, channels = ?, only_on_change = ?, enabled = ?, updated_at = ? WHERE id = ?")
      .run(r.name, JSON.stringify(r.triggers), JSON.stringify(r.packs), JSON.stringify(r.schedules), JSON.stringify(r.channels), r.onlyOnChange ? 1 : 0, r.enabled ? 1 : 0, new Date().toISOString(), id);
    this.d.events.append("alert.rule_changed", { id, name: r.name, change: "updated" });
    return this.rule(id);
  }

  deleteRule(id: string): void {
    const old = this.rule(id);
    this.d.db.prepare("DELETE FROM alerts_rules WHERE id = ?").run(id);
    this.d.events.append("alert.rule_changed", { id, name: old.name, change: "deleted" });
  }

  // ---- deliveries

  log(limit = 50): Delivery[] {
    const rows = this.d.db.prepare("SELECT * FROM alerts_log ORDER BY id DESC LIMIT ?").all(limit) as {
      id: number;
      at: string;
      rule_id: string | null;
      rule_name: string;
      channel_id: string;
      channel_name: string;
      trigger: string;
      title: string;
      run_id: string | null;
      status: Delivery["status"];
      tries: number;
      error: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      ruleId: r.rule_id,
      ruleName: r.rule_name,
      channelId: r.channel_id,
      channelName: r.channel_name,
      trigger: r.trigger,
      title: r.title,
      runId: r.run_id,
      status: r.status,
      tries: r.tries,
      error: r.error,
    }));
  }

  /** Starts reading the event log. */
  begin(): void {
    this.unsubscribe = this.d.events.subscribe((e) => {
      try {
        this.onEvent(e);
      } catch {
        // an alert must never break whatever wrote the event
      }
    });
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Waits until no send is waiting for a retry (tests). */
  get pending(): number {
    return this.timers.size;
  }

  private onEvent(e: WwEvent): void {
    switch (e.type) {
      case "run.finished":
      case "run.failed_to_start":
        if (e.runId) this.onRunEnd(e, e.runId);
        return;
      case "attempt.finished":
        if (e.runId && e.data.status === "broken") this.onBroken(e, e.runId);
        return;
      case "schedule.missed":
      case "schedule.skipped":
        this.onSchedule(e);
        return;
      case "approval.requested":
        this.fire(this.rules().filter((r) => r.enabled && r.triggers.includes("approval")), {
          trigger: "approval",
          title: "Watchwright: waiting for your approval",
          text: `${String(e.data.client ?? "An agent")} asks: ${String(e.data.summary ?? e.data.action ?? "")}. Approve or decline it on the Watchwright page.`,
          link: this.d.base(),
          event: { seq: e.seq, type: e.type, data: e.data },
        });
        return;
    }
  }

  /** The schedule a run came from, if a schedule started it. */
  private scheduleOfRun(run: RunFacts): string | null {
    return run.startedBy.startsWith("schedule:") ? this.d.scheduleId(run.startedBy.slice("schedule:".length)) : null;
  }

  private inScope(rule: Rule, packId: string | null, scheduleId: string | null): boolean {
    if (rule.packs.length === 0 && rule.schedules.length === 0) return true;
    return (packId !== null && rule.packs.includes(packId)) || (scheduleId !== null && rule.schedules.includes(scheduleId));
  }

  private runName(run: RunFacts): string {
    const schedule = run.startedBy.startsWith("schedule:") ? run.startedBy.slice("schedule:".length) : null;
    const what = run.label || (schedule ? `schedule ${schedule}` : "");
    return `Run ${run.id}${what ? ` (${what})` : ""}`;
  }

  private onRunEnd(e: WwEvent, runId: string): void {
    const run = this.d.run(runId);
    if (!run) return;
    const verdict = verdictOf(run);
    const scheduleId = this.scheduleOfRun(run);
    // A scheduled run compares with the schedule's last run, any other with the pack's last run.
    const key = scheduleId ? `schedule:${scheduleId}` : `pack:${run.packId}`;
    const before = (this.d.db.prepare("SELECT verdict FROM alerts_outcomes WHERE key = ?").get(key) as { verdict: string } | undefined)?.verdict ?? null;
    const at = new Date().toISOString();
    const remember = this.d.db.prepare("INSERT INTO alerts_outcomes (key, verdict, run_id, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET verdict = excluded.verdict, run_id = excluded.run_id, at = excluded.at");
    remember.run(key, verdict, run.id, at);
    if (scheduleId) remember.run(`pack:${run.packId}`, verdict, run.id, at);
    for (const k of [...this.brokenSent]) if (k.endsWith(`:${run.id}`)) this.brokenSent.delete(k);

    const link = `${this.d.base()}#/runs/${run.id}`;
    const event = { seq: e.seq, type: e.type, runId: run.id, data: e.data };
    const text =
      verdict === "failed_to_start"
        ? `${this.runName(run)} didn't start: ${this.d.mask(run.error ?? String(e.data.message ?? "no reason given"))}`
        : `${this.runName(run)} ${VERDICT_WORDS[verdict]}: ${countsText(run.counts)}.`;
    const rules = this.rules().filter((r) => r.enabled && this.inScope(r, run.packId, scheduleId));
    const changed = before !== verdict;
    const onOutcome = rules.filter((r) => r.triggers.includes(verdict as Trigger) && (!r.onlyOnChange || changed));
    this.fire(onOutcome, { trigger: verdict, title: `${run.packName}: ${VERDICT_WORDS[verdict]}`, text, link, event }, run.id);
    if (verdict === "passed" && before !== null && before !== "passed") {
      // A rule that already sent "passed" for this run doesn't send "recovered" too.
      const recovered = rules.filter((r) => r.triggers.includes("recovered") && !onOutcome.includes(r));
      this.fire(recovered, { trigger: "recovered", title: `${run.packName}: passes again`, text: `${this.runName(run)} passed after the last one ${VERDICT_WORDS[before] ?? before}: ${countsText(run.counts)}.`, link, event }, run.id);
    }
  }

  private onBroken(e: WwEvent, runId: string): void {
    const run = this.d.run(runId);
    if (!run) return;
    const scheduleId = this.scheduleOfRun(run);
    const rules = this.rules().filter((r) => r.enabled && r.triggers.includes("test_broken") && this.inScope(r, run.packId, scheduleId));
    // Only on change: one alert per run, for its first broken test.
    const send = rules.filter((r) => !r.onlyOnChange || !this.brokenSent.has(`${r.id}:${run.id}`));
    for (const r of send) if (r.onlyOnChange) this.brokenSent.add(`${r.id}:${run.id}`);
    const testId = String(e.data.testId ?? "?");
    const error = typeof e.data.error === "string" && e.data.error ? `: ${this.d.mask(e.data.error).split("\n")[0]!.slice(0, 300)}` : ".";
    this.fire(
      send,
      {
        trigger: "test_broken",
        title: `${run.packName}: ${testId} is broken`,
        text: `${testId} broke in ${this.runName(run).replace(/^Run/, "run")}${error}`,
        link: e.attemptId ? `${this.d.base()}#/runs/${run.id}/attempts/${e.attemptId}` : `${this.d.base()}#/runs/${run.id}`,
        event: { seq: e.seq, type: e.type, runId: run.id, data: e.data },
      },
      run.id,
    );
  }

  private onSchedule(e: WwEvent): void {
    const id = String(e.data.id ?? "");
    const name = String(e.data.name ?? id);
    const rules = this.rules().filter((r) => r.enabled && r.triggers.includes("schedule_missed") && this.inScope(r, null, id));
    const missed = e.type === "schedule.missed";
    const due = String(e.data.missedAt ?? e.data.dueAt ?? "");
    const text = missed
      ? `The schedule ${name} missed its time ${due} while Watchwright was off${e.data.policy === "once" ? "; it starts once now." : "; it waits for its next time."}`
      : `The schedule ${name} skipped its time ${due}: its last run is still going.`;
    this.fire(rules, { trigger: "schedule_missed", title: `Schedule ${name}: ${missed ? "missed a time" : "skipped a time"}`, text, link: `${this.d.base()}#/schedules`, event: { seq: e.seq, type: e.type, data: e.data } });
  }

  /** Sends a message for each rule to each of its channels. */
  private fire(rules: Rule[], message: AlertMessage, runId: string | null = null): void {
    for (const rule of rules) {
      for (const channelId of rule.channels) {
        const ch = this.d.db.prepare("SELECT * FROM alerts_channels WHERE id = ?").get(channelId) as ChannelRow | undefined;
        if (ch) this.deliver(rule, ch, message, runId);
      }
    }
  }

  private deliver(rule: Rule, ch: ChannelRow, message: AlertMessage, runId: string | null): void {
    const info = this.d.db
      .prepare("INSERT INTO alerts_log (at, rule_id, rule_name, channel_id, channel_name, trigger, title, run_id, status, tries, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sending', 0, NULL)")
      .run(new Date().toISOString(), rule.id, rule.name, ch.id, ch.name, message.trigger, message.title, runId);
    const logId = Number(info.lastInsertRowid);
    this.d.db.prepare("DELETE FROM alerts_log WHERE id <= ?").run(logId - KEEP_LOG);
    const what = { rule: rule.name, ruleId: rule.id, channel: ch.name, channelId: ch.id, trigger: message.trigger, title: message.title };
    const attempt = async (tries: number): Promise<void> => {
      try {
        await this.sendOne(outgoing(ch.type, { url: ch.url, token: ch.token ?? undefined }, message, this.d.secret));
        this.d.db.prepare("UPDATE alerts_log SET status = 'sent', tries = ?, error = NULL WHERE id = ?").run(tries, logId);
        this.d.events.append("alert.sent", { ...what, tries }, runId ? { runId } : {});
      } catch (err) {
        const reason = this.d.mask(err instanceof Error ? err.message : String(err));
        const wait = this.delays[tries - 1];
        if (wait === undefined) {
          this.d.db.prepare("UPDATE alerts_log SET status = 'failed', tries = ?, error = ? WHERE id = ?").run(tries, reason, logId);
          this.d.events.append("alert.failed", { ...what, tries, error: reason }, runId ? { runId } : {});
          return;
        }
        this.d.db.prepare("UPDATE alerts_log SET tries = ?, error = ? WHERE id = ?").run(tries, reason, logId);
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          void attempt(tries + 1);
        }, wait);
        timer.unref();
        this.timers.add(timer);
      }
    };
    void attempt(1);
  }
}
