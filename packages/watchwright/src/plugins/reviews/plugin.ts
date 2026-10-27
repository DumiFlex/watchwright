import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey, type Services } from "../../core/services.js";
import { errorBody } from "../../server/errors.js";
import { PACKS } from "../packs/registry.js";
import { rubricFor, scoreProblem, type Criterion, type Score } from "../packs/rubric.js";
import { ENGINE, FILES_ROOT } from "../runs/plugin.js";
import type { ResultDocument } from "../runs/results.js";
import { compare, type CompareCell, type CompareShot, type Comparison } from "./compare.js";
import { toMarkdown } from "./markdown.js";
import { REVIEWS_MIGRATION_SQL, ReviewsRepo, type Review } from "./repo.js";
import { zip, type ZipEntry } from "./zip.js";

// Reviews: people and agents score each attempt on the run's rubric and leave a note. One review
// per attempt per reviewer; the web app reviews as "web", an agent as its client name.

export const REVIEWS = serviceKey<ReviewsRepo>("reviews.repo");

const RUN_ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Run id." } as const;
const ATTEMPT_ID = { type: "string", pattern: "^[0-9a-f]{12}$", description: "Attempt id." } as const;
const RUN_LIST = { type: "string", pattern: "^[0-9a-f]{8}(,[0-9a-f]{8}){0,5}$", description: "One to six run ids of the same pack, comma-separated." } as const;
export const MAX_COMPARE = 6;

/** The run's own rubric for the test, else the pack's current one, else the default. */
function criteriaFor(services: Services, runId: string, packId: string, testId: string): Criterion[] {
  return (
    services.get(REVIEWS).rubrics(runId)?.[testId] ??
    services.get(PACKS).get(packId)?.tests.find((t) => t.id === testId)?.rubric ??
    rubricFor(undefined, undefined)
  );
}

/** Lines up runs of one pack (a run export is a comparison of one run). */
export function comparisonOf(services: Services, list: string): Comparison {
  const engine = services.get(ENGINE);
  const repo = services.get(REVIEWS);
  const ids = [...new Set(list.split(",").filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_COMPARE) throw new ActionError("bad_input", `Give one to ${MAX_COMPARE} run ids.`);
  const runs = ids.map((id) => {
    const run = engine.get(id);
    if (!run) throw new ActionError("not_found", `No run with id ${id}.`, 404);
    return run;
  });
  const packs = new Set(runs.map((r) => r.packId));
  if (packs.size > 1) throw new ActionError("mixed_packs", "Runs of different packs can't be compared; pick runs of one pack.");
  return compare(
    runs.map((run) => ({
      run,
      results: run.attempts.map((a) => engine.result(run.id, a.id)).filter((d): d is ResultDocument => d !== null),
      reviews: repo.list({ runId: run.id }),
      criteria: (testId: string) => criteriaFor(services, run.id, run.packId, testId),
    })),
  );
}

/** A file name for the export: the pack's name and the run ids. */
function exportName(c: Comparison, ext: string): string {
  const base = c.packName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "watchwright";
  return `${base}-${c.runs.map((r) => r.id).join("-")}.${ext}`;
}

/** Where a screenshot goes inside the zip: shots/<run>/<attempt>/<file>. */
function zipPath(shot: CompareShot, cell: CompareCell): string {
  return `shots/${cell.runId}/${cell.attemptId}/${path.posix.basename(shot.path)}`;
}

export interface AttemptReviews {
  /** What this attempt is scored on. */
  criteria: Criterion[];
  /** Every reviewer's review, oldest first. */
  reviews: Review[];
}

export const reviewsPlugin = definePlugin({
  name: "reviews",
  migrations: [{ id: 1, name: "init", sql: REVIEWS_MIGRATION_SQL }],
  setup({ store, events, services }) {
    const repo = new ReviewsRepo(store.db);
    services.provide(REVIEWS, repo);
    const engine = services.get(ENGINE);
    const packs = services.get(PACKS);
    // Keep the rubric a run starts with; drop a run's reviews when the run is deleted.
    events.subscribe((e) => {
      if (!e.runId) return;
      if (e.type === "run.started") {
        const run = engine.get(e.runId);
        const pack = run ? packs.get(run.packId) : null;
        if (run && pack) repo.keepRubrics(run.id, run.packId, Object.fromEntries(pack.tests.map((t) => [t.id, t.rubric])));
      } else if (e.type === "run.deleted") repo.deleteRun(e.runId);
    });
  },
  actions: ({ services, events }) => {
    const repo = services.get(REVIEWS);
    const engine = services.get(ENGINE);

    const attemptOf = (runId: string, attemptId: string) => {
      const run = engine.get(runId);
      const attempt = run?.attempts.find((a) => a.id === attemptId) ?? (run ? engine.result(runId, attemptId) : null);
      if (!run || !attempt) throw new ActionError("not_found", `No attempt ${attemptId} in run ${runId}.`, 404);
      const testId = "testId" in attempt ? attempt.testId : attempt.test.id;
      return { run, testId };
    };

    return [
      defineAction<{ id: string; attemptId: string }, AttemptReviews>({
        name: "reviews.get",
        title: "Get an attempt's rubric and reviews",
        method: "GET",
        path: "/runs/:id/attempts/:attemptId/review",
        input: { type: "object", properties: { id: RUN_ID, attemptId: ATTEMPT_ID }, required: ["id", "attemptId"] },
        handler: ({ id, attemptId }) => {
          const { run, testId } = attemptOf(id, attemptId);
          return { criteria: criteriaFor(services, id, run.packId, testId), reviews: repo.forAttempt(attemptId) };
        },
      }),
      defineAction<{ id: string; attemptId: string; scores?: Record<string, Score | null>; note?: string }, Review>({
        name: "reviews.save",
        title: "Score an attempt and leave a note",
        method: "POST",
        path: "/runs/:id/attempts/:attemptId/review",
        input: {
          type: "object",
          properties: {
            id: RUN_ID,
            attemptId: ATTEMPT_ID,
            scores: {
              type: "object",
              description: "Scores by criterion id: a whole number on a scale, a choice's name, or true/false. Null clears a score; criteria left out keep theirs.",
              // Values aren't typed here: type coercion would turn 1 into true. scoreProblem checks them.
              additionalProperties: { description: "A score, or null." },
            },
            note: { type: "string", maxLength: 20000, description: "Replaces the note when given." },
          },
          required: ["id", "attemptId"],
        },
        handler: ({ id, attemptId, scores = {}, note }, { client }) => {
          const { run, testId } = attemptOf(id, attemptId);
          const problem = scoreProblem(criteriaFor(services, id, run.packId, testId), scores);
          if (problem) throw new ActionError("bad_score", problem);
          const old = repo.forAttempt(attemptId).find((r) => r.reviewer === client);
          const merged: Record<string, Score> = { ...(old?.scores ?? {}) };
          for (const [k, v] of Object.entries(scores)) {
            if (v === null) delete merged[k];
            else merged[k] = v;
          }
          const review = repo.save({ runId: id, packId: run.packId, attemptId, testId, reviewer: client, scores: merged, note: note ?? old?.note ?? "" });
          events.append("review.saved", { testId, reviewer: client, scores: review.scores }, { runId: id, attemptId });
          return review;
        },
      }),
      defineAction<{ id: string }, Record<string, Criterion[]>>({
        name: "reviews.rubric",
        title: "Get the criteria each test of a run is scored on",
        method: "GET",
        path: "/runs/:id/rubric",
        input: { type: "object", properties: { id: RUN_ID }, required: ["id"] },
        handler: ({ id }) => {
          const run = engine.get(id);
          if (!run) throw new ActionError("not_found", `No run with id ${id}.`, 404);
          const tests = [...new Set([...run.plan.map((p) => p.testId), ...run.attempts.map((a) => a.testId)])];
          return Object.fromEntries(tests.map((t) => [t, criteriaFor(services, id, run.packId, t)]));
        },
      }),
      defineAction<{ run?: string; pack?: string; test?: string; reviewer?: string }, Review[]>({
        name: "reviews.list",
        title: "List reviews by run, pack, test or reviewer",
        method: "GET",
        path: "/reviews",
        input: {
          type: "object",
          properties: {
            run: RUN_ID,
            pack: { type: "string", pattern: "^[0-9a-f]{8}$" },
            test: { type: "string", maxLength: 200 },
            reviewer: { type: "string", maxLength: 60 },
          },
        },
        handler: ({ run, pack, test, reviewer }) => repo.list({ runId: run, packId: pack, testId: test, reviewer }),
      }),
      defineAction<{ runs: string }, Comparison>({
        name: "runs.compare",
        title: "Line up the same tests across runs of one pack",
        method: "GET",
        path: "/compare",
        input: { type: "object", properties: { runs: RUN_LIST }, required: ["runs"] },
        handler: ({ runs }) => comparisonOf(services, runs),
      }),
      defineAction<{ runs: string }, { name: string; markdown: string }>({
        name: "reviews.export",
        title: "Export runs with their reviews as Markdown",
        method: "GET",
        path: "/export",
        input: { type: "object", properties: { runs: RUN_LIST }, required: ["runs"] },
        handler: ({ runs }) => {
          const c = comparisonOf(services, runs);
          return { name: exportName(c, "md"), markdown: toMarkdown(c, { link: (s) => s.url, now: new Date().toISOString() }) };
        },
      }),
    ];
  },
  routes(app, { services }) {
    // Downloads of the export: the Markdown with links to this server, or a zip with the
    // Markdown and its screenshots next to it.
    const dataDir = services.get(FILES_ROOT);
    const load = (req: FastifyRequest, reply: FastifyReply): Comparison | null => {
      const runs = (req.query as { runs?: unknown }).runs;
      try {
        if (typeof runs !== "string" || !new RegExp(RUN_LIST.pattern).test(runs)) throw new ActionError("invalid_input", RUN_LIST.description);
        return comparisonOf(services, runs);
      } catch (err) {
        const e = err instanceof ActionError ? err : new ActionError("internal", String(err), 500);
        void reply.code(e.status).send(errorBody(e.code, e.message));
        return null;
      }
    };
    const attachment = (name: string) => `attachment; filename="${name}"`;
    app.get("/export.md", async (req, reply) => {
      const c = load(req, reply);
      if (!c) return reply;
      const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
      const md = toMarkdown(c, { link: (s) => origin + s.url, now: new Date().toISOString() });
      return reply.type("text/markdown; charset=utf-8").header("content-disposition", attachment(exportName(c, "md"))).send(md);
    });
    app.get("/export.zip", async (req, reply) => {
      const c = load(req, reply);
      if (!c) return reply;
      const entries: ZipEntry[] = [];
      const md = toMarkdown(c, { link: (s, cell) => encodeURI(zipPath(s, cell)), now: new Date().toISOString() });
      const name = exportName(c, "md");
      entries.push({ name, data: Buffer.from(md, "utf8") });
      const seen = new Set<string>();
      for (const row of c.rows)
        for (const cell of row.cells) {
          if (!cell) continue;
          for (const s of cell.shots) {
            const at = zipPath(s, cell);
            if (seen.has(at)) continue;
            seen.add(at);
            try {
              entries.push({ name: at, data: readFileSync(path.join(dataDir, ...s.path.split("/"))) });
            } catch {
              // A file deleted by hand: the link stays, the image is missing.
            }
          }
        }
      return reply.type("application/zip").header("content-disposition", attachment(exportName(c, "zip"))).send(zip(entries));
    });
  },
});
