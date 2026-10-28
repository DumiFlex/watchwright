import type Database from "better-sqlite3";
import { ActionError, defineAction, type JsonSchema } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";

// Preferences for this machine that every browser and agent should see the same way (the editor
// that "open in editor" links use, how New run starts). Each plugin declares its own settings
// with a schema and a default; values a person changed are kept in the `settings` table.
// Preferences that belong to one browser (notifications, the look) stay in that browser.

export interface SettingDef {
  key: string;
  title: string;
  schema: JsonSchema;
  default: unknown;
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

  get<T>(key: string): T {
    const def = this.defs.get(key);
    if (!def) throw new Error(`No setting "${key}".`);
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return def.default as T;
    const value = JSON.parse(row.value) as unknown;
    return (valid(def.schema, value) ? value : def.default) as T;
  }

  all(): Record<string, unknown> {
    return Object.fromEntries(this.definitions().map((d) => [d.key, this.get(d.key)]));
  }

  /** Sets several values at once; all or nothing. `null` puts a setting back to its default. */
  set(values: Record<string, unknown>): Record<string, unknown> {
    for (const [k, v] of Object.entries(values)) {
      const def = this.defs.get(k);
      if (!def) throw new ActionError("unknown_setting", `There is no setting "${k}".`);
      if (v !== null && !valid(def.schema, v)) throw new ActionError("invalid_setting", `"${k}" can't be ${JSON.stringify(v)}.`);
    }
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

/** Machine-wide preferences: defined by plugins, read and changed through two actions. */
export const settingsPlugin = definePlugin({
  name: "settings",
  migrations: [{ id: 1, name: "init", sql: "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);" }],
  setup({ store, services }) {
    const settings = new SettingsService(store.db);
    services.provide(SETTINGS, settings);
    settings.define({ key: "settings.editor", title: "The editor that file links open in", schema: { type: "string", enum: EDITORS }, default: "vscode" });
  },
  actions: ({ services }) => {
    const settings = services.get(SETTINGS);
    return [
      defineAction({
        name: "settings.get",
        title: "Every setting with its value, and what each one is",
        method: "GET",
        path: "/settings",
        handler: () => ({ values: settings.all(), definitions: settings.definitions() }),
      }),
      defineAction<{ values: Record<string, unknown> }>({
        name: "settings.set",
        title: "Change settings (null puts one back to its default)",
        method: "POST",
        path: "/settings",
        input: { type: "object", properties: { values: { type: "object", description: "Setting keys and their new values." } }, required: ["values"] },
        handler: ({ values }) => ({ values: settings.set(values) }),
      }),
    ];
  },
});
