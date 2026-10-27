// Public entry of the `watchwright` package: the pack API for test packs, plus the server pieces
// and the plugin contract for embedding and for plugins.
export { pack, test, StepError } from "./plugins/packs/api.js";
export type {
  BrowserName,
  ClickOptions,
  Collector,
  CollectorRecord,
  FlagKind,
  Helpers,
  Outcome,
  PackDefinition,
  PackOptions,
  PackRunOptions,
  ParamDef,
  ParamValue,
  ParamValues,
  RunsSpec,
  SetupContext,
  ShotOptions,
  Target,
  TestBody,
  TestContext,
  TestMeta,
} from "./plugins/packs/api.js";
export type { RubricCriterion, TestReview } from "./plugins/packs/rubric.js";
export { consoleErrors, failedRequests, responses } from "./plugins/testing/collectors.js";
// Used by the pack loader's generated entry file; not part of the pack API.
export { __fileMarker } from "./plugins/packs/api.js";

export { VERSION } from "./version.js";
export { resolveDataDir, DEFAULT_PORT, DEFAULT_HOST } from "./config.js";
export { definePlugin, migrationsOf, type WatchwrightPlugin, type PluginContext } from "./core/plugin.js";
export { serviceKey, Services, type ServiceKey } from "./core/services.js";
export { defineAction, ActionError, type Action, type ActionCall, type JsonSchema, type ObjectSchema } from "./actions/registry.js";
export { BUILTIN_PLUGINS } from "./core/builtin.js";
export type { HealthData } from "./core/core-plugin.js";
export type { WwEvent } from "./events/log.js";
export { openStore, type Store } from "./store/db.js";
export type { Migration, MigrationSet } from "./store/migrations.js";
export { buildServer, type ServerOptions } from "./server/app.js";
