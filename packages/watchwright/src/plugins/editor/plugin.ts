import { createReadStream } from "node:fs";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { PACKS, type PackRegistry, type PackSummary } from "../packs/registry.js";
import { errorBody } from "../../server/errors.js";
import { createPackFile, deletePackFile, FileError, listFiles, packImage, readPackFile, renamePackFile, savePackFile } from "./files.js";

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

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof FileError) throw new ActionError(err.code, err.message, STATUS[err.code], err.detail);
    throw err;
  }
}

export const editorPlugin = definePlugin({
  name: "editor",
  actions: ({ services, events }) => {
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
        agent: { tool: "write_pack_file", say: "Creates the file when it is missing. Leave out `stamp` to overwrite. The answer says whether the pack still loads and lists its problems; fix them before running." },
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
        handler: async ({ id, path, text, stamp }) => {
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
        handler: async ({ id, path, text = "" }) => {
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
        handler: async ({ id, from, to }) => {
          const r = wrap(() => renamePackFile(packDir(registry, id), from, to));
          changed(id, "rename", r.to, { from: r.from });
          return { ...r, pack: await rebuilt(id) };
        },
      }),
      defineAction<{ id: string; path: string }>({
        name: "packs.file-delete",
        destructive: true,
        title: "Delete a file from a pack",
        method: "DELETE",
        path: "/packs/:id/file",
        input: { type: "object", properties: { id: ID, path: PATH }, required: ["id", "path"] },
        handler: async ({ id, path }) => {
          const r = wrap(() => deletePackFile(packDir(registry, id), path));
          changed(id, "delete", r.deleted);
          return { ...r, pack: await rebuilt(id) };
        },
      }),
    ];
  },
  routes(app, { services }) {
    const registry = services.get(PACKS);
    // An image from the pack folder, for Markdown previews. The same path rules as the text files
    // apply. The headers keep an SVG opened on its own from running scripts on this origin.
    app.get("/packs/:id/image", async (req, reply) => {
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
