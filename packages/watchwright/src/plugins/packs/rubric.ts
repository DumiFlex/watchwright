// Review rubrics: what a person (or an agent) scores each attempt on. The pack gives the
// criteria; a test can add its own or drop some. Each criterion is a 1-to-N scale, named
// choices, or yes/no. A pack without a rubric gets one 1-to-5 "overall" criterion.

/** A criterion as a pack writes it in `pack({ rubric })` or a test's `review.add`. */
export interface RubricCriterion {
  /** Letters, digits, dashes and underscores; unique in the rubric. */
  id: string;
  title: string;
  description?: string;
  /** A 1-to-N scale (2 to 10). The default when neither `choices` nor `yesNo` is given: 5. */
  scale?: number;
  /** Named choices, in order. */
  choices?: readonly string[];
  /** Yes or no. */
  yesNo?: boolean;
}

/** A test's changes to the pack's rubric. */
export interface TestReview {
  add?: readonly RubricCriterion[];
  /** Ids of pack criteria this test isn't scored on. */
  drop?: readonly string[];
}

/** A criterion with its kind worked out, as the API and the web app see it. */
export type Criterion = { id: string; title: string; description: string | null } & (
  | { kind: "scale"; scale: number }
  | { kind: "choices"; choices: string[] }
  | { kind: "yesNo" }
);

export type Score = number | string | boolean;

export const DEFAULT_RUBRIC: readonly RubricCriterion[] = [{ id: "overall", title: "Overall", scale: 5 }];

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** What's wrong with a list of criteria, one line each; `where` names it ("rubric", "test S1 review.add"). */
export function rubricProblems(list: unknown, where: string): string[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return [`\`${where}\` must be a list of criteria.`];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, c] of (list as unknown[]).entries()) {
    const at = `\`${where}\` entry ${i + 1}`;
    if (!c || typeof c !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    const k = c as Partial<RubricCriterion>;
    if (typeof k.id !== "string" || !ID.test(k.id)) problems.push(`${at} needs an \`id\` of letters, digits, dashes or underscores.`);
    else if (seen.has(k.id)) problems.push(`${at}: the id "${k.id}" is used twice.`);
    else seen.add(k.id);
    if (typeof k.title !== "string" || k.title.trim() === "") problems.push(`${at} needs a \`title\`.`);
    const kinds = [k.scale !== undefined, k.choices !== undefined, k.yesNo !== undefined].filter(Boolean).length;
    if (kinds > 1) problems.push(`${at} can be a scale, choices or yes/no, not more than one.`);
    if (k.scale !== undefined && (!Number.isInteger(k.scale) || k.scale < 2 || k.scale > 10)) problems.push(`${at}: \`scale\` must be a whole number from 2 to 10.`);
    if (k.choices !== undefined && (!Array.isArray(k.choices) || k.choices.length < 2 || k.choices.some((x) => typeof x !== "string" || x === "") || new Set(k.choices).size !== k.choices.length))
      problems.push(`${at}: \`choices\` must be two or more different names.`);
    if (k.yesNo !== undefined && k.yesNo !== true) problems.push(`${at}: \`yesNo\` can only be true.`);
  }
  return problems;
}

export function resolveCriterion(c: RubricCriterion): Criterion {
  const base = { id: c.id, title: c.title, description: c.description ?? null };
  if (c.choices) return { ...base, kind: "choices", choices: [...c.choices] };
  if (c.yesNo) return { ...base, kind: "yesNo" };
  return { ...base, kind: "scale", scale: c.scale ?? 5 };
}

/** The criteria one test is scored on: the pack's (or the default), minus `drop`, plus `add`. */
export function rubricFor(pack: readonly RubricCriterion[] | undefined, review: TestReview | undefined): Criterion[] {
  const drop = new Set(review?.drop ?? []);
  const own = (pack && pack.length > 0 ? pack : DEFAULT_RUBRIC).filter((c) => !drop.has(c.id));
  const added = (review?.add ?? []).filter((c) => !own.some((o) => o.id === c.id));
  return [...own, ...added].map(resolveCriterion);
}

/** Why a set of scores doesn't fit the criteria, or null. Missing scores are fine (not scored yet); null clears one. */
export function scoreProblem(criteria: readonly Criterion[], scores: Record<string, unknown>): string | null {
  for (const [id, v] of Object.entries(scores)) {
    const c = criteria.find((x) => x.id === id);
    if (!c) return `"${id}" isn't a criterion of this test (${criteria.map((x) => x.id).join(", ")}).`;
    if (v === null) continue;
    if (c.kind === "scale" && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= c.scale)) return `"${id}" takes a whole number from 1 to ${c.scale}.`;
    if (c.kind === "choices" && !c.choices.includes(v as string)) return `"${id}" takes one of: ${c.choices.join(", ")}.`;
    if (c.kind === "yesNo" && typeof v !== "boolean") return `"${id}" takes true or false.`;
  }
  return null;
}
