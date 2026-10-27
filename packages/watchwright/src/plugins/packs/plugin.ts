import { tmpdir } from "node:os";
import path from "node:path";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { FOLDERS, FolderError, isInside } from "../folders/folders.js";
import { PACK_FILES, PackLoadError } from "./loader.js";
import { discoverPacks, PACKS, PACKS_MIGRATION_SQL, PackRegistry } from "./registry.js";
import { StarterError, writeStarter } from "./starter.js";

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
        title: "List the packs added to this server",
        method: "GET",
        path: "/packs",
        handler: () => registry.list(),
      }),
      defineAction<{ path: string }>({
        name: "packs.add",
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
      defineAction<{ path: string; name: string; baseURL: string }>({
        name: "packs.create",
        title: "Write a starter pack (pack.ts, a first test, a README) into a folder and add it",
        method: "POST",
        path: "/packs/create",
        status: 201,
        input: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1, description: "The folder for the new pack; made when missing. It must not have a pack file yet." },
            name: { type: "string", minLength: 1, maxLength: 80, description: "The pack's name." },
            baseURL: { type: "string", minLength: 1, description: "The address of the site it tests, such as http://127.0.0.1:3000/." },
          },
          required: ["path", "name", "baseURL"],
        },
        handler: ({ path: p, name, baseURL }) =>
          packCall(async () => {
            const dir = folders.clean(p);
            writeStarter(dir, { name: name.trim(), baseURL: baseURL.trim() });
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
      defineAction<{ id: string }>({
        name: "packs.remove",
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
