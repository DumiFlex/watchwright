import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { stampOf } from "./files.js";

// Proposed changes (docs/research/teams-and-audience-dashboards.md): with login on only admins
// change a pack's code, so a user proposes a change instead, one or more files with a note, and an
// admin applies or declines it after looking at the diff. Each file keeps the text it was based on,
// so the diff shows what the person changed and applying it can tell when the file moved on since.

export const PROPOSALS_SQL = `
  CREATE TABLE editor_proposals (
    id          TEXT PRIMARY KEY,
    pack_id     TEXT NOT NULL,
    user_id     TEXT,
    by_name     TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL,
    reply       TEXT,
    answered_by TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    answered_at TEXT
  );
  CREATE INDEX editor_proposals_status ON editor_proposals (status, created_at);
  CREATE TABLE editor_proposal_files (
    proposal_id TEXT NOT NULL REFERENCES editor_proposals (id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    base        TEXT,
    text        TEXT,
    PRIMARY KEY (proposal_id, path)
  );
`;

export type ProposalStatus = "waiting" | "applied" | "declined" | "withdrawn";

export interface ProposalFile {
  path: string;
  /** The file as it was when proposed; null: it didn't exist (the proposal makes it). */
  base: string | null;
  /** The proposed text; null: the proposal deletes the file. */
  text: string | null;
}

export interface Proposal {
  id: string;
  packId: string;
  userId: string | null;
  by: string;
  note: string;
  status: ProposalStatus;
  reply: string | null;
  answeredBy: string | null;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  /** Paths, in order; `get` adds the files themselves. */
  paths: string[];
}

type Row = {
  id: string;
  pack_id: string;
  user_id: string | null;
  by_name: string;
  note: string;
  status: string;
  reply: string | null;
  answered_by: string | null;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
};

export const baseStamp = (f: Pick<ProposalFile, "base">): string | null => (f.base === null ? null : stampOf(f.base));

export class ProposalStore {
  constructor(private readonly db: Database.Database) {}

  private paths(id: string): string[] {
    return (this.db.prepare("SELECT path FROM editor_proposal_files WHERE proposal_id = ? ORDER BY path").all(id) as { path: string }[]).map((r) => r.path);
  }

  private toProposal(r: Row): Proposal {
    return {
      id: r.id,
      packId: r.pack_id,
      userId: r.user_id,
      by: r.by_name,
      note: r.note,
      status: r.status as ProposalStatus,
      reply: r.reply,
      answeredBy: r.answered_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      answeredAt: r.answered_at,
      paths: this.paths(r.id),
    };
  }

  get(id: string): Proposal | null {
    const r = this.db.prepare("SELECT * FROM editor_proposals WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toProposal(r) : null;
  }

  files(id: string): ProposalFile[] {
    return this.db.prepare("SELECT path, base, text FROM editor_proposal_files WHERE proposal_id = ? ORDER BY path").all(id) as ProposalFile[];
  }

  list(q: { packId?: string | undefined; status?: ProposalStatus | undefined; limit?: number | undefined } = {}): Proposal[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.packId) {
      where.push("pack_id = ?");
      args.push(q.packId);
    }
    if (q.status) {
      where.push("status = ?");
      args.push(q.status);
    }
    const rows = this.db
      .prepare(`SELECT * FROM editor_proposals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, q.limit ?? 200) as Row[];
    return rows.map((r) => this.toProposal(r));
  }

  waiting(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM editor_proposals WHERE status = 'waiting'").get() as { n: number }).n;
  }

  create(input: { packId: string; userId: string | null; by: string; note: string; files: ProposalFile[] }): Proposal {
    const id = randomBytes(4).toString("hex");
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO editor_proposals (id, pack_id, user_id, by_name, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)")
        .run(id, input.packId, input.userId, input.by, input.note, now, now);
      this.putFiles(id, input.files);
    })();
    return this.get(id)!;
  }

  private putFiles(id: string, files: ProposalFile[]): void {
    this.db.prepare("DELETE FROM editor_proposal_files WHERE proposal_id = ?").run(id);
    const add = this.db.prepare("INSERT INTO editor_proposal_files (proposal_id, path, base, text) VALUES (?, ?, ?, ?)");
    for (const f of files) add.run(id, f.path, f.base, f.text);
  }

  /** Changes a waiting proposal: its note, and its files when given (they replace the old ones). */
  update(id: string, change: { note?: string | undefined; files?: ProposalFile[] | undefined }): Proposal {
    this.db.transaction(() => {
      if (change.note !== undefined) this.db.prepare("UPDATE editor_proposals SET note = ? WHERE id = ?").run(change.note, id);
      if (change.files) this.putFiles(id, change.files);
      this.db.prepare("UPDATE editor_proposals SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    })();
    return this.get(id)!;
  }

  answer(id: string, status: Exclude<ProposalStatus, "waiting">, by: string, reply: string | null): Proposal {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE editor_proposals SET status = ?, answered_by = ?, reply = ?, answered_at = ?, updated_at = ? WHERE id = ?").run(status, by, reply, now, now, id);
    return this.get(id)!;
  }
}
