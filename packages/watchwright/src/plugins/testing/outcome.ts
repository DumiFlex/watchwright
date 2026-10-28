import type { Outcome } from "../packs/api.js";
import { AttemptAborted, StopNow } from "../../jobs/control.js";
import type { FlagRecord } from "../../jobs/recorder.js";

export interface AttemptError {
  /** assertion: an expect failed. step: the harness couldn't do a step. skipped: the test skipped itself. timeout, exception, stopped. */
  kind: "assertion" | "step" | "timeout" | "exception" | "stopped" | "skipped";
  message: string;
  stack: string | null;
}

function errorOf(kind: AttemptError["kind"], err: unknown): AttemptError {
  if (err instanceof Error) return { kind, message: err.message, stack: err.stack ?? null };
  return { kind, message: String(err), stack: null };
}

/**
 * The outcome of an attempt from how its body ended and the flags it raised
 * (docs/research/step-1-engine.md, decision 2).
 */
export function classify(input: { error: unknown; flags: readonly FlagRecord[]; stopped: boolean }): { status: Outcome; error: AttemptError | null } {
  const { error, flags, stopped } = input;
  if (stopped || error instanceof StopNow) return { status: "stopped", error: { kind: "stopped", message: "The run was stopped during this attempt.", stack: null } };
  if (error !== undefined) {
    if (error instanceof Error && error.name === "SkipTest") return { status: "skipped", error: { kind: "skipped", message: error.message, stack: null } };
    if (error instanceof AttemptAborted) return { status: "broken", error: errorOf("timeout", error) };
    if (error instanceof Error && "matcherResult" in error) return { status: "failed", error: errorOf("assertion", error) };
    if (error instanceof Error && error.name === "StepError") return { status: "broken", error: errorOf("step", error) };
    return { status: "broken", error: errorOf("exception", error) };
  }
  const robot = flags.find((f) => f.kind === "robot");
  if (robot) return { status: "broken", error: { kind: "step", message: `Robot flag "${robot.name}"${robot.detail ? `: ${robot.detail}` : ""}`, stack: null } };
  if (flags.some((f) => f.kind === "finding")) return { status: "failed", error: null };
  return { status: "passed", error: null };
}
