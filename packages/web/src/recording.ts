// Where Record's steps go and how they land: in a YAML test, after the step the cursor is on (the
// steps up to there run first, "Record from here"); in a code test, as `h` calls after the cursor's
// line. The page puts them into the open file at Done, as an unsaved edit.
import { insertStep, readTests, type NodePath } from "./stepsdoc";
import { describeTarget, stepsCode, type StepArgs, type Target } from "./yamlsteps";

/** A recorded step as the server keeps it. */
export interface RecordEntry {
  id: string;
  name: string;
  args: StepArgs;
  /** Targets for the same element, the one in use first. */
  targets: Target[];
  /** Where the click landed in the element, for "At this spot". */
  spot: { x: number; y: number } | null;
}

export type RecordStatus = "waiting" | "starting" | "replaying" | "recording" | "ended";

export interface RecordState {
  id: string;
  packId: string;
  testId: string | null;
  status: RecordStatus;
  message: string | null;
  window: boolean;
  viewport: { width: number; height: number };
  pages: { id: string; url: string }[];
  activePage: string | null;
  steps: RecordEntry[];
}

/** Where recorded steps go in a YAML test file. */
export interface YamlSpot {
  testId: string;
  listPath: NodePath;
  /** Index in the test's steps; also how many steps run before recording starts. */
  index: number;
}

/** The test the cursor is in and the place after the top-level step it is on (or before the first). */
export function yamlSpot(text: string, cursorLine: number): YamlSpot | null {
  const tests = readTests(text);
  if (!tests || tests.length === 0) return null;
  const test = tests.filter((t) => t.line <= cursorLine).at(-1) ?? tests[0]!;
  const index = test.steps.steps.filter((s) => s.line <= cursorLine).length;
  return { testId: test.id, listPath: test.steps.path, index };
}

/** The file with the steps put in at the spot, in order. */
export function insertYamlSteps(text: string, spot: Pick<YamlSpot, "listPath" | "index">, steps: readonly { name: string; args: StepArgs }[]): string {
  let out = text;
  steps.forEach((s, i) => (out = insertStep(out, spot.listPath, spot.index + i, s.name, s.args)));
  return out;
}

/**
 * The file with the steps written as code after line `line` (from 1), indented like the code
 * around it: the line itself, or the next line when the cursor is on a line that opens a block.
 */
export function insertCodeSteps(text: string, line: number, steps: readonly { name: string; args: StepArgs }[]): string {
  const lines = text.split("\n");
  const at = Math.max(0, Math.min(line, lines.length));
  const here = lines[at - 1] ?? "";
  const next = lines.slice(at).find((l) => l.trim() !== "") ?? "";
  const indentOf = (l: string) => /^\s*/.exec(l)![0];
  const indent = /[{(]\s*$/.test(here) ? (indentOf(next).length > indentOf(here).length ? indentOf(next) : `${indentOf(here)}  `) : indentOf(here);
  const code = stepsCode(steps.map((s) => ({ ...s, line: 0, col: 0 }))).map((l) => (l ? indent + l : l));
  return [...lines.slice(0, at), ...code, ...lines.slice(at)].join("\n");
}

/**
 * The code test the cursor is in: the last `test("id", …)` call of a known id that starts at or
 * above the cursor's line (from 1), or the first one of the file when the cursor is above them all.
 */
export function codeTestAt(text: string, cursorLine: number, ids: readonly string[]): string | null {
  const known = new Set(ids);
  const found: { id: string; line: number }[] = [];
  const re = /\btest\s*\(\s*(["'`])((?:(?!\1).)+)\1/g;
  for (let m = re.exec(text); m; m = re.exec(text)) if (known.has(m[2]!)) found.push({ id: m[2]!, line: text.slice(0, m.index).split("\n").length });
  return (found.filter((f) => f.line <= cursorLine).at(-1) ?? found[0])?.id ?? null;
}

/** A target menu label: `button "Save"`, and the kind of target for plain selectors. */
export function targetLabel(t: Target): string {
  return typeof t === "string" ? `CSS ${t}` : describeTarget(t);
}
