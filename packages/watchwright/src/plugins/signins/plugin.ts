import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";

// Saved sign-ins: one Playwright storage state (cookies and local storage) per site key, so runs can
// start signed in instead of logging in every time. Saved from a Record session ("Save sign-in") or
// by a test (`h.saveSignIn()`), used by a pack with `site.signIn: "saved"` or a run started with
// `signIn: true` (docs/plans/groundwork.md, section 5). Like secrets, they're kept in the data
// folder and not encrypted.

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface SignInInfo {
  siteKey: string;
  savedAt: string;
  /** Where it came from: "record" or the run and test that saved it. */
  source: string;
  cookies: number;
  /** The sites (origins) whose local storage it holds. */
  origins: string[];
}

interface Row {
  site_key: string;
  state: string;
  saved_at: string;
  source: string;
}

export class SignInStore {
  constructor(private readonly db: Database.Database) {}

  private info(r: Row): SignInInfo {
    const state = JSON.parse(r.state) as StorageState;
    return { siteKey: r.site_key, savedAt: r.saved_at, source: r.source, cookies: state.cookies.length, origins: state.origins.map((o) => o.origin) };
  }

  list(): SignInInfo[] {
    return (this.db.prepare("SELECT * FROM signins ORDER BY site_key").all() as Row[]).map((r) => this.info(r));
  }

  get(siteKey: string): StorageState | undefined {
    const row = this.db.prepare("SELECT state FROM signins WHERE site_key = ?").get(siteKey) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as StorageState) : undefined;
  }

  save(siteKey: string, state: StorageState, source: string): SignInInfo {
    const savedAt = new Date().toISOString();
    const row: Row = { site_key: siteKey, state: JSON.stringify(state), saved_at: savedAt, source };
    this.db
      .prepare("INSERT INTO signins (site_key, state, saved_at, source) VALUES (@site_key, @state, @saved_at, @source) ON CONFLICT(site_key) DO UPDATE SET state = excluded.state, saved_at = excluded.saved_at, source = excluded.source")
      .run(row);
    return this.info(row);
  }

  delete(siteKey: string): boolean {
    return this.db.prepare("DELETE FROM signins WHERE site_key = ?").run(siteKey).changes > 0;
  }
}

export const SIGNINS = serviceKey<SignInStore>("signins.store");

export const signinsPlugin = definePlugin({
  name: "signins",
  migrations: [{ id: 1, name: "init", sql: "CREATE TABLE signins (site_key TEXT PRIMARY KEY, state TEXT NOT NULL, saved_at TEXT NOT NULL, source TEXT NOT NULL);" }],
  setup({ store, services }) {
    services.provide(SIGNINS, new SignInStore(store.db));
  },
  actions: ({ services }) => {
    const signins = services.get(SIGNINS);
    return [
      defineAction({
        name: "signins.list",
        title: "Saved sign-ins: each site key, when it was saved, from where, and how many cookies and sites it holds",
        method: "GET",
        path: "/signins",
        handler: () => signins.list(),
      }),
      defineAction<{ siteKey: string }>({
        name: "signins.delete",
        destructive: true,
        explain: ({ siteKey }) => `Delete the saved sign-in for ${siteKey}`,
        title: "Delete a saved sign-in (runs that start signed in then fail to start until one is saved again)",
        method: "DELETE",
        path: "/signins/:siteKey",
        input: { type: "object", properties: { siteKey: { type: "string", minLength: 1 } }, required: ["siteKey"] },
        handler: ({ siteKey }) => {
          if (!signins.delete(siteKey)) throw new ActionError("not_found", `No saved sign-in for ${siteKey}.`, 404);
          return { deleted: siteKey };
        },
      }),
    ];
  },
});
