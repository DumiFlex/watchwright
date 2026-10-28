import { tmpdir } from "node:os";
import path from "node:path";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { FOLDERS, FolderError, isInside } from "../folders/folders.js";
import { PACK_FILES, PackLoadError } from "./loader.js";
import { discoverPacks, PACKS, PACKS_MIGRATION_SQL, PackRegistry } from "./registry.js";
import { convertToCode } from "./convert.js";
import { StarterError, writeStarter } from "./starter.js";
import { packSchema, testFileSchema } from "./yaml/schema.js";
import { PACK_SHAPE } from "./yaml/pack-shape.js";
import { checkDocument, parseTestFile } from "./yaml/parse.js";

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
  migrations: [{ id: 1, name: "init", sql: PACKS_MIGRATION_SQL }],
  setup({ store, events, services }) {
    const cache = store.dataDir === ":memory:" ? path.join(tmpdir(), `watchwright-cache-${process.pid}`) : path.join(store.dataDir, "cache", "packs");
    const registry = new PackRegistry(store.db, events, cache);
    services.provide(PACKS, registry);
    const folders = services.get(FOLDERS);
    folders.addMarker({ kind: "pack", files: PACK_FILES });
    folders.allowOpen((dir) => registry.list().some((p) => isInside(dir, p.dir)));
    // Bring stored packs up to date in the background: their files may have changed while the server was down.
    for (const p of registry.list()) void registry.reload(p.id).catch(() => undefined);
  },
  actions: ({ services }) => {
    const registry = services.get(PACKS);
    const folders = services.get(FOLDERS);
    return [
      defineAction({
        name: "packs.list",
        agent: { tool: "list_packs" },
        title: "List the packs added to this server",
        method: "GET",
        path: "/packs",
        handler: () => registry.list(),
      }),
      defineAction<{ path: string }>({
        name: "packs.add",
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
        agent: { tool: "get_pack", say: "Read this before writing or running tests: the tests' ids, sections, needs and parameters." },
        title: "One pack with its tests, parameters, flag kinds and load errors",
        method: "GET",
        path: "/packs/:id",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => registry.get(id) ?? notFound(id),
      }),
      defineAction<{ id: string }>({
        name: "packs.reload",
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
        agent: { tool: "test_format", say: "The full YAML test format, when the skill's step list isn't enough." },
        title: "The JSON Schema of YAML test files or of pack.yaml",
        method: "GET",
        path: "/packs/yaml-schema",
        input: { type: "object", properties: { kind: { type: "string", enum: ["test", "pack"], default: "test", description: "test (a YAML test file) or pack (pack.yaml)." } } },
        handler: ({ kind = "test" }) => (kind === "pack" ? packSchema() : testFileSchema()),
      }),
      defineAction<{ text: string; kind?: "test" | "pack" }>({
        name: "packs.check-yaml",
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
        destructive: true,
        explain: ({ id }: { id: string }) => `Remove the pack "${registry.get(id)?.name ?? id}" from Watchwright (its files and past runs stay)`,
        title: "Remove a pack from this server (its files and past runs stay)",
        method: "DELETE",
        path: "/packs/:id",
        input: { type: "object", properties: { id: ID }, required: ["id"] },
        handler: ({ id }) => {
          if (!registry.remove(id)) notFound(id);
          return { removed: id };
        },
      }),
    ];
  },
});
