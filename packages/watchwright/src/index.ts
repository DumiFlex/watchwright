// Public entry of the `watchwright` package. The pack API (`pack`, `test`) lands with the engine
// (docs/plan.md, section 11); for now it exposes the server pieces and the plugin contract.
export { VERSION } from "./version.js";
export { resolveDataDir, DEFAULT_PORT, DEFAULT_HOST } from "./config.js";
export { definePlugin, migrationsOf, type WatchwrightPlugin, type PluginContext } from "./core/plugin.js";
export { BUILTIN_PLUGINS, type HealthData } from "./core/core-plugin.js";
export { openStore, type Store } from "./store/db.js";
export type { Migration, MigrationSet } from "./store/migrations.js";
export { buildServer, type ServerOptions } from "./server/app.js";
