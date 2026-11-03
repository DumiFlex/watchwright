import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyReply } from "fastify";
import { ActionError, defineAction } from "../../actions/registry.js";
import { errorBody } from "../../server/errors.js";
import { ArchiveError, packZip, unpackPack, UPLOAD_MAX_BYTES } from "./archive.js";
import { definePlugin } from "../../core/plugin.js";
import { FOLDERS, FolderError, isInside } from "../folders/folders.js";
import { PACK_FILES, PackLoadError } from "./loader.js";
import { discoverPacks, PACKS, PACKS_MIGRATION_SQL, PackRegistry } from "./registry.js";
import { PACK_ACCESS, PACK_ACCESS_SQL, PackAccessStore } from "./access.js";
import { PACK_GUARD } from "../../core/keys.js";
import { convertToCode } from "./convert.js";
import { StarterError, writeStarter } from "./starter.js";
import { packSchema, testFileSchema } from "./yaml/schema.js";
import { PACK_SHAPE } from "./yaml/pack-shape.js";
import { checkDocument, parseTestFile } from "./yaml/parse.js";

const ARCHIVE_STATUS: Record<ArchiveError["code"], number> = { bad_zip: 400, no_pack_file: 400, too_big: 413, exists: 409, bad_name: 400 };

const ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Pack id." } as const;

function notFound(id: string): never {
  throw new ActionError("not_found", `No pack with id ${id}.`, 404);
}

/** Runs a pack operation, turning load and path errors into action errors. */
async function packCall<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PackLoadError) throw new ActionError("bad_pack", err.message, 400, err.problems);
    if (err instanceof StarterError) throw new ActionError("bad_starter", err.message);
    if (err instanceof FolderError) throw new ActionError(err.code, err.message, err.code === "not_found" ? 404 : 400);
    throw err;
  }
}

/** Test packs: adding them by path, building them, listing their tests. */
export const packsPlugin = definePlugin({
  name: "packs",
  pages: [{ name: "packs", title: "Packs", path: "/packs", icon: "FolderOpen", menu: "main", order: 20, words: "tests suites" }],
  migrations: [
    { id: 1, name: "init", sql: PACKS_MIGRATION_SQL },
    { id: 2, name: "access", sql: PACK_ACCESS_SQL },
  ],
  setup({ store, events, services }) {
    const cache = store.dataDir === ":memory:" ? path.join(tmpdir(), `watchwright-cache-${process.pid}`) : path.join(store.dataDir, "cache", "packs");
    const registry = new PackRegistry(store.db, events, cache);
    services.provide(PACKS, registry);
    const access = new PackAccessStore(store.db);
    services.provide(PACK_ACCESS, access);
    services.provide(PACK_GUARD, access);
    const folders = services.get(FOLDERS);
    folders.addMarker({ kind: "pack", files: PACK_FILES });
    folders.allowOpen((dir) => registry.list().some((p) => isInside(dir, p.dir)));
    // Bring stored packs up to date in the background: their files may have changed while the server was down.
    for (const p of registry.list()) void registry.reload(p.id).catch(() => undefined);
  },
  actions: ({ services, events }) => {
    const registry = services.get(PACKS);
    const folders = services.get(FOLDERS);
    const access = services.get(PACK_ACCESS);
    return [
      defineAction({
        name: "packs.list",
        agent: { tool: "list_packs" },
        title: "List the packs added to this server",
        method: "GET",
        path: "/packs",
        pack: "list",
        handler: (_input, { sees }) => registry.list().filter((p) => sees?.(p.id) ?? true),
      }),
      defineAction<{ path: string }>({
        name: "packs.add",
        pack: "none",
        access: "admin",
        agent: { tool: "add_pack" },
        title: "Add a pack by its folder or pack file path, and load it",
        method: "POST",
        path: "/packs",
        status: 201,
        input: {
          type: "object",
          properties: { path: { type: "string", minLength: 1, description: "Absolute path of the pack folder or its pack file. Quotes, `file://` and `~` are accepted." } },
          required: ["path"],
        },
        handler: ({ path: p }) =>
          packCall(async () => {
            const pack = await registry.add(folders.clean(p));
            folders.remember(pack.dir);
            return pack;
          }),
      }),
      defineAction<{ path: string; name: string; baseURL: string; format?: "code" | "yaml" }>({
        name: "packs.create",
        pack: "none",
        access: "admin",
        agent: { tool: "create_pack", say: "Use when the person wants tests for a site that has no pack yet. Prefer format yaml." },
        title: "Write a starter pack (pack file, a first test, a README) into a folder and add it",
        method: "POST",
        path: "/packs/create",
        status: 201,
        input: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1, description: "The folder for the new pack; made when missing. It must not have a pack file yet." },
            name: { type: "string", minLength: 1, maxLength: 80, description: "The pack's name." },
            baseURL: { type: "string", minLength: 1, description: "The address of the site it tests, such as http://127.0.0.1:3000/." },
            format: { type: "string", enum: ["code", "yaml"], default: "code", description: "code: pack.ts and a TypeScript test; yaml: pack.yaml and a YAML test." },
          },
          required: ["path", "name", "baseURL"],
        },
        handler: ({ path: p, name, baseURL, format = "code" }) =>
          packCall(async () => {
            const dir = folders.clean(p);
            writeStarter(dir, { name: name.trim(), baseURL: baseURL.trim(), format });
            const pack = await registry.add(dir);
            folders.remember(pack.dir);
            return pack;
          }),
      }),
      defineAction<{ path: string; depth?: number }>({
        name: "packs.discover",
        pack: "list",
        access: "admin",
        title: "Find pack files in a folder and the folders below it",
        method: "POST",
        path: "/packs/discover",
        input: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1, description: "Absolute path of the folder to search." },
            depth: { type: "integer", minimum: 0, maximum: 8, default: 4, description: "How many folder levels to search below it." },
          },
          required: ["path"],
        },
        handler: ({ path: p, depth = 4 }) =>
          packCall(() => {
            const root = folders.list(p).path; // checks it is a readable folder
            return { root, ...discoverPacks(root, depth, (dir) => registry.byDir(dir)?.id ?? null) };
          }),
      }),
      defineAction<{ id: string }>({
        name: "packs.get",
        pack: { pack: "id" },
        agent: { tool: "get_pack", say: "Read this before writing or running tests: the tests' ids, sections, needs and parameters." },
        title: "One pack with its tests, parameters, flag kinds and load errors",
        method: "GET",
        path: "/packs/:id",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => registry.get(id) ?? notFound(id),
      }),
      defineAction<{ id: string }>({
        name: "packs.reload",
        pack: { pack: "id" },
        title: "Rebuild a pack now",
        method: "POST",
        path: "/packs/:id/reload",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: async ({ id }) => {
          if (!registry.get(id)) notFound(id);
          await registry.reload(id).catch(() => undefined);
          return registry.get(id);
        },
      }),
      defineAction<{ id: string; path: string }>({
        name: "packs.move",
        pack: { pack: "id" },
        access: "admin",
        title: "Point a pack at its new folder, keeping its id and runs",
        method: "POST",
        path: "/packs/:id/move",
        input: { type: "object", properties: { id: ID, path: { type: "string", minLength: 1, description: "The pack's new folder or pack file." } }, required: ["id", "path"] },
        handler: ({ id, path: p }) => {
          if (!registry.get(id)) notFound(id);
          return packCall(async () => {
            const pack = await registry.move(id, folders.clean(p));
            folders.remember(pack.dir);
            return pack;
          });
        },
      }),
      defineAction<{ kind?: "test" | "pack" }>({
        name: "packs.yaml-schema",
        pack: "none",
        agent: { tool: "test_format", say: "The full YAML test format, when the skill's step list isn't enough." },
        title: "The JSON Schema of YAML test files or of pack.yaml",
        method: "GET",
        path: "/packs/yaml-schema",
        input: { type: "object", properties: { kind: { type: "string", enum: ["test", "pack"], default: "test", description: "test (a YAML test file) or pack (pack.yaml)." } } },
        handler: ({ kind = "test" }) => (kind === "pack" ? packSchema() : testFileSchema()),
      }),
      defineAction<{ text: string; kind?: "test" | "pack" }>({
        name: "packs.check-yaml",
        pack: "none",
        agent: { tool: "check_test", say: "Check a YAML test before writing it to the pack." },
        title: "Check the text of a YAML test file or of pack.yaml, without saving it",
        method: "POST",
        path: "/packs/check-yaml",
        input: {
          type: "object",
          properties: {
            text: { type: "string", maxLength: 1048576, description: "The file's text." },
            kind: { type: "string", enum: ["test", "pack"], default: "test", description: "test (a YAML test file) or pack (pack.yaml)." },
          },
          required: ["text"],
        },
        handler: ({ text, kind = "test" }) => {
          if (kind === "pack") return { problems: checkDocument(text, PACK_SHAPE, "pack").problems };
          const parsed = parseTestFile(text);
          return { problems: parsed.problems, tests: parsed.value.map((t) => ({ id: t.id, line: t.line, steps: t.steps.length })) };
        },
      }),
      defineAction<{ id: string; file: string }>({
        name: "packs.convert-test",
        pack: { pack: "id" },
        access: "admin",
        title: "Turn a YAML test file into a TypeScript test file that does the same",
        method: "POST",
        path: "/packs/:id/convert",
        input: { type: "object", properties: { id: ID, file: { type: "string", minLength: 1, description: "The YAML file, relative to the pack folder." } }, required: ["id", "file"] },
        handler: ({ id, file }) => {
          const pack = registry.get(id) ?? notFound(id);
          return packCall(async () => {
            try {
              const written = await convertToCode(pack.dir, file, async () => {
                await registry.reload(id);
              });
              return { file: written, pack: registry.get(id) };
            } catch (err) {
              await registry.reload(id).catch(() => undefined); // back to the YAML file's build
              throw err;
            }
          });
        },
      }),
      defineAction<{ id: string }>({
        name: "packs.remove",
        pack: { pack: "id" },
        destructive: true,
        explain: ({ id }: { id: string }) => `Remove the pack "${registry.get(id)?.name ?? id}" from Watchwright (its files and past runs stay)`,
        title: "Remove a pack from this server (its files and past runs stay)",
        method: "DELETE",
        path: "/packs/:id",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => {
          if (!registry.remove(id)) notFound(id);
          access.forget(id);
          return { removed: id };
        },
      }),
      defineAction({
        name: "packs.access-all",
        pack: "list",
        access: "admin",
        title: "Every pack kept to chosen people and groups, by pack id (packs not listed are open to everyone)",
        method: "GET",
        path: "/packs/access",
        handler: () => access.all(),
      }),
      defineAction<{ id: string }>({
        name: "packs.access",
        pack: { pack: "id" },
        access: "admin",
        title: "Who may see a pack: everyone signed in, or only chosen people and groups (and the admins)",
        method: "GET",
        path: "/packs/:id/access",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => {
          if (!registry.get(id)) notFound(id);
          return access.get(id);
        },
      }),
      defineAction<{ id: string; mode: "everyone" | "chosen"; people?: string[]; groups?: string[] }>({
        name: "packs.set-access",
        pack: { pack: "id" },
        access: "admin",
        title: "Open a pack to everyone signed in, or keep it to chosen people and groups (admins always see it)",
        method: "POST",
        path: "/packs/:id/access",
        input: {
          type: "object",
          properties: {
            id: ID,
            mode: { type: "string", enum: ["everyone", "chosen"] },
            people: { type: "array", items: { type: "string", minLength: 1, maxLength: 64 }, maxItems: 500, description: "User ids." },
            groups: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, maxItems: 100, description: "Group names, as the sign-in provider or Admin › Users names them." },
          },
          required: ["id", "mode"],
        },
        handler: ({ id, mode, people = [], groups = [] }, call) => {
          const pack = registry.get(id) ?? notFound(id);
          const by = call.user?.name ?? call.client;
          const out = access.set(id, mode === "everyone" ? null : { people, groups }, by);
          events.append("pack.access_changed", { packId: id, packName: pack.name, mode, by });
          return out;
        },
      }),
    ];
  },
  routes(app, { services }) {
    // A pack as a .zip, in and out: how packs reach a server that has no desktop to copy them
    // onto (docs/plans/self-hosting.md). Plain routes, since their bodies are files, not JSON.
    const registry = services.get(PACKS);
    const folders = services.get(FOLDERS);
    const access = services.get(PACK_ACCESS);
    const fail = (reply: FastifyReply, err: unknown) => {
      if (err instanceof ArchiveError) return reply.code(ARCHIVE_STATUS[err.code]).send(errorBody(err.code, err.message));
      if (err instanceof ActionError) return reply.code(err.status).send(errorBody(err.code, err.message));
      if (err instanceof FolderError) return reply.code(err.code === "not_found" ? 404 : err.code === "not_allowed" || err.code === "unreadable" ? 403 : 400).send(errorBody(err.code, err.message));
      throw err;
    };

    app.get<{ Params: { id: string } }>("/packs/:id/download", { config: { access: "viewer", pack: "checked" } }, async (req, reply) => {
      const pack = /^[0-9a-f]{8}$/.test(req.params.id) && access.sees(req.watchwrightUser, req.params.id) ? registry.get(req.params.id) : null;
      if (!pack) return reply.code(404).send(errorBody("not_found", `No pack with id ${req.params.id}.`));
      if (pack.missing) return reply.code(404).send(errorBody("not_found", "The pack's folder is gone."));
      try {
        const body = packZip(pack.dir);
        const file = `${path.basename(pack.dir)}.zip`;
        return reply
          .type("application/zip")
          .header("content-disposition", `attachment; filename="${file.replace(/[^\w.-]+/g, "-")}"; filename*=UTF-8''${encodeURIComponent(file)}`)
          .send(body);
      } catch (err) {
        return fail(reply, err);
      }
    });

    // Pack code runs on the server, so only admins may bring in a pack from a file.
    app.addContentTypeParser(["application/zip", "application/x-zip-compressed", "application/octet-stream"], { parseAs: "buffer", bodyLimit: UPLOAD_MAX_BYTES }, (_req, body, done) => done(null, body));
    app.post<{ Querystring: { name?: string; folder?: string } }>("/packs/upload", { config: { access: "admin", pack: "none" }, bodyLimit: UPLOAD_MAX_BYTES }, async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) return reply.code(415).send(errorBody("bad_zip", "Send the zip file as the body, with content type application/zip."));
      try {
        const parent = folders.list(req.query.folder?.trim() || folders.start).path; // a readable folder this server may show
        const dir = unpackPack(req.body, parent, req.query.name ?? "pack");
        const pack = await registry.add(dir);
        folders.remember(pack.dir);
        return reply.code(201).send({ data: pack });
      } catch (err) {
        return fail(reply, err);
      }
    });
  },
});
