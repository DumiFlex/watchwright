import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { SERVER_PORT } from "../../core/keys.js";
import { serviceKey } from "../../core/services.js";
import { ENGINE } from "../runs/plugin.js";
import { SCHEDULER } from "../schedules/plugin.js";
import { SECRETS } from "../secrets/plugin.js";
import { AlertError, Alerter, TRIGGERS, type ChannelInput, type RuleInput } from "./alerter.js";
import { CHANNEL_TYPES } from "./channels.js";

// Alerts: messages to a webhook, ntfy, Discord or Slack when runs end a certain way, pass again,
// a test breaks, a schedule misses a time or an agent waits for approval (docs/plans/groundwork.md,
// section 7). Rules read the event log, so nothing else needs to know about alerts.

export const ALERTER = serviceKey<Alerter>("alerts.alerter");

const ID = { type: "string", pattern: "^[0-9a-f]{8}$" } as const;
const NAME = { type: "string", minLength: 1, maxLength: 64 } as const;
const IDS = { type: "array", items: ID } as const;
const CHANNEL_PROPS = {
  name: NAME,
  type: { type: "string", enum: [...CHANNEL_TYPES] },
  url: { type: "string", minLength: 1, description: "The webhook or ntfy topic URL, or `${secret.NAME}` to keep it in Secrets." },
  token: { type: "string", description: "A bearer token (webhook, ntfy), or `${secret.NAME}`; an empty string removes it." },
} as const;
const RULE_PROPS = {
  name: NAME,
  triggers: { type: "array", items: { type: "string", enum: [...TRIGGERS] }, minItems: 1 },
  packs: { ...IDS, description: "Pack ids; with `schedules` empty too, every pack and schedule." },
  schedules: { ...IDS, description: "Schedule ids." },
  channels: { ...IDS, minItems: 1 },
  onlyOnChange: { type: "boolean", description: "Send once per change of a pack's or schedule's outcome, not for every run (default true)." },
  enabled: { type: "boolean" },
} as const;

async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AlertError) throw new ActionError(err.code, err.message, err.status);
    throw err;
  }
}

export const alertsPlugin = definePlugin({
  name: "alerts",
  migrations: [
    {
      id: 1,
      name: "init",
      sql: `CREATE TABLE alerts_channels (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        type       TEXT NOT NULL,
        url        TEXT NOT NULL,
        token      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE alerts_rules (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
        triggers       TEXT NOT NULL,
        packs          TEXT NOT NULL,
        schedules      TEXT NOT NULL,
        channels       TEXT NOT NULL,
        only_on_change INTEGER NOT NULL,
        enabled        INTEGER NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE TABLE alerts_outcomes (
        key     TEXT PRIMARY KEY,
        verdict TEXT NOT NULL,
        run_id  TEXT NOT NULL,
        at      TEXT NOT NULL
      );
      CREATE TABLE alerts_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        at           TEXT NOT NULL,
        rule_id      TEXT,
        rule_name    TEXT NOT NULL,
        channel_id   TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        trigger      TEXT NOT NULL,
        title        TEXT NOT NULL,
        run_id       TEXT,
        status       TEXT NOT NULL,
        tries        INTEGER NOT NULL,
        error        TEXT
      );`,
    },
  ],
  setup({ store, events, services }) {
    const engine = services.get(ENGINE);
    const secrets = services.get(SECRETS);
    services.provide(
      ALERTER,
      new Alerter({
        db: store.db,
        events,
        run: (id) => engine.get(id),
        scheduleId: (name) => (services.has(SCHEDULER) ? (services.get(SCHEDULER).list().find((s) => s.name === name)?.id ?? null) : null),
        secret: (name) => secrets.get(name),
        mask: (text) => secrets.mask(text),
        base: () => `http://127.0.0.1:${services.has(SERVER_PORT) ? services.get(SERVER_PORT) : 7420}/`,
      }),
    );
  },
  ready({ services }) {
    services.get(ALERTER).begin();
  },
  close({ services }) {
    services.get(ALERTER).close();
  },
  actions: ({ services }) => {
    const alerter = services.get(ALERTER);
    return [
      defineAction({
        name: "alerts.channels",
        title: "Alert channels: name, type (webhook, ntfy, discord, slack) and where they send (the site only; URLs and tokens are never answered)",
        method: "GET",
        path: "/alerts/channels",
        handler: () => alerter.channels(),
      }),
      defineAction<ChannelInput>({
        name: "alerts.channel-create",
        destructive: true,
        secret: ["url", "token"],
        explain: ({ name, type }) => `Add the ${type} alert channel "${name}", which sends messages outside this computer`,
        title: "Add an alert channel: a webhook, an ntfy topic, a Discord webhook or a Slack webhook",
        method: "POST",
        path: "/alerts/channels",
        status: 201,
        input: { type: "object", properties: CHANNEL_PROPS, required: ["name", "type", "url"] },
        handler: (b) => guard(() => alerter.createChannel(b)),
      }),
      defineAction<Partial<ChannelInput> & { id: string }>({
        name: "alerts.channel-update",
        destructive: true,
        secret: ["url", "token"],
        explain: ({ id }) => `Change the alert channel ${id}`,
        title: "Change an alert channel (a missing url or token keeps the old one)",
        method: "POST",
        path: "/alerts/channels/:id",
        input: { type: "object", properties: { id: ID, ...CHANNEL_PROPS }, required: ["id"] },
        handler: ({ id, ...rest }) => guard(() => alerter.updateChannel(id, rest)),
      }),
      defineAction<{ id: string }>({
        name: "alerts.channel-delete",
        destructive: true,
        explain: ({ id }) => `Delete the alert channel ${id}`,
        title: "Delete an alert channel (rules stop sending to it)",
        method: "DELETE",
        path: "/alerts/channels/:id",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) =>
          guard(() => {
            alerter.deleteChannel(id);
            return { deleted: id };
          }),
      }),
      defineAction<{ id: string }>({
        name: "alerts.channel-test",
        title: "Send a test message to an alert channel now; fails with the reason when it doesn't arrive",
        method: "POST",
        path: "/alerts/channels/:id/test",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => guard(async () => (await alerter.test(id), { sent: true })),
      }),
      defineAction({
        name: "alerts.rules",
        title: "Alert rules: which triggers, for which packs or schedules, to which channels, and whether only on change",
        method: "GET",
        path: "/alerts/rules",
        handler: () => alerter.rules(),
      }),
      defineAction<RuleInput>({
        name: "alerts.rule-create",
        destructive: true,
        explain: ({ name }) => `Add the alert rule "${name}"`,
        title: `Add an alert rule. Triggers: ${TRIGGERS.join(", ")}`,
        method: "POST",
        path: "/alerts/rules",
        status: 201,
        input: { type: "object", properties: RULE_PROPS, required: ["name", "triggers", "channels"] },
        handler: (b) => guard(() => alerter.createRule(b)),
      }),
      defineAction<Partial<RuleInput> & { id: string }>({
        name: "alerts.rule-update",
        destructive: true,
        explain: ({ id }) => `Change the alert rule ${id}`,
        title: "Change an alert rule",
        method: "POST",
        path: "/alerts/rules/:id",
        input: { type: "object", properties: { id: ID, ...RULE_PROPS }, required: ["id"] },
        handler: ({ id, ...rest }) => guard(() => alerter.updateRule(id, rest)),
      }),
      defineAction<{ id: string }>({
        name: "alerts.rule-delete",
        destructive: true,
        explain: ({ id }) => `Delete the alert rule ${id}`,
        title: "Delete an alert rule",
        method: "DELETE",
        path: "/alerts/rules/:id",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) =>
          guard(() => {
            alerter.deleteRule(id);
            return { deleted: id };
          }),
      }),
      defineAction<{ limit?: number }>({
        name: "alerts.log",
        title: "Alerts sent lately, newest first: rule, channel, what, sent or failed, tries and the error",
        method: "GET",
        path: "/alerts/log",
        input: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 500, default: 50 } } },
        handler: ({ limit }) => alerter.log(limit ?? 50),
      }),
    ];
  },
});
