import type Database from "better-sqlite3";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";

// Named secrets (passwords, tokens) that tests use without writing them into a pack: `${secret.NAME}`
// in YAML steps, `h.secret("NAME")` in code. They live in the store in the data folder, never in a
// pack or the repo. The API never answers with a value, and the engine masks every value in logs,
// notes, kept texts, step titles, errors and events. They are not encrypted: anyone who can read
// the data folder can read them (docs/plans/groundwork.md, section 5).

export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Values shorter than this aren't masked (masking "a" would mangle every log line). */
const MASK_MIN = 4;
/** What a masked value shows as. */
export const MASK = "•••";

export interface SecretInfo {
  name: string;
  /** How many characters the value has, so a person can tell an empty or truncated paste. */
  length: number;
  setAt: string;
}

export class SecretStore {
  private cache: string[] | null = null;

  constructor(private readonly db: Database.Database) {}

  list(): SecretInfo[] {
    const rows = this.db.prepare("SELECT name, value, set_at FROM secrets ORDER BY name").all() as { name: string; value: string; set_at: string }[];
    return rows.map((r) => ({ name: r.name, length: r.value.length, setAt: r.set_at }));
  }

  get(name: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM secrets WHERE name = ?").get(name) as { value: string } | undefined;
    return row?.value;
  }

  set(name: string, value: string): SecretInfo {
    if (!SECRET_NAME.test(name)) throw new ActionError("bad_input", `A secret's name is letters, digits and _, starting with a letter or _ (up to 64): "${name}" isn't.`);
    if (value.length === 0) throw new ActionError("bad_input", "A secret needs a value.");
    const setAt = new Date().toISOString();
    this.db.prepare("INSERT INTO secrets (name, value, set_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, set_at = excluded.set_at").run(name, value, setAt);
    this.cache = null;
    return { name, length: value.length, setAt };
  }

  delete(name: string): boolean {
    const gone = this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name).changes > 0;
    this.cache = null;
    return gone;
  }

  /**
   * Every value as it can appear in text, longest first: as typed, URL-encoded (a query string or
   * a form body, which a trace or a log can hold) and JSON-escaped.
   */
  private forms(): string[] {
    this.cache ??= [
      ...new Set(
        (this.db.prepare("SELECT value FROM secrets").all() as { value: string }[]).flatMap((r) => {
          const v = r.value;
          const url = encodeURIComponent(v);
          return [v, url, url.replace(/%20/g, "+"), JSON.stringify(v).slice(1, -1)];
        }),
      ),
    ]
      .filter((v) => v.length >= MASK_MIN)
      .sort((a, b) => b.length - a.length);
    return this.cache;
  }

  /** Replaces every secret value in `text` with •••. Longer values first, so one inside another still masks whole. */
  mask(text: string): string {
    let out = text;
    for (const v of this.forms()) if (out.includes(v)) out = out.split(v).join(MASK);
    return out;
  }

  /** `data` with every secret value's bytes replaced by •••, or null when it holds none (for files such as traces). */
  maskBytes(data: Buffer): Buffer | null {
    let out: Buffer | null = null;
    const mask = Buffer.from(MASK, "utf8");
    for (const v of this.forms()) {
      const needle = Buffer.from(v, "utf8");
      const from = out ?? data;
      if (from.indexOf(needle) < 0) continue;
      const parts: Buffer[] = [];
      let at = 0;
      for (let i = from.indexOf(needle); i >= 0; i = from.indexOf(needle, at)) {
        parts.push(from.subarray(at, i), mask);
        at = i + needle.length;
      }
      parts.push(from.subarray(at));
      out = Buffer.concat(parts);
    }
    return out;
  }
}

export const SECRETS = serviceKey<SecretStore>("secrets.store");

/** Secrets for tests: stored, set and removed from Settings > Secrets, masked everywhere they could show. */
export const secretsPlugin = definePlugin({
  name: "secrets",
  migrations: [{ id: 1, name: "init", sql: "CREATE TABLE secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, set_at TEXT NOT NULL);" }],
  setup({ store, services }) {
    services.provide(SECRETS, new SecretStore(store.db));
  },
  actions: ({ services }) => {
    const secrets = services.get(SECRETS);
    const NAME = { type: "string", pattern: SECRET_NAME.source, description: "Letters, digits and _, starting with a letter or _." } as const;
    return [
      defineAction({
        name: "secrets.list",
        pack: "none",
        access: "user",
        title: "The secrets' names, lengths and when each was set (never their values)",
        method: "GET",
        path: "/secrets",
        handler: () => secrets.list(),
      }),
      defineAction<{ name: string; value: string }>({
        name: "secrets.set",
        pack: "none",
        access: "admin",
        destructive: true,
        secret: ["value"],
        explain: ({ name }) => (secrets.get(name) === undefined ? `Add the secret ${name}` : `Replace the value of the secret ${name}`),
        title: "Set a secret (a new one, or a new value for one that exists); tests read it as ${secret.NAME}",
        method: "POST",
        path: "/secrets",
        status: 201,
        input: { type: "object", properties: { name: NAME, value: { type: "string", minLength: 1, maxLength: 10_000 } }, required: ["name", "value"] },
        handler: ({ name, value }) => secrets.set(name, value),
      }),
      defineAction<{ name: string }>({
        name: "secrets.delete",
        pack: "none",
        access: "admin",
        destructive: true,
        explain: ({ name }) => `Delete the secret ${name}`,
        title: "Delete a secret",
        method: "DELETE",
        path: "/secrets/:name",
        input: { type: "object", properties: { name: NAME }, required: ["name"] },
        handler: ({ name }) => {
          if (!secrets.delete(name)) throw new ActionError("not_found", `No secret named ${name}.`, 404);
          return { deleted: name };
        },
      }),
    ];
  },
});
