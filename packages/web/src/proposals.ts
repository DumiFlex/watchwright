// Proposed changes to a pack's code (docs/research/teams-and-audience-dashboards.md): users propose,
// admins apply or decline after reading the diff.
import { getJson, sendJson, type ApiResult } from "./api";

export type ProposalStatus = "waiting" | "applied" | "declined" | "withdrawn";

export interface Proposal {
  id: string;
  packId: string;
  packName: string;
  userId: string | null;
  by: string;
  note: string;
  status: ProposalStatus;
  reply: string | null;
  answeredBy: string | null;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  paths: string[];
}

export interface ProposalFile {
  path: string;
  /** The file it was based on; null: a new file. */
  base: string | null;
  /** The proposed text; null: deletes the file. */
  text: string | null;
  /** The file on disk now; null: it doesn't exist. */
  current: string | null;
  /** The file changed on disk since the change was proposed. */
  changedSince: boolean;
}

export type ProposalDetail = Proposal & { files: ProposalFile[] };

/** A file a proposal sends: its new text (or a delete), and the stamp it was read with ("" for a file that didn't exist). */
export interface ProposalInput {
  path: string;
  text?: string;
  delete?: boolean;
  stamp?: string;
}

export const listProposals = (status?: ProposalStatus) => getJson<{ proposals: Proposal[]; waiting: number }>(`/api/v1/proposals${status ? `?status=${status}` : ""}`);
export const getProposal = (id: string) => getJson<ProposalDetail>(`/api/v1/proposals/${id}`);
export const propose = (packId: string, note: string, files: ProposalInput[]): Promise<ApiResult<Proposal>> => sendJson<Proposal>(`/api/v1/packs/${packId}/proposals`, { note, files });
export const applyProposal = (id: string, reply: string, force = false) => sendJson<{ proposal: Proposal }>(`/api/v1/proposals/${id}/apply`, { reply, force });
export const declineProposal = (id: string, reply: string) => sendJson<Proposal>(`/api/v1/proposals/${id}/decline`, { reply });
export const withdrawProposal = (id: string) => sendJson<Proposal>(`/api/v1/proposals/${id}`, {}, "DELETE");

/** What a file in a proposal does, in words. */
export function fileChange(f: Pick<ProposalFile, "base" | "text">): "new" | "deleted" | "changed" {
  return f.base === null ? "new" : f.text === null ? "deleted" : "changed";
}

export const STATUS_WORDS: Record<ProposalStatus, string> = { waiting: "Waiting for review", applied: "Applied", declined: "Declined", withdrawn: "Withdrawn" };
