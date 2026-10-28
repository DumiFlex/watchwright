import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { ActionError, defineAction, type ObjectSchema } from "../../actions/registry.js";
import { MAX_EVENT_WAIT_S } from "../../core/core-plugin.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { contentTypeOf } from "../../jobs/recorder.js";
import { errorBody } from "../../server/errors.js";
import { FRAMES } from "../live/hub.js";
import { PACKS } from "../packs/registry.js";
import { SETTINGS } from "../settings/plugin.js";
import { JobKinds } from "../../jobs/kinds.js";
import { SECRETS } from "../secrets/plugin.js";
import { digest, readRunFile, waitForRun } from "./digest.js";
import { Engine, EngineError } from "./engine.js";
import { RUNS_ARTIFACT_SET_SQL, RUNS_INFO_SQL, RUNS_LABELS_PRESETS_SQL, RUNS_MIGRATION_SQL, RUNS_STEPS_SQL, RunsRepo, type RunChoices, type RunOptions, type RunStatus } from "./repo.js";

export const ENGINE = serviceKey<Engine>("runs.engine");
/** Job kinds by name: a plugin registers its kinds here in `setup` (the testing plugin registers `test`). */
export const JOB_KINDS = serviceKey<JobKinds>("runs.job-kinds");
export const RUNS_REPO = serviceKey<RunsRepo>("runs.repo");
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

interface StartBody extends RunChoices {
  packId: string;
  label?: string;
  preset?: string;
  kind?: string;
}

const CHOICE_PROPS = {
  tests: { type: "array", items: { type: "string" }, description: "Test ids; what they need and their parents/children join by themselves." },
  params: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
  pauseOnBroken: { type: "boolean", description: "Pause on a broken attempt and wait for retry or skip (default: the pack's setting, else true)." },
  pauseLimitMinutes: { type: "number", minimum: 0.05, maximum: 1440 },
  attempts: { type: "integer", minimum: 1, maximum: 100, description: "Attempts for every test, instead of each test's own count." },
  trace: { type: "string", enum: ["problems", "always", "never"], description: "Which attempts keep a Playwright trace (default: the pack's setting, else problems)." },
  video: { type: "boolean", description: "Record a video per attempt (default: the pack's setting, else true)." },
} as const;
const CHOICE_KEYS = Object.keys(CHOICE_PROPS) as (keyof RunChoices)[];
const PACK_ID = { type: "string", pattern: "^[0-9a-f]{8}$" } as const;
const LABEL = { type: "string", maxLength: 120, description: "A name for the run, shown beside its id." } as const;
const PRESET_NAME = { type: "string", minLength: 1, maxLength: 80 } as const;

const START_INPUT: ObjectSchema = {
  type: "object",
  properties: {
    packId: PACK_ID,
    ...CHOICE_PROPS,
    label: LABEL,
    preset: { ...PRESET_NAME, description: "Start from the pack's preset with this name; the other fields given override it." },
    kind: { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$", description: "The job kind (default test). GET /health lists the loaded kinds." },
  },
  required: ["packId"],
};

/** The choices a request names, without the fields it leaves out. */
function choicesOf(input: RunChoices): RunChoices {
  const out: Record<string, unknown> = {};
  for (const k of CHOICE_KEYS) if (input[k] !== undefined) out[k] = input[k];
  return out as RunChoices;
}

/** The run options a start request sets; unset ones fall back to the pack. */
function runOptions(input: RunChoices): RunOptions {
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
    { id: 4, name: "labels-presets", sql: RUNS_LABELS_PRESETS_SQL },
    { id: 5, name: "attempt-steps", sql: RUNS_STEPS_SQL },
  ],
  setup({ store, events, services }) {
    const dataDir = filesRoot(store.dataDir);
    services.provide(FILES_ROOT, dataDir);
    services.get(SETTINGS).define({
      key: "runs.newRunFrom",
      title: "What New run starts from: the pack's latest run, or the pack's defaults",
      schema: { type: "string", enum: ["latest", "defaults"] },
      default: "latest",
    });
    const repo = new RunsRepo(store.db);
    services.provide(RUNS_REPO, repo);
    const kinds = new JobKinds();
    services.provide(JOB_KINDS, kinds);
    const engine = new Engine({
      repo,
      events,
      packs: services.get(PACKS),
      frames: services.get(FRAMES),
      dataDir,
      kinds,
      secrets: services.has(SECRETS) ? services.get(SECRETS) : undefined,
    });
    engine.recover();
    services.provide(ENGINE, engine);
  },
  // Queued runs start once every plugin has registered its job kinds.
  ready({ services }) {
    services.get(ENGINE).schedule();
  },
  async close({ services }) {
    await services.get(ENGINE).close();
  },
  actions: ({ services, events }) => {
    const engine = services.get(ENGINE);
    const dataDir = services.get(FILES_ROOT);
    const repo = services.get(RUNS_REPO);
    const notFound = (id: string): never => {
      throw new ActionError("not_found", `No run with id ${id}.`, 404);
    };
    const presetNotFound = (id: string): never => {
      throw new ActionError("not_found", `No preset with id ${id}.`, 404);
    };
    /** A start request with its preset's choices filled in under the ones it gives. */
    const withPreset = (input: StartBody): StartBody => {
      if (!input.preset) return input;
      const preset = repo.presetByName(input.packId, input.preset);
      if (!preset) throw new ActionError("not_found", `The pack has no preset named "${input.preset}".`, 404);
      return { ...preset.choices, ...choicesOf(input), packId: input.packId, ...(input.label !== undefined ? { label: input.label } : {}), ...(input.kind !== undefined ? { kind: input.kind } : {}) };
    };
    const control = (name: string, verb: string, title: string, fn: (id: string, client: string) => unknown) =>
      defineAction<{ id: string }>({ name, title, method: "POST", path: `/runs/:id/${verb}`, input: byId, handler: ({ id }, { client }) => guard(() => fn(id, client)) });
    const CONTROLS = {
      pause: (id: string, client: string) => engine.pause(id, client),
      resume: (id: string) => engine.resume(id),
      retry: (id: string) => engine.retry(id),
      skip: (id: string) => engine.skip(id),
      stop: (id: string) => engine.stop(id, "after"),
      "stop-now": (id: string) => engine.stop(id, "now"),
    } as const;
    return [
      defineAction<{ limit?: number; pack?: string; status?: string; before?: string; q?: string }>({
        name: "runs.list",
        agent: { tool: "list_runs" },
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
            q: { type: "string", maxLength: 200, description: "Search: words that must each appear in the run's id, label, pack name, values, facts or status." },
          },
        },
        handler: ({ limit, pack, status, before, q }) =>
          engine.list({ limit, packId: pack, statuses: status ? (status.split(",") as RunStatus[]) : undefined, before, q }),
      }),
      defineAction<{ days?: number; pack?: string; tz?: number; until?: string }>({
        name: "runs.stats",
        title: "Runs and attempt outcomes per day for the last days, with the totals of the period before",
        method: "GET",
        path: "/runs/stats",
        input: {
          type: "object",
          properties: {
            days: { type: "integer", minimum: 1, maximum: 90, default: 14 },
            pack: { type: "string", pattern: "^[0-9a-f]{8}$", description: "Only runs of this pack." },
            tz: { type: "integer", minimum: -840, maximum: 840, default: 0, description: "Minutes the caller's time zone is behind UTC, as Date.getTimezoneOffset() gives it." },
            until: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The last day, YYYY-MM-DD. Default: today in the caller's time zone." },
          },
        },
        handler: ({ days, pack, tz, until }) => engine.stats({ days: days ?? 14, offset: tz ?? 0, packId: pack, until }),
      }),
      defineAction<{ id: string; limit?: number }>({
        name: "runs.history",
        title: "Each test's last finished attempts in a pack's runs, oldest first, keyed by test id",
        method: "GET",
        path: "/packs/:id/history",
        input: {
          type: "object",
          properties: { id: { type: "string", pattern: "^[0-9a-f]{8}$" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          required: ["id"],
        },
        handler: ({ id, limit }) => engine.testHistory(id, limit ?? 20),
      }),
      defineAction<{ id: string }>({
        name: "runs.delete",
        agent: { tool: "delete_run", say: "Only delete runs you started, unless the person asks." },
        destructive: true,
        explain: ({ id }: { id: string }) => {
          const r = engine.get(id);
          return r ? `Delete run ${id}${r.label ? ` "${r.label}"` : ""} of "${r.packName}" (${r.status}, ${r.attempts.length} attempts) with its files` : `Delete run ${id}`;
        },
        title: "Delete a run that isn't going, with its results and files",
        method: "DELETE",
        path: "/runs/:id",
        input: byId,
        handler: ({ id }) => guard(() => engine.delete(id)),
      }),
      defineAction<StartBody>({
        name: "runs.start",
        agent: { tool: "start_run", say: "The run shows live on the web page at /#/runs/<id>: tell the person so they can watch. Then call wait_for_run." },
        title: "Start a run: a pack, the tests to run (default all), parameter values and options",
        method: "POST",
        path: "/runs",
        status: 201,
        input: START_INPUT,
        handler: (body, { client }) => {
          const input = withPreset(body);
          return guard(() => engine.start({ packId: input.packId, tests: input.tests, params: input.params, startedBy: client, options: runOptions(input), label: input.label, kind: input.kind }));
        },
      }),
      defineAction<{ id: string }>({
        name: "runs.again",
        title: "Start a new run with another run's pack, tests, values, options and label",
        method: "POST",
        path: "/runs/:id/again",
        status: 201,
        input: byId,
        handler: ({ id }, { client }) => guard(() => engine.again(id, client)),
      }),
      defineAction<{ id: string; label: string }>({
        name: "runs.label",
        title: "Name a run (an empty label takes the name away)",
        method: "POST",
        path: "/runs/:id/label",
        input: { type: "object", properties: { id: RUN_ID, label: LABEL }, required: ["id", "label"] },
        handler: ({ id, label }) => guard(() => engine.setLabel(id, label)),
      }),
      defineAction<{ pack?: string }>({
        name: "runs.presets.list",
        title: "Saved run choices (presets), by pack and name",
        method: "GET",
        path: "/presets",
        input: { type: "object", properties: { pack: { ...PACK_ID, description: "Only this pack's presets." } } },
        handler: ({ pack }) => repo.presets(pack),
      }),
      defineAction<RunChoices & { packId: string; name: string }>({
        name: "runs.presets.save",
        title: "Save run choices under a name for a pack (replaces the pack's preset with that name)",
        method: "POST",
        path: "/presets",
        status: 201,
        input: { type: "object", properties: { packId: PACK_ID, name: PRESET_NAME, ...CHOICE_PROPS }, required: ["packId", "name"] },
        handler: (input) => repo.savePreset(input.packId, input.name.trim(), choicesOf(input)),
      }),
      defineAction<{ id: string; name: string }>({
        name: "runs.presets.rename",
        title: "Rename a preset",
        method: "POST",
        path: "/presets/:id",
        input: { type: "object", properties: { id: PACK_ID, name: PRESET_NAME }, required: ["id", "name"] },
        handler: ({ id, name }) => {
          const p = repo.preset(id) ?? presetNotFound(id);
          const clash = repo.presetByName(p.packId, name.trim());
          if (clash && clash.id !== id) throw new ActionError("conflict", `The pack already has a preset named "${name.trim()}".`, 409);
          repo.renamePreset(id, name.trim());
          return repo.preset(id);
        },
      }),
      defineAction<{ id: string }>({
        name: "runs.presets.delete",
        destructive: true,
        explain: ({ id }: { id: string }) => `Delete the preset "${repo.preset(id)?.name ?? id}"`,
        title: "Delete a preset",
        method: "DELETE",
        path: "/presets/:id",
        input: { type: "object", properties: { id: PACK_ID }, required: ["id"] },
        handler: ({ id }) => {
          if (!repo.deletePreset(id)) presetNotFound(id);
          return { deleted: id };
        },
      }),
      defineAction<StartBody>({
        name: "runs.preview",
        title: "Plan a run without starting it: every attempt in order, and the tests that join because they're needed",
        method: "POST",
        path: "/runs/preview",
        input: START_INPUT,
        handler: (input) => guard(() => engine.preview({ packId: input.packId, tests: input.tests, params: input.params, options: runOptions(input), kind: input.kind })),
      }),
      defineAction<Record<string, never>>({
        name: "runs.kinds",
        title: "The job kinds loaded, with the words each one uses for outcomes",
        method: "GET",
        path: "/kinds",
        input: { type: "object", properties: {} },
        handler: () => services.get(JOB_KINDS).list().map((k) => ({ name: k.name, labels: { ...(k.labels ?? {}) } })),
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
        agent: { tool: "get_attempt", say: "Full result of one attempt: error, flags, log, steps and its files (pass a file's `path` to get_file)." },
        title: "One attempt's result document (schemaVersion 1)",
        method: "GET",
        path: "/runs/:id/attempts/:attemptId",
        input: { type: "object", properties: { id: RUN_ID, attemptId: { type: "string", pattern: "^[0-9a-f]{12}$" } }, required: ["id", "attemptId"] },
        handler: ({ id, attemptId }) => engine.result(id, attemptId) ?? notFound(`${id}/${attemptId}`),
      }),
      defineAction<{ id: string }>({
        name: "runs.summary",
        title: "A run in brief: status, live state, counts and one line per attempt (error, robot problems, findings)",
        agent: { tool: "get_run", say: "`page` is the run's page on the web app; robot counts problems of the test itself, findings problems of the site." },
        method: "GET",
        path: "/runs/:id/summary",
        input: byId,
        handler: ({ id }) => digest(engine.get(id) ?? notFound(id)),
      }),
      defineAction<{ id: string; after?: number; timeout?: number }>({
        name: "runs.wait",
        title: `Wait until a run ends or pauses, at most \`timeout\` seconds (up to ${MAX_EVENT_WAIT_S}); says why it returned and what happened meanwhile`,
        agent: {
          tool: "wait_for_run",
          say: "Call again with `after` set to the returned cursor while reason is timeout. On paused: if pauseReason is broken, look at the attempt and retry or skip with control_run; if a person paused it (pausedBy), stop and ask them.",
        },
        method: "GET",
        path: "/runs/:id/wait",
        input: {
          type: "object",
          properties: {
            id: RUN_ID,
            after: { type: "integer", minimum: 0, description: "The cursor a previous wait returned: report what happened since, and count only pauses after it." },
            timeout: { type: "number", minimum: 0, maximum: MAX_EVENT_WAIT_S, default: 60, description: "Seconds to wait at most." },
          },
          required: ["id"],
        },
        handler: async ({ id, after, timeout = 60 }, { signal }) => (await waitForRun(engine, events, id, after, timeout * 1000, signal)) ?? notFound(id),
      }),
      defineAction<{ id: string; do: keyof typeof CONTROLS }>({
        name: "runs.control",
        title: "Pause, resume, retry the broken attempt, skip it, stop after this test, or stop now",
        agent: { tool: "control_run", say: "Only control runs you started, unless the person asks. Returns the run in brief." },
        method: "POST",
        path: "/runs/:id/control",
        input: { type: "object", properties: { id: RUN_ID, do: { type: "string", enum: Object.keys(CONTROLS) } }, required: ["id", "do"] },
        handler: async ({ id, do: what }, { client }) => {
          await guard(() => CONTROLS[what](id, client));
          return digest(engine.get(id)!);
        },
      }),
      defineAction<{ id: string; path: string }>({
        name: "runs.file",
        title: "One of a run's files by its path from the results: a screenshot as base64 with its size, a text as text",
        agent: { tool: "get_file", say: "Screenshots come back as images you can look at." },
        method: "GET",
        path: "/runs/:id/file",
        input: { type: "object", properties: { id: RUN_ID, path: { type: "string", minLength: 1, maxLength: 600, description: "The file's `path` from an attempt's artifacts (`runs/<id>/…`)." } }, required: ["id", "path"] },
        handler: ({ id, path: rel }) => {
          if (!engine.get(id)) notFound(id);
          return readRunFile(dataDir, id, rel) ?? notFound(`${id}: ${rel}`);
        },
      }),
      control("runs.pause", "pause", "Pause at the next step", (id, client) => engine.pause(id, client)),
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
      defineAction<{ id: string; tests: string[] }>({
        name: "runs.queue-add",
        title: "Add tests to a run that is going; they and what they need go at the end of the queue",
        method: "POST",
        path: "/runs/:id/queue/add",
        input: {
          type: "object",
          properties: { id: RUN_ID, tests: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 } },
          required: ["id", "tests"],
        },
        handler: ({ id, tests }) => guard(() => engine.addTests(id, tests)),
      }),
      defineAction<{ id: string; note?: string; pageId?: string; at?: number }>({
        name: "runs.mark",
        title: "Save what the live view shows now (or showed at `at`, from the rewind buffer), with a note, on the attempt that is running",
        method: "POST",
        path: "/runs/:id/mark",
        status: 201,
        input: {
          type: "object",
          properties: {
            id: RUN_ID,
            note: { type: "string", maxLength: 2000, default: "" },
            pageId: { type: "string", minLength: 1, maxLength: 32, description: "Page of the rewind frame (with `at`)." },
            at: { type: "number", minimum: 0, description: "Timestamp (ms since the epoch) of a frame in the rewind buffer." },
          },
          required: ["id"],
        },
        handler: ({ id, note, pageId, at }) => guard(() => engine.mark(id, note ?? "", at === undefined ? undefined : { pageId, at })),
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
