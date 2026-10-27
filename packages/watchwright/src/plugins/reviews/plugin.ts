import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { PACKS } from "../packs/registry.js";
import { rubricFor, scoreProblem, type Criterion, type Score } from "../packs/rubric.js";
import { ENGINE } from "../runs/plugin.js";
import { REVIEWS_MIGRATION_SQL, ReviewsRepo, type Review } from "./repo.js";

// Reviews: people and agents score each attempt on the run's rubric and leave a note. One review
// per attempt per reviewer; the web app reviews as "web", an agent as its client name.

export const REVIEWS = serviceKey<ReviewsRepo>("reviews.repo");

const RUN_ID = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Run id." } as const;
const ATTEMPT_ID = { type: "string", pattern: "^[0-9a-f]{12}$", description: "Attempt id." } as const;

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
    const packs = services.get(PACKS);

    const attemptOf = (runId: string, attemptId: string) => {
      const run = engine.get(runId);
      const attempt = run?.attempts.find((a) => a.id === attemptId) ?? (run ? engine.result(runId, attemptId) : null);
      if (!run || !attempt) throw new ActionError("not_found", `No attempt ${attemptId} in run ${runId}.`, 404);
      const testId = "testId" in attempt ? attempt.testId : attempt.test.id;
      return { run, testId };
    };
    /** The run's own rubric for the test, else the pack's current one, else the default. */
    const criteriaFor = (runId: string, packId: string, testId: string): Criterion[] =>
      repo.rubrics(runId)?.[testId] ?? packs.get(packId)?.tests.find((t) => t.id === testId)?.rubric ?? rubricFor(undefined, undefined);

    return [
      defineAction<{ id: string; attemptId: string }, AttemptReviews>({
        name: "reviews.get",
        title: "Get an attempt's rubric and reviews",
        method: "GET",
        path: "/runs/:id/attempts/:attemptId/review",
        input: { type: "object", properties: { id: RUN_ID, attemptId: ATTEMPT_ID }, required: ["id", "attemptId"] },
        handler: ({ id, attemptId }) => {
          const { run, testId } = attemptOf(id, attemptId);
          return { criteria: criteriaFor(id, run.packId, testId), reviews: repo.forAttempt(attemptId) };
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
          const problem = scoreProblem(criteriaFor(id, run.packId, testId), scores);
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
          return Object.fromEntries(tests.map((t) => [t, criteriaFor(id, run.packId, t)]));
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
    ];
  },
});
