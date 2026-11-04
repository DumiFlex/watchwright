import { createReadStream, existsSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { ActionError, defineAction, type ObjectSchema } from "../../actions/registry.js";
import { MAX_EVENT_WAIT_S } from "../../core/core-plugin.js";
import { whoCalls } from "../../core/access.js";
import { definePlugin } from "../../core/plugin.js";
import { withAccess } from "../../core/route-access.js";
import { serviceKey } from "../../core/services.js";
import { contentTypeOf } from "../../jobs/recorder.js";
import { VIDEO_QUALITIES, type VideoQuality } from "../../jobs/run-video.js";
import { sizeText } from "../../jobs/storage.js";
import { errorBody } from "../../server/errors.js";
import { FRAMES } from "../live/hub.js";
import { PACKS } from "../packs/registry.js";
import { PACK_STATE } from "../packs/state.js";
import { PACK_ACCESS } from "../packs/access.js";
import { SETTINGS } from "../settings/plugin.js";
import { JobKinds } from "../../jobs/kinds.js";
import { SECRETS } from "../secrets/plugin.js";
import { RUNNERS } from "../runners/plugin.js";
import { SIGNINS } from "../signins/plugin.js";
import { digest, readRunFile, waitForRun } from "./digest.js";
import { DEFAULT_STORAGE_LIMITS, Engine, EngineError } from "./engine.js";
import { ACTIVE_STATUSES, RUNS_ARTIFACT_SET_SQL, RUNS_INFO_SQL, RUNS_LABELS_PRESETS_SQL, RUNS_MIGRATION_SQL, RUNS_SIZE_SQL, RUNS_STEPS_SQL, RUNS_STOPPED_BY_SERVER_SQL, RunsRepo, type RunChoices, type RunOptions, type RunStatus } from "./repo.js";
import type { VideoSetting } from "../packs/api.js";
import { VideoCompressor } from "./videos.js";

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
  video: {
    anyOf: [{ type: "boolean" }, { type: "string", enum: ["always", "problems", "never"] }],
    description: "Which attempts keep a video: always (also true), problems (failed or broken) or never (also false). Default: the pack's setting, else always.",
  },
  runVideo: { type: "boolean", description: "Record one video of the whole run, of what the live view follows (default: the pack's setting, else false)." },
  followVideo: { type: "boolean", description: "Record each attempt's video of the page the live view follows, one video across tabs and popups, instead of one per page (default: the pack's setting, else false)." },
  videoQuality: { type: "string", enum: [...VIDEO_QUALITIES], description: "How sharp the run's videos are: high (for videos people watch), full, compact or small (default: the pack's setting, else the server's Video quality setting)." },
  signIn: { type: "boolean", description: "Start with the site's saved sign-in (default: the pack's site.signIn)." },
  network: { type: "string", minLength: 1, maxLength: 60, description: 'Where the browser reaches the site from: "server" or a runner\'s name (default: the pack\'s site.network, else server). GET /runners lists the runners.' },
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
  if (input.runVideo !== undefined) o.runVideo = input.runVideo;
  if (input.followVideo !== undefined) o.followVideo = input.followVideo;
  if (input.videoQuality !== undefined) o.videoQuality = input.videoQuality;
  if (input.signIn !== undefined) o.signIn = input.signIn;
  if (input.network !== undefined) o.network = input.network;
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

/** Each engine's listener for unhandled rejections, taken off when its server closes. */
const strays = new WeakMap<Engine, (reason: unknown) => void>();
/** Each engine's Compress kept videos job. */
const compressors = new WeakMap<Engine, VideoCompressor>();
const sweeps = new WeakMap<Engine, ReturnType<typeof setTimeout>>();
/** The cleanup sweep runs a minute after start (once every plugin is ready), then once a day. */
const FIRST_SWEEP_MS = 60_000;
const SWEEP_EVERY_MS = 24 * 60 * 60_000;

/** Runs: starting, controlling and reading them, and the files they save. */
export const runsPlugin = definePlugin({
  name: "runs",
  pages: [
    { name: "runs", title: "Runs", path: "/", icon: "ListChecks", menu: "main", order: 10, words: "history list" },
    { name: "new-run", title: "New run", path: "/new", icon: "Plus", menu: "more", order: 40, words: "start" },
  ],
  migrations: [
    { id: 1, name: "init", sql: RUNS_MIGRATION_SQL },
    { id: 2, name: "artifact-set", sql: RUNS_ARTIFACT_SET_SQL },
    { id: 3, name: "run-info", sql: RUNS_INFO_SQL },
    { id: 4, name: "labels-presets", sql: RUNS_LABELS_PRESETS_SQL },
    { id: 5, name: "attempt-steps", sql: RUNS_STEPS_SQL },
    { id: 6, name: "run-size", sql: RUNS_SIZE_SQL },
    { id: 7, name: "stopped-by-server", sql: RUNS_STOPPED_BY_SERVER_SQL },
  ],
  setup({ store, events, services }) {
    const dataDir = filesRoot(store.dataDir);
    services.provide(FILES_ROOT, dataDir);
    services.get(SETTINGS).define({
      key: "runs.newRunFrom",
      title: "What New run starts from: the pack's latest run, or the pack's defaults",
      schema: { type: "string", enum: ["latest", "defaults"] },
      default: "latest",
      scope: "user",
    });
    const settings = services.get(SETTINGS);
    settings.define({
      key: "runs.storageWarnGB",
      title: "Warn when the drive with the data folder has less free space than this, in GB",
      schema: { type: "number", minimum: 0, maximum: 100000 },
      default: DEFAULT_STORAGE_LIMITS.warnBelowGB,
    });
    settings.define({
      key: "runs.storageStopGB",
      title: "Stop recording videos when the drive has less free space than this, in GB (runs go on)",
      schema: { type: "number", minimum: 0, maximum: 100000 },
      default: DEFAULT_STORAGE_LIMITS.stopBelowGB,
    });
    settings.define({
      key: "runs.videoQuality",
      title: "How sharp videos are and how much room they take: high (sharp text, 30 frames a second, for videos people watch), full (as Playwright records), compact (about 80% smaller, same size) or small (about 94% smaller, 3/4 size, 10 frames a second)",
      schema: { type: "string", enum: [...VIDEO_QUALITIES] },
      default: "full",
    });
    settings.define({
      key: "runs.resumeOnStart",
      title: "Resume runs a stop or crash of Watchwright interrupted when it starts again",
      schema: { type: "boolean" },
      default: false,
    });
    settings.define({
      key: "runs.keepDays",
      title: "Delete ended runs older than this many days (0 keeps them; labeled runs are always kept)",
      schema: { type: "integer", minimum: 0, maximum: 36500 },
      default: 0,
    });
    settings.define({
      key: "runs.keepPerPack",
      title: "Keep only this many of each pack's newest runs (0 keeps them all; labeled runs are always kept)",
      schema: { type: "integer", minimum: 0, maximum: 100000 },
      default: 0,
    });
    const repo = new RunsRepo(store.db);
    services.provide(RUNS_REPO, repo);
    const packAccess = services.get(PACK_ACCESS);
    packAccess.resolve("run", (id) => repo.run(id)?.pack_id ?? null);
    packAccess.resolve("preset", (id) => repo.preset(id)?.packId ?? null);
    services.get(PACKS).link({
      pastId: (packFile) => repo.packIdAt(packFile),
      busy: (packId) => {
        const run = repo.runs({ packId, statuses: ACTIVE_STATUSES, limit: 1 })[0];
        return run ? `A run of this pack is ${run.status} (${run.id}). Stop it, or wait until it ends.` : null;
      },
    });
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
      signIns: services.has(SIGNINS) ? services.get(SIGNINS) : undefined,
      runners: services.has(RUNNERS) ? services.get(RUNNERS) : undefined,
      packState: services.get(PACK_STATE),
      storageLimits: () => ({ warnBelowGB: settings.get<number>("runs.storageWarnGB"), stopBelowGB: settings.get<number>("runs.storageStopGB") }),
      cleanupRules: () => ({ keepDays: settings.get<number>("runs.keepDays"), keepPerPack: settings.get<number>("runs.keepPerPack") }),
      videoQuality: () => settings.get<VideoQuality>("runs.videoQuality"),
    });
    compressors.set(
      engine,
      new VideoCompressor({
        dataDir,
        repo,
        events,
        quality: () => settings.get<VideoQuality>("runs.videoQuality"),
        busy: () => engine.busy(),
        measure: (id) => engine.measure(id),
      }),
    );
    engine.recover();
    services.provide(ENGINE, engine);
    // With a listener here, Node no longer exits on an unhandled rejection (its default), so one
    // test that forgot an `await` can't stop every run on the server.
    const stray = (reason: unknown) => console.error(engine.strayError(reason));
    process.on("unhandledRejection", stray);
    strays.set(engine, stray);
  },
  // Queued runs start once every plugin has registered its job kinds.
  ready({ services }) {
    const engine = services.get(ENGINE);
    // After every plugin's ready (alerts listen from theirs), so runs.restarted reaches them.
    const settings = services.get(SETTINGS);
    engine.schedule();
    setImmediate(() => {
      try {
        engine.afterRestart(settings.get<boolean>("runs.resumeOnStart") === true);
      } catch {
        // The server closed before it got here (the store is gone): the runs wait for the next start.
      }
    });
    // Runs from before sizes were kept, measured in the background.
    void engine.measureMissing().catch(() => undefined);
    // Cleanup: off until a rule is set in Settings > Storage, then a sweep a day.
    const sweep = (delay: number) => {
      const timer = setTimeout(() => {
        void engine
          .cleanup("schedule")
          .catch((err: unknown) => console.error(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`))
          .finally(() => sweeps.has(engine) && sweep(SWEEP_EVERY_MS));
      }, delay);
      timer.unref();
      sweeps.set(engine, timer);
    };
    sweep(FIRST_SWEEP_MS);
  },
  async close({ services }) {
    const engine = services.get(ENGINE);
    const stray = strays.get(engine);
    if (stray) process.off("unhandledRejection", stray);
    clearTimeout(sweeps.get(engine));
    sweeps.delete(engine);
    await compressors.get(engine)?.stop("Watchwright stopped.");
    await engine.close();
  },
  actions: ({ services, events }) => {
    const engine = services.get(ENGINE);
    const dataDir = services.get(FILES_ROOT);
    const repo = services.get(RUNS_REPO);
    const access = services.get(PACK_ACCESS);
    const settings = services.get(SETTINGS);
    const compressor = (): VideoCompressor => compressors.get(engine)!;
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
      defineAction<{ id: string }>({ name, title, method: "POST", path: `/runs/:id/${verb}`, input: byId, pack: { run: "id" }, handler: ({ id }, { client: caller, user }) => guard(() => fn(id, whoCalls(caller, user))) });
    const CONTROLS = {
      pause: (id: string, client: string) => engine.pause(id, client),
      resume: (id: string) => engine.resume(id),
      retry: (id: string) => engine.retry(id),
      skip: (id: string) => engine.skip(id),
      stop: (id: string) => engine.stop(id, "after"),
      "stop-now": (id: string) => engine.stop(id, "now"),
    } as const;
    return [
      defineAction<{ limit?: number; pack?: string; status?: string; kind?: string; before?: string; q?: string }>({
        name: "runs.list",
        pack: "list",
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
            kind: { type: "string", pattern: "^[a-z0-9-]+(,[a-z0-9-]+)*$", description: "Only runs of these job kinds (test, task, …), comma separated." },
            before: { type: "string", description: "Cursor: the createdAt of the last run of the previous page." },
            q: { type: "string", maxLength: 200, description: "Search: words that must each appear in the run's id, label, pack name, values, facts or status." },
          },
        },
        handler: ({ limit, pack, status, kind, before, q }, { user }) =>
          engine.list({ limit, packId: pack, hidePacks: access.hiddenFrom(user), statuses: status ? (status.split(",") as RunStatus[]) : undefined, kinds: kind?.split(","), before, q }),
      }),
      defineAction<{ days?: number; pack?: string; tz?: number; until?: string }>({
        name: "runs.stats",
        pack: "list",
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
        handler: ({ days, pack, tz, until }, { user }) => engine.stats({ days: days ?? 14, offset: tz ?? 0, packId: pack, until, hidePacks: access.hiddenFrom(user) }),
      }),
      defineAction<{ id: string; limit?: number }>({
        name: "runs.history",
        pack: { pack: "id" },
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
        pack: { run: "id" },
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
        pack: { pack: "packId" },
        agent: { tool: "start_run", say: "The run shows live on the web page at /#/runs/<id>: tell the person so they can watch. Then call wait_for_run." },
        title: "Start a run: a pack, the tests to run (default all), parameter values and options",
        method: "POST",
        path: "/runs",
        status: 201,
        input: START_INPUT,
        handler: (body, { client: caller, user }) => {
          const input = withPreset(body);
          return guard(() => engine.start({ packId: input.packId, tests: input.tests, params: input.params, startedBy: whoCalls(caller, user), options: runOptions(input), label: input.label, kind: input.kind }));
        },
      }),
      defineAction<{ id: string }>({
        name: "runs.again",
        pack: { run: "id" },
        title: "Start a new run with another run's pack, tests, values, options and label",
        method: "POST",
        path: "/runs/:id/again",
        status: 201,
        input: byId,
        handler: ({ id }, { client: caller, user }) => guard(() => engine.again(id, whoCalls(caller, user))),
      }),
      defineAction<{ id: string; label: string }>({
        name: "runs.label",
        pack: { run: "id" },
        title: "Name a run (an empty label takes the name away)",
        method: "POST",
        path: "/runs/:id/label",
        input: { type: "object", properties: { id: RUN_ID, label: LABEL }, required: ["id", "label"] },
        handler: ({ id, label }) => guard(() => engine.setLabel(id, label)),
      }),
      defineAction<{ pack?: string }>({
        name: "runs.presets.list",
        pack: "list",
        title: "Saved run choices (presets), by pack and name",
        method: "GET",
        path: "/presets",
        input: { type: "object", properties: { pack: { ...PACK_ID, description: "Only this pack's presets." } } },
        handler: ({ pack }, { sees }) => repo.presets(pack).filter((p) => sees?.(p.packId) ?? true),
      }),
      defineAction<RunChoices & { packId: string; name: string }>({
        name: "runs.presets.save",
        pack: { pack: "packId" },
        title: "Save run choices under a name for a pack (replaces the pack's preset with that name)",
        method: "POST",
        path: "/presets",
        status: 201,
        input: { type: "object", properties: { packId: PACK_ID, name: PRESET_NAME, ...CHOICE_PROPS }, required: ["packId", "name"] },
        handler: (input) => repo.savePreset(input.packId, input.name.trim(), choicesOf(input)),
      }),
      defineAction<{ id: string; name: string }>({
        name: "runs.presets.rename",
        pack: { preset: "id" },
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
        pack: { preset: "id" },
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
        pack: { pack: "packId" },
        title: "Plan a run without starting it: every attempt in order, and the tests that join because they're needed",
        method: "POST",
        path: "/runs/preview",
        input: START_INPUT,
        handler: (input) => guard(() => engine.preview({ packId: input.packId, tests: input.tests, params: input.params, options: runOptions(input), kind: input.kind })),
      }),
      defineAction<Record<string, never>>({
        name: "runs.kinds",
        pack: "none",
        title: "The job kinds loaded, with the words each one uses for outcomes",
        method: "GET",
        path: "/kinds",
        input: { type: "object", properties: {} },
        handler: () => services.get(JOB_KINDS).list().map((k) => ({ name: k.name, labels: { ...(k.labels ?? {}) } })),
      }),
      defineAction<{ id: string; history?: boolean }>({
        name: "runs.get",
        pack: { run: "id" },
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
        pack: { run: "id" },
        agent: { tool: "get_attempt", say: "Full result of one attempt: error, flags, log, steps and its files (pass a file's `path` to get_file)." },
        title: "One attempt's result document (schemaVersion 1)",
        method: "GET",
        path: "/runs/:id/attempts/:attemptId",
        input: { type: "object", properties: { id: RUN_ID, attemptId: { type: "string", pattern: "^[0-9a-f]{12}$" } }, required: ["id", "attemptId"] },
        handler: ({ id, attemptId }) => engine.result(id, attemptId) ?? notFound(`${id}/${attemptId}`),
      }),
      defineAction<{ id: string }>({
        name: "runs.summary",
        pack: { run: "id" },
        title: "A run in brief: status, live state, counts and one line per attempt (error, robot problems, findings)",
        agent: { tool: "get_run", say: "`page` is the run's page on the web app; robot counts problems of the test itself, findings problems of the site." },
        method: "GET",
        path: "/runs/:id/summary",
        input: byId,
        handler: ({ id }) => digest(engine.get(id) ?? notFound(id)),
      }),
      defineAction<{ id: string; after?: number; timeout?: number }>({
        name: "runs.wait",
        pack: { run: "id" },
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
        pack: { run: "id" },
        title: "Pause, resume, retry the broken attempt, skip it, stop after this test, or stop now",
        agent: { tool: "control_run", say: "Only control runs you started, unless the person asks. Returns the run in brief." },
        method: "POST",
        path: "/runs/:id/control",
        input: { type: "object", properties: { id: RUN_ID, do: { type: "string", enum: Object.keys(CONTROLS) } }, required: ["id", "do"] },
        handler: async ({ id, do: what }, { client: caller, user }) => {
          await guard(() => CONTROLS[what](id, whoCalls(caller, user)));
          return digest(engine.get(id)!);
        },
      }),
      defineAction<{ id: string; path: string }>({
        name: "runs.file",
        pack: { run: "id" },
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
      defineAction<{ id: string; pauseOnBroken?: boolean; pauseLimitMinutes?: number; testTimeoutMinutes?: number; trace?: "problems" | "always" | "never"; video?: VideoSetting; runVideo?: boolean }>({
        name: "runs.settings",
        pack: { run: "id" },
        title: "Change a going or queued run's settings: they're kept with the run and apply from the next attempt; a new pause limit applies at once to a broken pause, and the run video starts or stops at once",
        method: "POST",
        path: "/runs/:id/settings",
        input: {
          type: "object",
          properties: {
            id: RUN_ID,
            pauseOnBroken: CHOICE_PROPS.pauseOnBroken,
            pauseLimitMinutes: { ...CHOICE_PROPS.pauseLimitMinutes, description: "How long a broken pause waits before it skips, counted from when the pause began." },
            testTimeoutMinutes: { type: "number", minimum: 0, maximum: 1440, description: "A time limit for every attempt, over the tests' own; 0 goes back to each test's limit." },
            trace: CHOICE_PROPS.trace,
            video: CHOICE_PROPS.video,
            runVideo: { type: "boolean", description: "Record a video of the whole run; turning it on starts a new part at once, off ends it." },
          },
          required: ["id"],
        },
        handler: ({ id, testTimeoutMinutes, ...rest }, { client: caller, user }) =>
          guard(() => engine.changeSettings(id, { ...rest, ...(testTimeoutMinutes === undefined ? {} : { testTimeoutMinutes: testTimeoutMinutes === 0 ? null : testTimeoutMinutes }) }, whoCalls(caller, user))),
      }),
      defineAction<Record<string, never>>({
        name: "runs.storage",
        pack: "list",
        title: "What runs take on the drive: free space, the space runs take, the largest runs, and the warning limits",
        method: "GET",
        path: "/storage",
        input: { type: "object", properties: {} },
        handler: async (_input, { sees }) => {
          const report = await engine.storage();
          return { ...report, largest: report.largest.filter((r) => sees?.(r.packId) ?? true) };
        },
      }),
      defineAction<Record<string, never>>({
        name: "runs.cleanup-preview",
        pack: "list",
        title: "What cleanup would delete now under the keep rules in Settings > Storage: the runs, oldest first, and the room they take",
        method: "GET",
        path: "/storage/cleanup",
        input: { type: "object", properties: {} },
        handler: (_input, { sees }) => {
          const plan = engine.cleanupPlan();
          return { ...plan, runs: plan.runs.filter((r) => sees?.(r.packId) ?? true) };
        },
      }),
      defineAction<Record<string, never>>({
        name: "runs.cleanup",
        pack: "none",
        access: "admin",
        destructive: true,
        explain: () => {
          const plan = engine.cleanupPlan();
          return `Delete ${plan.runs.length} ${plan.runs.length === 1 ? "run" : "runs"} the keep rules don't keep, with their files (${sizeText(plan.bytes)})`;
        },
        title: "Delete the ended runs the keep rules in Settings > Storage don't keep, now (the daily sweep does the same)",
        method: "POST",
        path: "/storage/cleanup",
        input: { type: "object", properties: {} },
        handler: (_body, { client: caller, user }) => engine.cleanup(whoCalls(caller, user)),
      }),
      defineAction<Record<string, never>>({
        name: "runs.videos",
        pack: "none",
        title: "The videos ended runs kept: how many, the room they take, how many Compress kept videos would make smaller at the Video quality setting, and the compress job going or last",
        method: "GET",
        path: "/storage/videos",
        input: { type: "object", properties: {} },
        handler: () => compressor().report(),
      }),
      defineAction<Record<string, never>>({
        name: "runs.compress-videos",
        pack: "none",
        access: "admin",
        destructive: true,
        explain: () => `Encode the videos ended runs kept again at the ${settings.get<string>("runs.videoQuality")} quality, replacing the old files`,
        title: "Encode the videos ended runs kept again at the Video quality setting, in the background, one at a time; it stops by itself when a run starts",
        method: "POST",
        path: "/storage/videos/compress",
        input: { type: "object", properties: {} },
        handler: (_body, { client: caller, user }) => guard(() => compressor().start(whoCalls(caller, user))),
      }),
      defineAction<Record<string, never>>({
        name: "runs.compress-videos-stop",
        pack: "none",
        access: "admin",
        title: "Stop compressing kept videos; the video being encoded stays as it was",
        method: "POST",
        path: "/storage/videos/compress/stop",
        input: { type: "object", properties: {} },
        handler: () => compressor().stop(),
      }),
      control("runs.pause", "pause", "Pause at the next step", (id, client) => engine.pause(id, client)),
      control("runs.resume", "resume", "Resume a paused run, or continue an interrupted or stopped run where it was", (id) => engine.resume(id)),
      control("runs.retry", "retry", "Run the broken attempt the run paused on again", (id) => engine.retry(id)),
      control("runs.skip", "skip", "Keep the broken attempt's result and go on", (id) => engine.skip(id)),
      control("runs.redo-broken", "redo-broken", "Run only the broken attempts of a finished run again (with what they need)", (id) => engine.redoBroken(id)),
      defineAction<{ id: string; testId: string; number?: number; undo?: boolean }>({
        name: "runs.queue-skip",
        pack: { run: "id" },
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
        pack: { run: "id" },
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
        pack: { run: "id" },
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
        pack: { run: "id" },
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
        pack: { run: "id" },
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
    const packAccess = services.get(PACK_ACCESS);
    app.get("/files/*", { config: { access: "viewer", pack: "checked" } }, async (req, reply) => {
      // Fastify has already decoded the path once; decoding again would turn "%25" into "%".
      const rel = (req.params as { "*": string })["*"] ?? "";
      if (!rel.startsWith("runs/")) return reply.code(404).send(errorBody("not_found", "No such file."));
      const abs = path.resolve(dataDir, ...rel.split("/"));
      if (!abs.startsWith(root + path.sep) || !existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send(errorBody("not_found", "No such file."));
      // A run's files follow its pack's access. The run comes from the resolved path, not the
      // address as written: `runs/./<id>`, `runs//<id>` and `runs/x/../<id>` name the same folder,
      // and so does `runs/<ID>` where names don't tell case apart (Windows, macOS).
      const runId = (path.relative(root, abs).split(path.sep)[0] ?? "").toLowerCase();
      const packId = /^[0-9a-f]{8}$/.test(runId) ? packAccess.packOf("run", runId) : null;
      if (packId !== null && !packAccess.sees(req.watchwrightUser, packId)) return reply.code(404).send(errorBody("not_found", "No such file."));
      // A link inside the runs folder must not lead out of it.
      if (!realpathSync(abs).startsWith(realpathSync(root) + path.sep)) return reply.code(404).send(errorBody("not_found", "No such file."));
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
    if (viewer) await withAccess(app, "viewer", (scope) => scope.register(fastifyStatic, { root: viewer, prefix: "/trace-viewer/", decorateReply: false, cacheControl: false }), "none");
  },
});
