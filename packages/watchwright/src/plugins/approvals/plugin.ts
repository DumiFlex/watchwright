import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { ActionError, defineAction, type Action, type ActionGate, type ObjectSchema } from "../../actions/registry.js";
import { ACTION_GATE, ACTIONS } from "../../core/keys.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import type { EventLog } from "../../events/log.js";

// Approvals: an action that deletes data or stops the server, called by anything but the web page
// (an agent, the CLI without a terminal, a script), waits for the person to approve it on the web
// page. The gate holds the call for a while, then hands the caller an approval to wait on
// (docs/plans/step-5.md, section 6). Step 6's budgets will ask through the same gate.

export type ApprovalStatus = "waiting" | "approved" | "refused" | "expired" | "failed";

export interface Approval {
  id: string;
  action: string;
  input: Record<string, unknown>;
  /** Who asked (`Claude Code`, `cli`, `api`, …). */
  client: string;
  /** What the call would do, in words. */
  summary: string;
  status: ApprovalStatus;
  answeredBy: string | null;
  /** The action's answer once it ran (approved). */
  result: unknown;
  /** The action's error when it failed after approval. */
  error: { code: string; message: string } | null;
  createdAt: string;
  answeredAt: string | null;
  expiresAt: string;
}

/** How long the asking call is held before it gets the approval to wait on. */
export const HOLD_MS = 45_000;
/** An approval nobody answers expires after this. */
export const EXPIRE_MS = 30 * 60_000;
const MAX_WAIT_S = 110;

const SQL = `
  CREATE TABLE approvals (
    id          TEXT PRIMARY KEY,
    action      TEXT NOT NULL,
    input       TEXT NOT NULL,
    client      TEXT NOT NULL,
    summary     TEXT NOT NULL,
    status      TEXT NOT NULL,
    answered_by TEXT,
    result      TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL,
    answered_at TEXT,
    expires_at  TEXT NOT NULL
  );
  CREATE INDEX approvals_status ON approvals (status, created_at);
`;

interface Row {
  id: string;
  action: string;
  input: string;
  client: string;
  summary: string;
  status: ApprovalStatus;
  answered_by: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  answered_at: string | null;
  expires_at: string;
}

const toApproval = (r: Row): Approval => ({
  id: r.id,
  action: r.action,
  input: JSON.parse(r.input) as Record<string, unknown>,
  client: r.client,
  summary: r.summary,
  status: r.status,
  answeredBy: r.answered_by,
  result: r.result === null ? null : (JSON.parse(r.result) as unknown),
  error: r.error === null ? null : (JSON.parse(r.error) as Approval["error"]),
  createdAt: r.created_at,
  answeredAt: r.answered_at,
  expiresAt: r.expires_at,
});

/** The approvals store, the gate and answering. */
export class Approvals {
  private readonly waiters = new Map<string, Set<() => void>>();
  /** How long the gate holds a call before answering with the approval (tests shorten it). */
  holdMs = HOLD_MS;

  constructor(
    private readonly db: Database.Database,
    private readonly events: EventLog,
    private readonly actions: () => readonly Action[],
    private readonly now: () => number = Date.now,
  ) {}

  get(id: string): Approval | null {
    this.expire();
    const r = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return r ? toApproval(r) : null;
  }

  list(status?: ApprovalStatus, limit = 50): Approval[] {
    this.expire();
    const rows = (status
      ? this.db.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit)
      : this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?").all(limit)) as Row[];
    return rows.map(toApproval);
  }

  /** Files a request and tells the web page. */
  async request(action: Action, input: Record<string, unknown>, client: string): Promise<Approval> {
    // Asking again for the same thing while the first is still waiting gets the first one back.
    this.expire();
    const same = this.db.prepare("SELECT id FROM approvals WHERE status = 'waiting' AND action = ? AND input = ? AND client = ?").get(action.name, JSON.stringify(input), client) as { id: string } | undefined;
    if (same) return this.get(same.id)!;
    const summary = (await Promise.resolve(action.explain?.(input)).catch(() => undefined)) ?? `${action.title}: ${Object.entries(input).map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ")}`;
    const id = randomBytes(4).toString("hex");
    const t = this.now();
    this.db
      .prepare("INSERT INTO approvals (id, action, input, client, summary, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)")
      .run(id, action.name, JSON.stringify(input), client, summary, new Date(t).toISOString(), new Date(t + EXPIRE_MS).toISOString());
    this.events.append("approval.requested", { id, action: action.name, client, summary });
    return this.get(id)!;
  }

  /** The person's answer from the web page: approving runs the action now, as they would. */
  async answer(id: string, approve: boolean, by: string): Promise<Approval> {
    const a = this.get(id);
    if (!a) throw new ActionError("not_found", `No approval with id ${id}.`, 404);
    if (a.status !== "waiting") throw new ActionError("conflict", `The approval is ${a.status} already.`, 409);
    const at = new Date(this.now()).toISOString();
    if (!approve) {
      this.settle(id, { status: "refused", answered_by: by, answered_at: at });
      return this.get(id)!;
    }
    const action = this.actions().find((x) => x.name === a.action);
    if (!action) {
      this.settle(id, { status: "failed", answered_by: by, answered_at: at, error: JSON.stringify({ code: "unknown_action", message: `This server has no action ${a.action} any more.` }) });
      return this.get(id)!;
    }
    // Claimed first, so a second click can't run it twice.
    this.db.prepare("UPDATE approvals SET status = 'approved', answered_by = ?, answered_at = ? WHERE id = ?").run(by, at, id);
    try {
      const result = await action.handler(a.input, { client: a.client, signal: new AbortController().signal, fromPage: false });
      this.settle(id, { status: "approved", result: JSON.stringify(result ?? null) });
    } catch (err) {
      const e = err instanceof ActionError ? { code: err.code, message: err.message } : { code: "failed", message: err instanceof Error ? err.message : String(err) };
      this.settle(id, { status: "failed", error: JSON.stringify(e) });
    }
    return this.get(id)!;
  }

  /** Waits until the approval is answered or expires, at most `ms`. */
  async wait(id: string, ms: number, signal: AbortSignal): Promise<Approval | null> {
    const a = this.get(id);
    if (!a || a.status !== "waiting" || ms <= 0) return a;
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, set);
      // An expiry lands at most at the deadline, so a wait past it wakes then to see it.
      const left = Math.min(ms, Math.max(0, Date.parse(a.expiresAt) - this.now()) + 10);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, left);
      set.add(done);
      signal.addEventListener("abort", done);
    });
    return this.get(id);
  }

  /** The gate every destructive action call goes through. */
  readonly gate: ActionGate = async ({ action, input, call, confirmed }) => {
    if (call.fromPage || confirmed) return null;
    const asked = await this.request(action, input, call.client);
    const a = await this.wait(asked.id, this.holdMs, call.signal);
    if (a?.status === "approved") return { status: action.status ?? 200, data: a.result };
    if (a?.status === "refused") throw new ActionError("refused", `The person refused: ${a.summary}.`, 403, { approval: a });
    if (a?.status === "expired") throw new ActionError("expired", "Nobody answered the approval in time.", 403, { approval: a });
    if (a?.status === "failed") throw new ActionError(a.error?.code ?? "failed", a.error?.message ?? "The action failed.", 409, { approval: a });
    return { status: 202, data: { approval: a ?? asked, message: `Waiting for the person to approve on the web page: ${asked.summary.replace(/\.$/, "")}. Wait with approvals.wait, or the MCP tool wait_for_approval (id ${asked.id}).` } };
  };

  private settle(id: string, fields: Record<string, string | null>): void {
    const cols = Object.keys(fields);
    this.db.prepare(`UPDATE approvals SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
    const a = this.get(id)!;
    if (a.status !== "approved" || "result" in fields) this.events.append("approval.answered", { id, status: a.status, by: a.answeredBy, action: a.action });
    for (const w of [...(this.waiters.get(id) ?? [])]) w();
    this.waiters.delete(id);
  }

  /** Marks approvals past their time as expired. */
  expire(): void {
    const now = new Date(this.now()).toISOString();
    const due = this.db.prepare("SELECT id FROM approvals WHERE status = 'waiting' AND expires_at <= ?").all(now) as { id: string }[];
    for (const { id } of due) {
      this.db.prepare("UPDATE approvals SET status = 'expired', answered_at = ? WHERE id = ? AND status = 'waiting'").run(now, id);
      this.events.append("approval.answered", { id, status: "expired", by: null });
      for (const w of [...(this.waiters.get(id) ?? [])]) w();
      this.waiters.delete(id);
    }
  }
}

export const APPROVALS = serviceKey<Approvals>("approvals");

const ID: ObjectSchema["properties"][string] = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Approval id." };

export const approvalsPlugin = definePlugin({
  name: "approvals",
  migrations: [{ id: 1, name: "init", sql: SQL }],
  setup({ store, events, services }) {
    const approvals = new Approvals(store.db, events, () => services.get(ACTIONS));
    // A server that stopped can't run what was waiting; the callers are gone too.
    store.db.prepare("UPDATE approvals SET status = 'expired', answered_at = ? WHERE status = 'waiting'").run(new Date().toISOString());
    services.provide(APPROVALS, approvals);
    services.provide(ACTION_GATE, approvals.gate);
  },
  actions: ({ services }) => {
    const approvals = services.get(APPROVALS);
    return [
      defineAction<{ status?: ApprovalStatus; limit?: number }>({
        name: "approvals.list",
        title: "Approvals, newest first: actions that wait for the person to approve them on the web page, and how earlier ones were answered",
        method: "GET",
        path: "/approvals",
        input: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["waiting", "approved", "refused", "expired", "failed"] },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
        },
        handler: ({ status, limit }) => approvals.list(status, limit),
      }),
      defineAction<{ id: string; timeout?: number }>({
        name: "approvals.wait",
        title: `Wait until the person answers an approval, at most \`timeout\` seconds (up to ${MAX_WAIT_S})`,
        agent: {
          tool: "wait_for_approval",
          say: "status approved: it ran, and result is its answer. refused or expired: it didn't run; don't ask again unless the person says so. waiting: call again.",
        },
        method: "GET",
        path: "/approvals/:id/wait",
        input: { type: "object", properties: { id: ID, timeout: { type: "number", minimum: 0, maximum: MAX_WAIT_S, default: 60 } }, required: ["id"] },
        handler: async ({ id, timeout = 60 }, { signal }) => (await approvals.wait(id, timeout * 1000, signal)) ?? notFound(id),
      }),
      defineAction<{ id: string; approve: boolean }>({
        name: "approvals.answer",
        title: "Approve or refuse an approval (only from the web page); approving runs the action",
        method: "POST",
        path: "/approvals/:id/answer",
        input: { type: "object", properties: { id: ID, approve: { type: "boolean" } }, required: ["id", "approve"] },
        handler: ({ id, approve }, { fromPage, client }) => {
          if (!fromPage) throw new ActionError("not_allowed", "Only the person on the web page can answer an approval.", 403);
          return approvals.answer(id, approve, client);
        },
      }),
    ];
  },
});

function notFound(id: string): never {
  throw new ActionError("not_found", `No approval with id ${id}.`, 404);
}
