import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { ActionError, defineAction, type ObjectSchema } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { contentTypeOf } from "../../jobs/recorder.js";
import { errorBody } from "../../server/errors.js";
import { FRAMES } from "../live/hub.js";
import { PACKS } from "../packs/registry.js";
import { testKind } from "../testing/kind.js";
import { Engine, EngineError } from "./engine.js";
import { RUNS_ARTIFACT_SET_SQL, RUNS_INFO_SQL, RUNS_MIGRATION_SQL, RunsRepo, type RunOptions, type RunStatus } from "./repo.js";

export const ENGINE = serviceKey<Engine>("runs.engine");
/** The folder that holds `runs/` (the data folder, or a temp folder for an in-memory store). */
export const FILES_ROOT = serviceKey<string>("runs.files-root");

/** Playwright's trace viewer, a static app inside playwright-core (which playwright depends on). */
function traceViewerDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const core = path.dirname(require.resolve("playwright-core/package.json", { paths: [path.dirname(require.resolve("playwright"))] }));
    const dir = path.join(core, "lib", "vite", "traceViewer");
    return existsSync(path.join(dir, "index.html")) ? dir : null;
  } catch {
    return null;
  }
}

/** Parses a single-range `Range` header against a file size: [start, end] inclusive, "bad" when it can't be met, null when absent. */
export function byteRange(header: string | undefined, size: number): [number, number] | "bad" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "bad";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // "bytes=-N": the last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? "bad" : [start, end];
}

const RUN_ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Run id." } as const;
const byId: ObjectSchema = { type: "object", properties: { id: RUN_ID }, required: ["id"] };

interface StartBody {
  packId: string;
  tests?: string[];
  params?: Record<string, unknown>;
  pauseOnBroken?: boolean;
  pauseLimitMinutes?: number;
  attempts?: number;
  trace?: "problems" | "always" | "never";
  video?: boolean;
}

const START_INPUT: ObjectSchema = {
  type: "object",
  properties: {
    packId: { type: "string", pattern: "^[0-9a-f]{8}$" },
    tests: { type: "array", items: { type: "string" }, description: "Test ids; what they need and their parents/children join by themselves." },
    params: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
    pauseOnBroken: { type: "boolean", description: "Pause on a broken attempt and wait for retry or skip (default: the pack's setting, else true)." },
    pauseLimitMinutes: { type: "number", minimum: 0.05, maximum: 1440 },
    attempts: { type: "integer", minimum: 1, maximum: 100, description: "Attempts for every test, instead of each test's own count." },
    trace: { type: "string", enum: ["problems", "always", "never"], description: "Which attempts keep a Playwright trace (default: the pack's setting, else problems)." },
    video: { type: "boolean", description: "Record a video per attempt (default: the pack's setting, else true)." },
  },
  required: ["packId"],
};

/** The run options a start request sets; unset ones fall back to the pack. */
function runOptions(input: StartBody): RunOptions {
  const o: RunOptions = {};
  if (input.pauseOnBroken !== undefined) o.pauseOnBroken = input.pauseOnBroken;
  if (input.pauseLimitMinutes !== undefined) o.pauseLimitMinutes = input.pauseLimitMinutes;
  if (input.attempts !== undefined) o.attempts = input.attempts;
  if (input.trace !== undefined) o.trace = input.trace;
  if (input.video !== undefined) o.video = input.video;
  return o;
}

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
  migrations: [
    { id: 1, name: "init", sql: RUNS_MIGRATION_SQL },
    { id: 2, name: "artifact-set", sql: RUNS_ARTIFACT_SET_SQL },
    { id: 3, name: "run-info", sql: RUNS_INFO_SQL },
  ],
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
      defineAction<{ limit?: number; pack?: string; status?: string; before?: string }>({
        name: "runs.list",
        title: "List runs, newest first",
        method: "GET",
        path: "/runs",
        input: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            pack: { type: "string", pattern: "^[0-9a-f]{8}$", description: "Only runs of this pack." },
            status: { type: "string", pattern: "^[a-z_]+(,[a-z_]+)*$", description: "Only runs in these statuses, comma separated." },
            before: { type: "string", description: "Cursor: the createdAt of the last run of the previous page." },
          },
        },
        handler: ({ limit, pack, status, before }) =>
          engine.list({ limit, packId: pack, statuses: status ? (status.split(",") as RunStatus[]) : undefined, before }),
      }),
      defineAction<{ id: string }>({
        name: "runs.delete",
        title: "Delete a run that isn't going, with its results and files",
        method: "DELETE",
        path: "/runs/:id",
        input: byId,
        handler: ({ id }) => guard(() => engine.delete(id)),
      }),
      defineAction<StartBody>({
        name: "runs.start",
        title: "Start a run: a pack, the tests to run (default all), parameter values and options",
        method: "POST",
        path: "/runs",
        status: 201,
        input: START_INPUT,
        handler: (input, { client }) => guard(() => engine.start({ packId: input.packId, tests: input.tests, params: input.params, startedBy: client, options: runOptions(input) })),
      }),
      defineAction<StartBody>({
        name: "runs.preview",
        title: "Plan a run without starting it: every attempt in order, and the tests that join because they're needed",
        method: "POST",
        path: "/runs/preview",
        input: START_INPUT,
        handler: (input) => guard(() => engine.preview({ packId: input.packId, tests: input.tests, params: input.params, options: runOptions(input) })),
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
      defineAction<{ id: string; testId: string; number?: number; undo?: boolean }>({
        name: "runs.queue-skip",
        title: "Skip an attempt that hasn't started yet (undo: true takes the skip back)",
        method: "POST",
        path: "/runs/:id/queue/skip",
        input: {
          type: "object",
          properties: { id: RUN_ID, testId: { type: "string", minLength: 1 }, number: { type: "integer", minimum: 1, default: 1 }, undo: { type: "boolean", default: false } },
          required: ["id", "testId"],
        },
        handler: ({ id, testId, number, undo }) => guard(() => engine.queueSkip(id, testId, number ?? 1, !undo)),
      }),
      defineAction<{ id: string; testId: string; direction: "up" | "down" }>({
        name: "runs.queue-move",
        title: "Move a test that hasn't started one place up or down in the queue (it still runs after what it needs)",
        method: "POST",
        path: "/runs/:id/queue/move",
        input: {
          type: "object",
          properties: { id: RUN_ID, testId: { type: "string", minLength: 1 }, direction: { type: "string", enum: ["up", "down"] } },
          required: ["id", "testId", "direction"],
        },
        handler: ({ id, testId, direction }) => guard(() => engine.queueMove(id, testId, direction)),
      }),
      defineAction<{ id: string; note?: string }>({
        name: "runs.mark",
        title: "Save what the live view shows now, with a note, on the attempt that is running",
        method: "POST",
        path: "/runs/:id/mark",
        status: 201,
        input: { type: "object", properties: { id: RUN_ID, note: { type: "string", maxLength: 2000, default: "" } }, required: ["id"] },
        handler: ({ id, note }) => guard(() => engine.mark(id, note ?? "")),
      }),
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
  async routes(app, { services }) {
    const dataDir = services.get(FILES_ROOT);
    const root = path.resolve(dataDir, "runs");
    // Artifact files, from the data folder's runs/ only. Ranges are served so videos can seek.
    app.get("/files/*", async (req, reply) => {
      // Fastify has already decoded the path once; decoding again would turn "%25" into "%".
      const rel = (req.params as { "*": string })["*"] ?? "";
      if (!rel.startsWith("runs/")) return reply.code(404).send(errorBody("not_found", "No such file."));
      const abs = path.resolve(dataDir, ...rel.split("/"));
      if (!abs.startsWith(root + path.sep) || !existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send(errorBody("not_found", "No such file."));
      const size = statSync(abs).size;
      reply.type(contentTypeOf(abs)).header("cache-control", "no-cache").header("accept-ranges", "bytes");
      const range = byteRange(req.headers.range, size);
      if (range === "bad") return reply.code(416).header("content-range", `bytes */${size}`).send();
      if (!range) return reply.header("content-length", size).send(createReadStream(abs));
      const [start, end] = range;
      return reply
        .code(206)
        .header("content-range", `bytes ${start}-${end}/${size}`)
        .header("content-length", end - start + 1)
        .send(createReadStream(abs, { start, end }));
    });
    // Playwright's trace viewer, from our own origin: open /api/v1/trace-viewer/index.html?trace=<file url>.
    const viewer = traceViewerDir();
    if (viewer) await app.register(fastifyStatic, { root: viewer, prefix: "/trace-viewer/", decorateReply: false, cacheControl: false });
  },
});
