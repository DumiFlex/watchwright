import { tmpdir } from "node:os";
import path from "node:path";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { PackLoadError } from "./loader.js";
import { PACKS, PACKS_MIGRATION_SQL, PackRegistry } from "./registry.js";

const ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Pack id." } as const;

function notFound(id: string): never {
  throw new ActionError("not_found", `No pack with id ${id}.`, 404);
}

/** Test packs: adding them by path, building them, listing their tests. */
export const packsPlugin = definePlugin({
  name: "packs",
  migrations: [{ id: 1, name: "init", sql: PACKS_MIGRATION_SQL }],
  setup({ store, events, services }) {
    const cache = store.dataDir === ":memory:" ? path.join(tmpdir(), `watchwright-cache-${process.pid}`) : path.join(store.dataDir, "cache", "packs");
    const registry = new PackRegistry(store.db, events, cache);
    services.provide(PACKS, registry);
    // Bring stored packs up to date in the background: their files may have changed while the server was down.
    for (const p of registry.list()) void registry.reload(p.id).catch(() => undefined);
  },
  actions: ({ services }) => {
    const registry = services.get(PACKS);
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
          properties: { path: { type: "string", minLength: 1, description: "Absolute path of the pack folder or its pack file." } },
          required: ["path"],
        },
        handler: async ({ path: p }) => {
          if (!path.isAbsolute(p)) throw new ActionError("bad_path", "Give the pack's absolute path.");
          try {
            return await registry.add(p);
          } catch (err) {
            if (err instanceof PackLoadError) throw new ActionError("bad_pack", err.message, 400, err.problems);
            throw err;
          }
        },
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
