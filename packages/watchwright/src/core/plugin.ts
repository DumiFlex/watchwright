import type { FastifyInstance } from "fastify";
import type { Store } from "../store/db.js";
import type { Migration } from "../store/migrations.js";

// Every capability of Watchwright is a plugin: the server pieces that ship with it (health now;
// packs, runs and the live view next) and later ones such as scraping. A plugin brings its own
// store tables and its own API routes, so adding a capability means adding a plugin, not editing
// the core. See docs/plan.md, section 3.

export interface PluginContext {
  store: Store;
  /** Names of every plugin loaded, in load order. */
  plugins: readonly string[];
}

export interface WatchwrightPlugin {
  /** Lowercase letters, digits and dashes. Namespaces the plugin's migrations, and later its events and actions. */
  name: string;
  /** Store migrations owned by this plugin, numbered from 1 within the plugin. Append only. */
  migrations?: Migration[];
  /** Adds the plugin's HTTP routes. They are mounted under /api/v1. */
  routes?: (app: FastifyInstance, ctx: PluginContext) => void | Promise<void>;
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Checks plugin names: well formed and unique. Throws on the first problem. */
export function checkPlugins(plugins: readonly WatchwrightPlugin[]): void {
  const seen = new Set<string>();
  for (const p of plugins) {
    if (!NAME.test(p.name)) throw new Error(`Plugin name "${p.name}" must be lowercase letters, digits and dashes, starting with a letter.`);
    if (seen.has(p.name)) throw new Error(`Two plugins are named "${p.name}".`);
    seen.add(p.name);
  }
}

/** Identity helper so plugin files get type checking without importing the interface by hand. */
export function definePlugin(plugin: WatchwrightPlugin): WatchwrightPlugin {
  return plugin;
}

/** Collects each plugin's migrations, keyed by plugin name, for `openStore`. */
export function migrationsOf(plugins: readonly WatchwrightPlugin[]): Record<string, Migration[]> {
  return Object.fromEntries(plugins.map((p) => [p.name, p.migrations ?? []]));
}
