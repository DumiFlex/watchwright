import type { FastifyInstance } from "fastify";
import type { Access } from "./access.js";

/**
 * Registers routes that can't carry a `config.access` themselves (a static-files plugin) in a
 * scope where every route gets this access level.
 */
export async function withAccess(app: FastifyInstance, access: Access, register: (scope: FastifyInstance) => PromiseLike<unknown>, pack?: "none"): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook("onRoute", (route) => {
      route.config = { ...(route.config ?? {}), access: route.config?.access ?? access, ...(pack ? { pack: route.config?.pack ?? pack } : {}) };
    });
    await register(scope);
  });
}
