import type { FastifyInstance } from "fastify";
import type { Action } from "../actions/registry.js";
import type { EventLog } from "../events/log.js";
import type { Store } from "../store/db.js";
import type { Migration } from "../store/migrations.js";
import type { Services } from "./services.js";

// Every capability of Watchwright is a plugin: the server pieces that ship with it (core, packs,
// runs, live) and later ones such as scraping. A plugin brings its own store tables, services,
// actions and routes, so adding a capability means adding a plugin, not editing the core.
// See docs/plan.md, section 3.

export interface PluginContext {
  store: Store;
  /** Names of every plugin loaded, in load order. */
  plugins: readonly string[];
  /** The append-only event log every plugin writes to. */
  events: EventLog;
  /** Typed services plugins provide to each other (see `serviceKey`). */
  services: Services;
  /** Shuts the server process down (runs become interrupted, ready to resume); null when the server can't stop itself. */
  stop: (() => void) | null;
}

/**
 * A page of the web app a plugin brings. The web app builds its menu and its "Go to" commands
 * from the pages of the plugins the server loaded, so a page shows only when its plugin is there.
 */
export interface PluginPage {
  /** Lowercase letters, digits and dashes; unique across plugins. The web app's view for it is keyed by this name. */
  name: string;
  title: string;
  /** The page's address after `#`, such as `/packs`. */
  path: string;
  /** A Lucide icon name the web app has (`ListChecks`); shown in the command palette. */
  icon: string;
  /** `main`: in the top bar and the menu. `more`: in the menu only (the top bar has its own button or link for it). */
  menu: "main" | "more";
  /** Place in the menu, lowest first. */
  order: number;
  /** Extra words the command palette matches. */
  words?: string;
}

export interface WatchwrightPlugin {
  /** Lowercase letters, digits and dashes. Namespaces the plugin's migrations, events and actions. */
  name: string;
  /** Store migrations owned by this plugin, numbered from 1 within the plugin. Append only. */
  migrations?: Migration[];
  /** Runs once when the server is built, in plugin order: provide services, recover state. */
  setup?: (ctx: PluginContext) => void | Promise<void>;
  /** The plugin's operations. Each becomes an HTTP route under /api/v1 (and later a CLI command and an MCP tool). */
  actions?: (ctx: PluginContext) => Action[];
  /** Routes that aren't actions (WebSockets, file downloads). Mounted under /api/v1. */
  routes?: (app: FastifyInstance, ctx: PluginContext) => void | Promise<void>;
  /** Pages of the web app this plugin brings (see `PluginPage`). */
  pages?: PluginPage[];
  /** Runs when the server closes, in reverse plugin order. */
  close?: (ctx: PluginContext) => void | Promise<void>;
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Checks plugin names and page names: well formed and unique. Throws on the first problem. */
export function checkPlugins(plugins: readonly WatchwrightPlugin[]): void {
  const seen = new Set<string>();
  const pages = new Map<string, string>();
  for (const p of plugins) {
    if (!NAME.test(p.name)) throw new Error(`Plugin name "${p.name}" must be lowercase letters, digits and dashes, starting with a letter.`);
    if (seen.has(p.name)) throw new Error(`Two plugins are named "${p.name}".`);
    seen.add(p.name);
    for (const page of p.pages ?? []) {
      if (!NAME.test(page.name)) throw new Error(`Plugin "${p.name}": page name "${page.name}" must be lowercase letters, digits and dashes, starting with a letter.`);
      if (!page.path.startsWith("/")) throw new Error(`Plugin "${p.name}": page "${page.name}" needs a path that starts with "/".`);
      const other = pages.get(page.name);
      if (other) throw new Error(`Plugins "${other}" and "${p.name}" both have a page named "${page.name}".`);
      pages.set(page.name, p.name);
    }
  }
}

/** Every plugin's pages with the plugin's name, in menu order. */
export function pagesOf(plugins: readonly WatchwrightPlugin[]): (PluginPage & { plugin: string })[] {
  return plugins.flatMap((p) => (p.pages ?? []).map((page) => ({ ...page, plugin: p.name }))).sort((a, b) => a.order - b.order);
}

/** Identity helper so plugin files get type checking without importing the interface by hand. */
export function definePlugin(plugin: WatchwrightPlugin): WatchwrightPlugin {
  return plugin;
}

/** Collects each plugin's migrations, keyed by plugin name, for `openStore`. */
export function migrationsOf(plugins: readonly WatchwrightPlugin[]): Record<string, Migration[]> {
  return Object.fromEntries(plugins.map((p) => [p.name, p.migrations ?? []]));
}
