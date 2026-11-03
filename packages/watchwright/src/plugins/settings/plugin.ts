import type Database from "better-sqlite3";
import { ActionError, defineAction, type JsonSchema } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";

// Preferences kept by the server. Each plugin declares its own settings with a schema and a
// default. A `server` setting has one value for everyone (kept in `settings`); a `user` setting
// (the editor that "open in editor" links use, how New run starts) is each person's own, kept in
// `settings_user`, and falls back to the server value, then the default. With login off there is
// one person, so their values are the server values. Preferences that belong to one browser
// (notifications, the look) stay in that browser. See docs/research/settings-pages.md.

export interface SettingDef {
  key: string;
  title: string;
  schema: JsonSchema;
  default: unknown;
  /** `user`: each person sets their own; the server value is the default for who hasn't. Default `server`. */
  scope?: "server" | "user";
}

export class SettingsService {
  private readonly defs = new Map<string, SettingDef>();

  constructor(private readonly db: Database.Database) {}

  /** Plugins call this in setup. Keys are `<plugin>.<name>`. */
  define(def: SettingDef): void {
    if (this.defs.has(def.key)) throw new Error(`The setting "${def.key}" is defined twice.`);
    this.defs.set(def.key, def);
  }

  definitions(): SettingDef[] {
    return [...this.defs.values()];
  }

  /** A setting's value; with `userId`, that person's own value of a `user` setting when they set one. */
  get<T>(key: string, userId?: string): T {
    const def = this.defs.get(key);
    if (!def) throw new Error(`No setting "${key}".`);
    if (userId !== undefined && def.scope === "user") {
      const own = this.db.prepare("SELECT value FROM settings_user WHERE user_id = ? AND key = ?").get(userId, key) as { value: string } | undefined;
      if (own) {
        const value = JSON.parse(own.value) as unknown;
        if (valid(def.schema, value)) return value as T;
      }
    }
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return def.default as T;
    const value = JSON.parse(row.value) as unknown;
    return (valid(def.schema, value) ? value : def.default) as T;
  }

  /** Every value; with `userId`, as it applies to that person. */
  all(userId?: string): Record<string, unknown> {
    return Object.fromEntries(this.definitions().map((d) => [d.key, this.get(d.key, userId)]));
  }

  /**
   * Sets a person's own values of `user` settings; all or nothing. `null` goes back to the server
   * value. With no person (login off) the values are the server's.
   */
  setMine(userId: string | null, values: Record<string, unknown>): Record<string, unknown> {
    this.check(values, true);
    if (userId === null) return this.set(values);
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(values)) {
        if (v === null) this.db.prepare("DELETE FROM settings_user WHERE user_id = ? AND key = ?").run(userId, k);
        else this.db.prepare("INSERT INTO settings_user (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(userId, k, JSON.stringify(v));
      }
    })();
    return this.all(userId);
  }

  private check(values: Record<string, unknown>, mine: boolean): void {
    for (const [k, v] of Object.entries(values)) {
      const def = this.defs.get(k);
      if (!def) throw new ActionError("unknown_setting", `There is no setting "${k}".`);
      if (mine && def.scope !== "user") throw new ActionError("server_setting", `"${k}" is one value for everyone; an admin changes it.`, 403);
      if (v !== null && !valid(def.schema, v)) throw new ActionError("invalid_setting", `"${k}" can't be ${JSON.stringify(v)}.`);
    }
  }

  /** Sets several values at once; all or nothing. `null` puts a setting back to its default. */
  set(values: Record<string, unknown>): Record<string, unknown> {
    this.check(values, false);
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(values)) {
        if (v === null) this.db.prepare("DELETE FROM settings WHERE key = ?").run(k);
        else this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, JSON.stringify(v));
      }
    })();
    return this.all();
  }
}

/** The small subset of JSON Schema settings use: a type, an enum, a range. */
function valid(schema: JsonSchema, v: unknown): boolean {
  if (schema.enum && !schema.enum.includes(v)) return false;
  switch (schema.type) {
    case "string":
      return typeof v === "string" && (schema.maxLength === undefined || v.length <= schema.maxLength);
    case "boolean":
      return typeof v === "boolean";
    case "integer":
    case "number":
      return typeof v === "number" && (schema.type === "number" || Number.isInteger(v)) && (schema.minimum === undefined || v >= schema.minimum) && (schema.maximum === undefined || v <= schema.maximum);
    default:
      return true;
  }
}

export const SETTINGS = serviceKey<SettingsService>("settings.service");

export const EDITORS = ["vscode", "cursor", "windsurf", "idea", "webstorm", "none"] as const;

/** Preferences: defined by plugins, read and changed through three actions. */
export const settingsPlugin = definePlugin({
  name: "settings",
  pages: [
    { name: "settings", title: "Settings", path: "/settings", icon: "Settings", menu: "more", order: 90, words: "preferences look theme editor notifications agents" },
    { name: "admin", title: "Admin", path: "/admin", icon: "ShieldCheck", menu: "more", order: 95, access: "admin", words: "server users secrets runners alerts storage update stop" },
  ],
  migrations: [
    { id: 1, name: "init", sql: "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);" },
    { id: 2, name: "per-user", sql: "CREATE TABLE settings_user (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key));" },
  ],
  setup({ store, services }) {
    const settings = new SettingsService(store.db);
    services.provide(SETTINGS, settings);
    settings.define({ key: "settings.editor", title: "The editor that file links open in", schema: { type: "string", enum: EDITORS }, default: "vscode", scope: "user" });
  },
  actions: ({ services }) => {
    const settings = services.get(SETTINGS);
    return [
      defineAction({
        name: "settings.get",
        pack: "none",
        title: "Every setting with its value as it applies to you, the server-wide values, and what each one is",
        method: "GET",
        path: "/settings",
        handler: (_input, call) => ({ values: settings.all(call.user?.id), server: settings.all(), definitions: settings.definitions().map((d) => ({ ...d, scope: d.scope ?? "server" })) }),
      }),
      defineAction<{ values: Record<string, unknown> }>({
        name: "settings.set",
        pack: "none",
        access: "admin",
        title: "Change settings (null puts one back to its default)",
        method: "POST",
        path: "/settings",
        input: { type: "object", properties: { values: { type: "object", description: "Setting keys and their new values." } }, required: ["values"] },
        handler: ({ values }, call) => {
          const server = settings.set(values);
          return { values: settings.all(call.user?.id), server };
        },
      }),
      defineAction<{ values: Record<string, unknown> }>({
        name: "settings.set-mine",
        pack: "none",
        access: "viewer",
        title: "Change your own value of per-user settings (null goes back to the server's)",
        method: "POST",
        path: "/settings/mine",
        input: { type: "object", properties: { values: { type: "object", description: "Keys of per-user settings and your values." } }, required: ["values"] },
        handler: ({ values }, call) => ({ values: settings.setMine(call.user?.id ?? null, values), server: settings.all() }),
      }),
    ];
  },
});
