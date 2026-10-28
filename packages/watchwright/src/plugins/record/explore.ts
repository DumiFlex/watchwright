import type { Page } from "playwright";
import { stringify } from "yaml";
import { parseTestFile } from "../packs/yaml/parse.js";
import { STEP_BY_NAME, type Step, type StepArgs } from "../packs/yaml/steps.js";
import type { Target } from "../packs/yaml/targets.js";
import { sameTarget, snapshotOf } from "./candidates.js";

// Exploring: an agent drives a recording with YAML steps instead of clicks, and reads the page as
// an aria snapshot whose elements carry refs (`[ref=e4]`). A step may name an element by its ref;
// the ref is swapped for the element's own targets before the step runs, so the steps it leaves
// behind are steps a test can keep (docs/plans/step-5.md, section 4.1).

/** Something an agent wrote that can't run, said so it can fix it. */
export class ExploreError extends Error {}

/** What an agent sees of the page. */
export interface Look {
  url: string;
  title: string;
  /** The aria snapshot, with a `[ref=e…]` on each element a step can name. */
  snapshot: string;
  /** The viewport, when asked for. */
  shot?: { mimeType: "image/jpeg"; encoding: "base64"; data: string };
}

const MAX_SNAPSHOT = 60_000;

export async function lookAt(page: Page, shot: boolean): Promise<Look> {
  let snapshot = await page.ariaSnapshot({ mode: "ai", timeout: 5000 }).catch((err: unknown) => `(No snapshot: ${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
  if (snapshot.length > MAX_SNAPSHOT) snapshot = `${snapshot.slice(0, MAX_SNAPSHOT)}\n… (cut at ${MAX_SNAPSHOT} characters)`;
  const look: Look = { url: page.url(), title: await page.title().catch(() => ""), snapshot };
  if (shot) {
    const bytes = await page.screenshot({ type: "jpeg", quality: 70, timeout: 5000 }).catch(() => null);
    if (bytes) look.shot = { mimeType: "image/jpeg", encoding: "base64", data: bytes.toString("base64") };
  }
  return look;
}

const isRef = (v: unknown): v is { ref: string } => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { ref?: unknown }).ref === "string";

/**
 * A raw step with every `{ ref: e4 }` swapped for the element's best target. Returns the targets
 * that pick out each element, best first, in the order the refs came.
 */
export async function resolveRefs(page: Page, raw: unknown): Promise<{ value: unknown; found: Target[][] }> {
  const found: Target[][] = [];
  const walk = async (v: unknown): Promise<unknown> => {
    if (isRef(v)) {
      const targets = await targetsOfRef(page, v.ref);
      found.push(targets);
      return targets[0];
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const x of v) out.push(await walk(x));
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = await walk(x);
      return out;
    }
    return v;
  };
  return { value: await walk(raw), found };
}

async function targetsOfRef(page: Page, ref: string): Promise<Target[]> {
  if (!/^[a-z]*\d+$/i.test(ref)) throw new ExploreError(`"${ref}" isn't a ref. Refs come from the snapshot, like e4.`);
  const handle = await page
    .getByRef(ref)
    .elementHandle({ timeout: 2000 })
    .catch(() => null);
  if (!handle) throw new ExploreError(`There's no element ${ref} on the page now. Look again for fresh refs.`);
  try {
    const { targets } = await snapshotOf(page, handle);
    if (targets.length === 0) throw new ExploreError(`Element ${ref} has no target that picks it out alone. Name it with a target of your own (role and name, label, text, test id or css).`);
    return targets;
  } finally {
    await handle.dispose().catch(() => undefined);
  }
}

/** One step as an agent sends it (`{ click: { role: button, name: Save } }`, or `reload`), checked as a test file would check it. */
export function parseStep(raw: unknown): Step {
  if (typeof raw !== "string" && (!raw || typeof raw !== "object" || Array.isArray(raw))) throw new ExploreError("A step is a name with its value, such as { click: { role: button, name: Save } }, or a bare name such as reload.");
  const { value, problems } = parseTestFile(stringify({ id: "explore", steps: [raw] }));
  if (problems.length > 0) throw new ExploreError(problems.map((p) => p.message).join(" "));
  const step = value[0]?.steps[0];
  if (!step) throw new ExploreError("The step is empty.");
  return step;
}

/** The args a recording keeps for a step: nested steps as YAML items, as a person would write them. */
export function plainArgs(name: string, args: StepArgs): StepArgs {
  const def = STEP_BY_NAME.get(name);
  const out: StepArgs = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined) out[k] = def?.fields[k]?.t === "steps" && Array.isArray(v) ? (v as Step[]).map((s) => stepItem(s.name, plainArgs(s.name, s.args))) : v;
  return out;
}

/** A step as a YAML list item: `reload`, `{ click: "#save" }` or `{ fill: { target, value } }`. */
export function stepItem(name: string, args: StepArgs): unknown {
  const def = STEP_BY_NAME.get(name);
  const keys = Object.keys(args).filter((k) => args[k] !== undefined);
  if (def?.bare && keys.length === 0) return name;
  const short = def?.short;
  const value = short ? args[short] : undefined;
  // A map under the short field would read as the step's fields when it has a field's name.
  const readsAsFields = !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).some((k) => k in (def?.fields ?? {}));
  if (short && keys.length === 1 && keys[0] === short && !readsAsFields) return { [name]: value };
  return { [name]: Object.fromEntries(keys.map((k) => [k, args[k]])) };
}

/** Steps as the YAML list a test's `steps:` takes. */
export function stepsYaml(steps: readonly { name: string; args: StepArgs }[]): string {
  return steps.length === 0 ? "[]\n" : stringify(steps.map((s) => stepItem(s.name, s.args)));
}

/** The targets the step keeps: those of the element its target ref named, else its own target. */
export function targetsOf(args: StepArgs, found: readonly Target[][]): Target[] {
  const t = args.target as Target | undefined;
  if (t === undefined) return [];
  return found.find((list) => list[0] !== undefined && sameTarget(list[0], t)) ?? [t];
}
