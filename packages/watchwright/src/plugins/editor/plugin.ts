import { createReadStream } from "node:fs";
import { ActionError, defineAction, type ActionCall } from "../../actions/registry.js";
import { allows, whoCalls } from "../../core/access.js";
import { definePlugin } from "../../core/plugin.js";
import { PACKS, type PackRegistry, type PackSummary } from "../packs/registry.js";
import { errorBody } from "../../server/errors.js";
import { createPackFile, deletePackFile, FileError, isCodeFile, listFiles, packImage, readPackFile, renamePackFile, resolveIn, savePackFile, stampOf } from "./files.js";
import { baseStamp, PROPOSALS_SQL, ProposalStore, type Proposal, type ProposalFile, type ProposalStatus } from "./proposals.js";

// The editor: reading and writing a pack's text files from the web app (or an agent). Every
// change rebuilds the pack, and the answer says whether it still loads; a run that uses the pack
// takes the change at its next attempt, as with any save.

const ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Pack id." } as const;
const PATH = { type: "string", minLength: 1, maxLength: 400, description: "The file, relative to the pack folder (`tests/home.yaml`)." } as const;

const STATUS: Record<FileError["code"], number> = { bad_path: 400, not_found: 404, not_text: 400, too_big: 413, exists: 409, stale: 409 };

/** What the pack looks like after a change: whether it loads, and its problems. */
type PackState = Pick<PackSummary, "status" | "error" | "problems">;

function packDir(registry: PackRegistry, id: string): string {
  const pack = registry.get(id);
  if (!pack) throw new ActionError("not_found", `No pack with id ${id}.`, 404);
  if (pack.missing) throw new ActionError("pack_missing", "The pack's folder is gone; locate it first.", 409);
  return pack.dir;
}

/** With login on, only an admin writes, makes, renames or deletes a pack's code: it runs on the server. */
export function checkCode(call: ActionCall, ...paths: string[]): void {
  if (allows("admin", call.user) || !paths.some(isCodeFile)) return;
  const file = paths.find(isCodeFile)!;
  throw new ActionError("code_admin_only", `Only admins change a pack's code (${file}): it runs on the server. Propose the change instead (propose_change, or Propose change in the editor) and an admin reviews it.`, 403, { path: file });
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof FileError) throw new ActionError(err.code, err.message, STATUS[err.code], err.detail);
    throw err;
  }
}

/** A file as it is on disk now, or null when it doesn't exist. */
function onDisk(dir: string, rel: string): { text: string; stamp: string } | null {
  try {
    const f = readPackFile(dir, rel);
    return { text: f.text, stamp: f.stamp };
  } catch (err) {
    if (err instanceof FileError && err.code === "not_found") return null;
    throw err;
  }
}

type FileInput = { path: string; text?: string; delete?: boolean; stamp?: string };

const PROPOSAL_ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Proposed change id." } as const;

const PROPOSAL_FILES = {
  type: "array",
  minItems: 1,
  maxItems: 20,
  description: "The files it changes.",
  items: {
    type: "object",
    properties: {
      path: PATH,
      text: { type: "string", description: "The whole new file." },
      delete: { type: "boolean", description: "Delete the file instead (leave out `text`)." },
      stamp: { type: "string", description: "The stamp the file was read with (empty: it didn't exist). When the file changed since, nothing is proposed. Leave out to propose against the file as it is now." },
    },
    required: ["path"],
  },
} as const;

/** Files as a proposal keeps them: each with the text it is based on (the file on disk now). */
function proposalFiles(dir: string, input: FileInput[]): ProposalFile[] {
  const seen = new Set<string>();
  const out: ProposalFile[] = [];
  for (const f of input) {
    const abs = resolveIn(dir, f.path);
    const rel = abs.slice(dir.length + 1).split(/[\\/]/).join("/");
    if (seen.has(rel)) throw new FileError("bad_path", `${rel} is in the proposal twice.`);
    seen.add(rel);
    const now = onDisk(dir, rel);
    if (f.stamp !== undefined && (now?.stamp ?? "") !== f.stamp) throw new FileError("stale", `${rel} changed on disk since you opened it.`, { path: rel, text: now?.text ?? null, stamp: now?.stamp ?? null });
    if (f.delete !== true && f.text === undefined) throw new FileError("bad_path", `Give ${rel} a \`text\`, or \`delete: true\`.`);
    const text = f.delete === true ? null : (f.text ?? null);
    if (text === null && now === null) throw new FileError("not_found", `${rel} doesn't exist, so there is nothing to delete.`);
    if (text !== null && Buffer.byteLength(text) > 1024 * 1024) throw new FileError("too_big", `${rel} is over 1 MB.`);
    if (text !== null && now !== null && text === now.text) continue;
    out.push({ path: rel, base: now?.text ?? null, text });
  }
  if (out.length === 0) throw new FileError("bad_path", "Nothing to propose: every file is the same as on disk.");
  return out;
}

export const editorPlugin = definePlugin({
  name: "editor",
  migrations: [{ id: 1, name: "proposals", sql: PROPOSALS_SQL }],
  pages: [{ name: "changes", title: "Proposed changes", path: "/changes", icon: "GitPullRequest", menu: "more", order: 45, words: "proposals review code diff apply", loginOnly: true }],
  actions: ({ services, events, store }) => {
    const proposals = new ProposalStore(store.db);
    const registry = services.get(PACKS);
    const rebuilt = async (id: string): Promise<PackState> => {
      await registry.reload(id).catch(() => undefined);
      const p = registry.get(id)!;
      return { status: p.status, error: p.error, problems: p.problems };
    };
    const changed = (packId: string, action: string, path: string, extra: Record<string, unknown> = {}) => events.append("editor.file_changed", { packId, action, path, ...extra });
    return [
      defineAction<{ id: string }>({
        name: "packs.files",
        agent: { tool: "list_pack_files" },
        title: "List a pack's text files (leaving out node_modules, .git and build output)",
        method: "GET",
        path: "/packs/:id/files",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => wrap(() => listFiles(packDir(registry, id))),
      }),
      defineAction<{ id: string; path: string }>({
        name: "packs.file",
        agent: { tool: "read_pack_file" },
        title: "Read one of a pack's text files, with the stamp to save it back",
        method: "GET",
        path: "/packs/:id/file",
        input: { type: "object", properties: { id: ID, path: PATH }, required: ["id", "path"] },
        handler: ({ id, path }) => wrap(() => readPackFile(packDir(registry, id), path)),
      }),
      defineAction<{ id: string; path: string; text: string; stamp?: string }>({
        name: "packs.file-save",
        agent: { tool: "write_pack_file", say: "Creates the file when it is missing. Leave out `stamp` to overwrite. The answer says whether the pack still loads and lists its problems; fix them before running. With login on, only an admin's token writes code files (.ts, .js, package.json); a user's gets code_admin_only, so write YAML tests instead." },
        title: "Save one of a pack's text files and rebuild the pack",
        method: "POST",
        path: "/packs/:id/file",
        input: {
          type: "object",
          properties: {
            id: ID,
            path: PATH,
            text: { type: "string", description: "The whole file." },
            stamp: { type: "string", description: "The stamp the file was read with. When the file changed since, nothing is saved and the error's detail has the file as it is now. Leave out to overwrite." },
          },
          required: ["id", "path", "text"],
        },
        handler: async ({ id, path, text, stamp }, call) => {
          checkCode(call, path);
          const file = wrap(() => savePackFile(packDir(registry, id), path, text, stamp ?? null));
          changed(id, "save", file.path, { stamp: file.stamp });
          return { file: { path: file.path, stamp: file.stamp }, pack: await rebuilt(id) };
        },
      }),
      defineAction<{ id: string; path: string; text?: string }>({
        name: "packs.file-create",
        title: "Make a new text file in a pack (folders are made when missing)",
        method: "POST",
        path: "/packs/:id/files",
        status: 201,
        input: { type: "object", properties: { id: ID, path: PATH, text: { type: "string", default: "", description: "What the file starts with." } }, required: ["id", "path"] },
        handler: async ({ id, path, text = "" }, call) => {
          checkCode(call, path);
          const file = wrap(() => createPackFile(packDir(registry, id), path, text));
          changed(id, "create", file.path, { stamp: file.stamp });
          return { file: { path: file.path, stamp: file.stamp }, pack: await rebuilt(id) };
        },
      }),
      defineAction<{ id: string; from: string; to: string }>({
        name: "packs.file-rename",
        title: "Rename or move a file within a pack",
        method: "POST",
        path: "/packs/:id/file/rename",
        input: { type: "object", properties: { id: ID, from: PATH, to: PATH }, required: ["id", "from", "to"] },
        handler: async ({ id, from, to }, call) => {
          checkCode(call, from, to);
          const r = wrap(() => renamePackFile(packDir(registry, id), from, to));
          changed(id, "rename", r.to, { from: r.from });
          return { ...r, pack: await rebuilt(id) };
        },
      }),
      defineAction<{ id: string; path: string }>({
        name: "packs.file-delete",
        agent: { tool: "delete_pack_file" },
        destructive: true,
        explain: ({ id, path }: { id: string; path: string }) => `Delete ${path} from the pack "${registry.get(id)?.name ?? id}"`,
        title: "Delete a file from a pack",
        method: "DELETE",
        path: "/packs/:id/file",
        input: { type: "object", properties: { id: ID, path: PATH }, required: ["id", "path"] },
        handler: async ({ id, path }, call) => {
          checkCode(call, path);
          const r = wrap(() => deletePackFile(packDir(registry, id), path));
          changed(id, "delete", r.deleted);
          return { ...r, pack: await rebuilt(id) };
        },
      }),
      ...proposalActions(),
    ];

    function packName(id: string): string {
      return registry.get(id)?.name ?? id;
    }
    function find(id: string): Proposal {
      const p = proposals.get(id);
      if (!p) throw new ActionError("not_found", `No proposed change with id ${id}.`, 404);
      return p;
    }
    function waiting(p: Proposal): void {
      if (p.status !== "waiting") throw new ActionError("not_waiting", `This change was already ${p.status}.`, 409);
    }
    function mine(p: Proposal, call: ActionCall): void {
      if (allows("admin", call.user) || (call.user && call.user.id === p.userId)) return;
      throw new ActionError("not_allowed", "Only the person who proposed it, or an admin, can change or withdraw it.", 403);
    }
    function summary(p: Proposal) {
      return { ...p, packName: packName(p.packId) };
    }
    function announce(type: string, p: Proposal, extra: Record<string, unknown> = {}) {
      events.append(type, { proposalId: p.id, packId: p.packId, packName: packName(p.packId), by: p.by, note: p.note, paths: p.paths, ...extra });
    }

    function proposalActions() {
      return [
        defineAction<{ pack?: string; status?: ProposalStatus }>({
          name: "proposals.list",
          title: "Proposed changes to packs' code, newest first, with who proposed them and what became of them",
          method: "GET",
          path: "/proposals",
          input: {
            type: "object",
            properties: {
              pack: { type: "string", pattern: "^[0-9a-f]{8}$", description: "Only this pack's." },
              status: { type: "string", enum: ["waiting", "applied", "declined", "withdrawn"] },
            },
          },
          handler: ({ pack, status }) => ({ proposals: proposals.list({ packId: pack, status }).map(summary), waiting: proposals.waiting() }),
        }),
        defineAction<{ id: string }>({
          name: "proposals.get",
          agent: { tool: "get_proposal", say: "What became of a change you proposed: waiting, applied or declined, with the admin's reply." },
          title: "One proposed change with its files: the text it was based on, the proposed text and the file as it is now",
          method: "GET",
          path: "/proposals/:id",
          input: { type: "object", properties: { id: PROPOSAL_ID }, required: ["id"] },
          handler: ({ id }) => {
            const p = find(id);
            const pack = registry.get(p.packId);
            const files = proposals.files(id).map((f) => {
              const now = pack && !pack.missing ? onDisk(pack.dir, f.path) : null;
              return { ...f, current: now?.text ?? null, changedSince: (now?.stamp ?? null) !== baseStamp(f) };
            });
            return { ...summary(p), files };
          },
        }),
        defineAction<{ id: string; note?: string; files: FileInput[] }>({
          name: "proposals.create",
          agent: {
            tool: "propose_change",
            say: "With login on, only admins change a pack's code (.ts, .js, package.json). Anyone else proposes the change here, with a note saying why; an admin reviews the diff and applies or declines it. Check on it with get_proposal.",
          },
          title: "Propose a change to a pack's files for an admin to review and apply",
          method: "POST",
          path: "/packs/:id/proposals",
          status: 201,
          input: { type: "object", properties: { id: ID, note: { type: "string", maxLength: 2000, description: "What it changes and why." }, files: PROPOSAL_FILES }, required: ["id", "files"] },
          handler: ({ id, note = "", files }, call) => {
            const dir = packDir(registry, id);
            const kept = wrap(() => proposalFiles(dir, files));
            const p = proposals.create({ packId: id, userId: call.user?.id ?? null, by: whoCalls(call.client, call.user), note: note.trim(), files: kept });
            announce("proposal.created", p);
            return summary(p);
          },
        }),
        defineAction<{ id: string; note?: string; files?: FileInput[] }>({
          name: "proposals.update",
          title: "Change a proposed change that still waits: its note, or its files (they replace the ones it had)",
          method: "POST",
          path: "/proposals/:id",
          input: { type: "object", properties: { id: PROPOSAL_ID, note: { type: "string", maxLength: 2000 }, files: PROPOSAL_FILES }, required: ["id"] },
          handler: ({ id, note, files }, call) => {
            const p = find(id);
            waiting(p);
            mine(p, call);
            const kept = files ? wrap(() => proposalFiles(packDir(registry, p.packId), files)) : undefined;
            const u = proposals.update(id, { note: note?.trim(), files: kept });
            announce("proposal.updated", u);
            return summary(u);
          },
        }),
        defineAction<{ id: string }>({
          name: "proposals.withdraw",
          title: "Withdraw a proposed change that still waits",
          method: "DELETE",
          path: "/proposals/:id",
          input: { type: "object", properties: { id: PROPOSAL_ID }, required: ["id"] },
          handler: ({ id }, call) => {
            const p = find(id);
            waiting(p);
            mine(p, call);
            const u = proposals.answer(id, "withdrawn", whoCalls(call.client, call.user), null);
            announce("proposal.withdrawn", u);
            return summary(u);
          },
        }),
        defineAction<{ id: string; force?: boolean; reply?: string }>({
          name: "proposals.apply",
          access: "admin",
          title: "Apply a proposed change: write its files and rebuild the pack",
          method: "POST",
          path: "/proposals/:id/apply",
          input: {
            type: "object",
            properties: {
              id: PROPOSAL_ID,
              force: { type: "boolean", default: false, description: "Write the files even where they changed on disk since the change was proposed." },
              reply: { type: "string", maxLength: 2000, description: "A word for the person who proposed it." },
            },
            required: ["id"],
          },
          handler: async ({ id, force = false, reply }, call) => {
            const p = find(id);
            waiting(p);
            const dir = packDir(registry, p.packId);
            const files = proposals.files(id);
            const moved = files.filter((f) => (onDisk(dir, f.path)?.stamp ?? null) !== baseStamp(f)).map((f) => f.path);
            if (moved.length && !force) throw new ActionError("stale", `${moved.join(", ")} changed on disk since the change was proposed.`, 409, { paths: moved });
            wrap(() => {
              for (const f of files) {
                if (f.text === null) {
                  if (onDisk(dir, f.path)) deletePackFile(dir, f.path);
                } else savePackFile(dir, f.path, f.text, null);
              }
            });
            for (const f of files) changed(p.packId, f.text === null ? "delete" : "save", f.path, f.text === null ? {} : { stamp: stampOf(f.text) });
            const u = proposals.answer(id, "applied", whoCalls(call.client, call.user), reply?.trim() || null);
            announce("proposal.applied", u, { answeredBy: u.answeredBy });
            return { proposal: summary(u), pack: await rebuilt(p.packId) };
          },
        }),
        defineAction<{ id: string; reply?: string }>({
          name: "proposals.decline",
          access: "admin",
          title: "Decline a proposed change, with a reply for the person who proposed it",
          method: "POST",
          path: "/proposals/:id/decline",
          input: { type: "object", properties: { id: PROPOSAL_ID, reply: { type: "string", maxLength: 2000 } }, required: ["id"] },
          handler: ({ id, reply }, call) => {
            const p = find(id);
            waiting(p);
            const u = proposals.answer(id, "declined", whoCalls(call.client, call.user), reply?.trim() || null);
            announce("proposal.declined", u, { answeredBy: u.answeredBy, reply: u.reply });
            return summary(u);
          },
        }),
      ];
    }
  },
  routes(app, { services }) {
    const registry = services.get(PACKS);
    // An image from the pack folder, for Markdown previews. The same path rules as the text files
    // apply. The headers keep an SVG opened on its own from running scripts on this origin.
    app.get("/packs/:id/image", { config: { access: "viewer" } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const rel = (req.query as { path?: unknown }).path;
      try {
        if (!/^[0-9a-f]{8}$/.test(id)) throw new ActionError("not_found", `No pack with id ${id}.`, 404);
        if (typeof rel !== "string") throw new FileError("bad_path", "Give the image's path inside the pack folder.");
        const img = wrap(() => packImage(packDir(registry, id), rel));
        return reply
          .type(img.type)
          .header("content-length", img.size)
          .header("cache-control", "no-cache")
          .header("x-content-type-options", "nosniff")
          .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
          .send(createReadStream(img.abs));
      } catch (err) {
        if (err instanceof ActionError) return reply.code(err.status).send(errorBody(err.code, err.message));
        if (err instanceof FileError) return reply.code(STATUS[err.code]).send(errorBody(err.code, err.message));
        throw err;
      }
    });
  },
});
