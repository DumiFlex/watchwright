import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ActionError, defineAction, type ObjectSchema } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { contentTypeOf } from "../../jobs/recorder.js";
import { errorBody } from "../../server/errors.js";
import { FRAMES } from "../live/hub.js";
import { PACKS } from "../packs/registry.js";
import { testKind } from "../testing/kind.js";
import { Engine, EngineError } from "./engine.js";
import { RUNS_MIGRATION_SQL, RunsRepo } from "./repo.js";

export const ENGINE = serviceKey<Engine>("runs.engine");
/** The folder that holds `runs/` (the data folder, or a temp folder for an in-memory store). */
export const FILES_ROOT = serviceKey<string>("runs.files-root");

const RUN_ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Run id." } as const;
const byId: ObjectSchema = { type: "object", properties: { id: RUN_ID }, required: ["id"] };

/** Turns engine errors into the API's error envelope. */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EngineError) throw new ActionError(err.code, err.message, err.status);
    throw err;
  }
}

function filesRoot(dataDir: string): string {
  return dataDir === ":memory:" ? mkdtempSync(path.join(tmpdir(), "watchwright-files-")) : dataDir;
}

/** Runs: starting, controlling and reading them, and the files they save. */
export const runsPlugin = definePlugin({
  name: "runs",
  migrations: [{ id: 1, name: "init", sql: RUNS_MIGRATION_SQL }],
  setup({ store, events, services }) {
    const dataDir = filesRoot(store.dataDir);
    services.provide(FILES_ROOT, dataDir);
    const engine = new Engine({
      repo: new RunsRepo(store.db),
      events,
      packs: services.get(PACKS),
      frames: services.get(FRAMES),
      dataDir,
      kinds: [testKind],
    });
    engine.recover();
    services.provide(ENGINE, engine);
    engine.schedule();
  },
  async close({ services }) {
    await services.get(ENGINE).close();
  },
  actions: ({ services }) => {
    const engine = services.get(ENGINE);
    const notFound = (id: string): never => {
      throw new ActionError("not_found", `No run with id ${id}.`, 404);
    };
    const control = (name: string, verb: string, title: string, fn: (id: string) => unknown) =>
      defineAction<{ id: string }>({ name, title, method: "POST", path: `/runs/:id/${verb}`, input: byId, handler: ({ id }) => guard(() => fn(id)) });
    return [
      defineAction<{ limit?: number }>({
        name: "runs.list",
        title: "List runs, newest first",
        method: "GET",
        path: "/runs",
        input: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 500, default: 100 } } },
        handler: ({ limit }) => engine.list(limit),
      }),
      defineAction<{ packId: string; tests?: string[]; params?: Record<string, unknown>; pauseOnBroken?: boolean; pauseLimitMinutes?: number }>({
        name: "runs.start",
        title: "Start a run: a pack, the tests to run (default all) and parameter values",
        method: "POST",
        path: "/runs",
        status: 201,
        input: {
          type: "object",
          properties: {
            packId: { type: "string", pattern: "^[0-9a-f]{8}$" },
            tests: { type: "array", items: { type: "string" }, description: "Test ids; what they need and their parents/children join by themselves." },
            params: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
            pauseOnBroken: { type: "boolean", description: "Pause on a broken attempt and wait for retry or skip (default: the pack's setting, else true)." },
            pauseLimitMinutes: { type: "number", minimum: 0.05, maximum: 1440 },
          },
          required: ["packId"],
        },
        handler: (input, { client }) => {
          const options: Record<string, unknown> = {};
          if (input.pauseOnBroken !== undefined) options.pauseOnBroken = input.pauseOnBroken;
          if (input.pauseLimitMinutes !== undefined) options.pauseLimitMinutes = input.pauseLimitMinutes;
          return guard(() => engine.start({ packId: input.packId, tests: input.tests, params: input.params, startedBy: client, options }));
        },
      }),
      defineAction<{ id: string; history?: boolean }>({
        name: "runs.get",
        title: "One run with its plan, attempts and live state",
        method: "GET",
        path: "/runs/:id",
        input: { type: "object", properties: { id: RUN_ID, history: { type: "boolean", description: "Also list earlier tries of retried attempts." } }, required: ["id"] },
        handler: ({ id, history }) => {
          const run = engine.get(id) ?? notFound(id);
          return history ? { ...run, history: engine.history(id) } : run;
        },
      }),
      defineAction<{ id: string; attemptId: string }>({
        name: "runs.attempt",
        title: "One attempt's result document (schemaVersion 1)",
        method: "GET",
        path: "/runs/:id/attempts/:attemptId",
        input: { type: "object", properties: { id: RUN_ID, attemptId: { type: "string", pattern: "^[0-9a-f]{12}$" } }, required: ["id", "attemptId"] },
        handler: ({ id, attemptId }) => engine.result(id, attemptId) ?? notFound(`${id}/${attemptId}`),
      }),
      control("runs.pause", "pause", "Pause at the next step", (id) => engine.pause(id)),
      control("runs.resume", "resume", "Resume a paused run, or continue an interrupted or stopped run where it was", (id) => engine.resume(id)),
      control("runs.retry", "retry", "Run the broken attempt the run paused on again", (id) => engine.retry(id)),
      control("runs.skip", "skip", "Keep the broken attempt's result and go on", (id) => engine.skip(id)),
      control("runs.redo-broken", "redo-broken", "Run only the broken attempts of a finished run again (with what they need)", (id) => engine.redoBroken(id)),
      defineAction<{ id: string; when?: "after" | "now" }>({
        name: "runs.stop",
        title: "Stop after the current test, or now",
        method: "POST",
        path: "/runs/:id/stop",
        input: { type: "object", properties: { id: RUN_ID, when: { type: "string", enum: ["after", "now"], default: "after" } }, required: ["id"] },
        handler: ({ id, when }) => guard(() => engine.stop(id, when ?? "after")),
      }),
    ];
  },
  routes(app, { services }) {
    const dataDir = services.get(FILES_ROOT);
    const root = path.resolve(dataDir, "runs");
    // Artifact files, from the data folder's runs/ only.
    app.get("/files/*", async (req, reply) => {
      // Fastify has already decoded the path once; decoding again would turn "%25" into "%".
      const rel = (req.params as { "*": string })["*"] ?? "";
      if (!rel.startsWith("runs/")) return reply.code(404).send(errorBody("not_found", "No such file."));
      const abs = path.resolve(dataDir, ...rel.split("/"));
      if (!abs.startsWith(root + path.sep) || !existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send(errorBody("not_found", "No such file."));
      return reply.type(contentTypeOf(abs)).header("cache-control", "no-cache").send(createReadStream(abs));
    });
  },
});
