import { createInterface } from "node:readline/promises";
import type { ActionInfo } from "../actions/registry.js";
import type { RunDigest, WaitResult, Happening } from "../plugins/runs/digest.js";
import type { ResultDocument } from "../plugins/runs/results.js";
import { actionHelp, parseActionArgs, UsageError } from "./args.js";
import { ApiError, type Client, NoServer, resolvePack } from "./client.js";

// The CLI's commands that talk to a running server: a few written for people and agents
// (`status`, `run`, `wait`, `results`, `actions`) and one generated command per action
// (docs/plans/step-5.md, section 3).

/** Exit codes, the same for every command. */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  noServer: 3,
  /** The run ended with a failed or broken attempt (or was stopped). */
  runFailed: 4,
  /** The run is paused: on a broken attempt, or by a person. */
  runPaused: 5,
  /** The wait ran out while the run still goes. */
  runGoing: 6,
  /** The action waits for the person's approval on the web page. */
  approvalWaiting: 7,
} as const;

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  /** True when a person can answer questions (a terminal on both ends). */
  interactive: boolean;
  /** Asks a yes/no question. */
  confirm: (question: string) => Promise<boolean>;
}

export const processIo: Io = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  async confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  },
};

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** Runs a command and turns errors into messages and exit codes. */
export async function guarded(io: Io, asJson: boolean, fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(err.message);
      return EXIT.usage;
    }
    if (err instanceof NoServer) {
      io.err(asJson ? json({ error: { code: "no_server", message: err.message } }) : err.message);
      return EXIT.noServer;
    }
    if (err instanceof ApiError) {
      io.err(asJson ? json({ error: { code: err.code, message: err.message, ...(err.detail !== undefined ? { detail: err.detail } : {}) } }) : `${err.message} (${err.code})`);
      return EXIT.failed;
    }
    throw err;
  }
}

/** The action a command names: `runs presets save` or `runs.presets.save`, with the arguments after it. */
export function findAction(actions: readonly ActionInfo[], words: readonly string[]): { action: ActionInfo; rest: string[] } | null {
  if (words[0]?.includes(".")) {
    const a = actions.find((x) => x.name === words[0]);
    return a ? { action: a, rest: words.slice(1) } : null;
  }
  for (let n = Math.min(words.length, 4); n >= 2; n--) {
    const name = words.slice(0, n).join(".");
    const a = actions.find((x) => x.name === name);
    if (a) return { action: a, rest: words.slice(n) };
  }
  return null;
}

const PACK_PATH = /^\/api\/v1\/packs\/:id(\/|$)/;

/** A generated command: one action, its input from the arguments, its data printed as JSON. */
export async function actionCommand(client: Client, io: Io, words: readonly string[], command: string): Promise<number> {
  const actions = await client.listActions();
  const found = findAction(actions, words);
  if (!found) {
    const group = words[0] ?? "";
    const near = actions.filter((a) => a.name.startsWith(`${group}.`)).map((a) => `  watchwright ${a.name.split(".").join(" ")}  ${a.title}`);
    io.err(near.length ? `Unknown command "${words.join(" ")}". The ${group} commands:\n${near.join("\n")}` : `Unknown command "${words.join(" ")}". See \`watchwright --help\` and \`watchwright actions\`.`);
    return EXIT.usage;
  }
  const { action, rest } = found;
  let inputFile: string | undefined;
  const { input, own } = parseActionArgs(action, rest, { ownFlags: ["help", "json"], ownValues: { input: (v) => (inputFile = v) } });
  if (own.has("help")) {
    io.out(actionHelp(action, `${command} ${action.name.split(".").join(" ")}`));
    return EXIT.ok;
  }
  const body = inputFile === undefined ? {} : await readInput(inputFile);
  const merged: Record<string, unknown> = { ...body, ...input };
  // Packs by name or folder, where an action wants a pack id.
  const packKey = "packId" in action.input.properties ? "packId" : PACK_PATH.test(action.path) ? "id" : null;
  if (packKey && typeof merged[packKey] === "string" && !/^[0-9a-f]{8}$/.test(merged[packKey])) {
    const p = await resolvePack(client, merged[packKey]);
    io.err(`Pack "${p.name}" (${p.id}).`);
    merged[packKey] = p.id;
  }
  // A person at a terminal answers here; anywhere else the server asks the person on the web page.
  let confirmed = false;
  if (action.destructive && io.interactive) {
    if (!(await io.confirm(`${action.title}: ${Object.values(merged).map(String).join(" ")}. Go ahead?`))) {
      io.err("Nothing was changed.");
      return EXIT.failed;
    }
    confirmed = true;
  }
  const data = await client.call(action, merged, undefined, confirmed);
  const held = approvalOf(data);
  if (held) return approvalWait(client, io, held.id, held.message, 50);
  io.out(json(data));
  return EXIT.ok;
}

interface ApprovalInfo {
  id: string;
  summary: string;
  status: "waiting" | "approved" | "refused" | "expired" | "failed";
  result: unknown;
  error: { code: string; message: string } | null;
}

/** The approval an action answered with instead of running (202), if any. */
function approvalOf(data: unknown): { id: string; message: string } | null {
  if (!data || typeof data !== "object" || !("approval" in data)) return null;
  const a = (data as { approval: ApprovalInfo; message?: string }).approval;
  return a?.status === "waiting" ? { id: a.id, message: (data as { message?: string }).message ?? a.summary } : null;
}

/** Waits on an approval for up to `seconds`, then says how it was answered. */
export async function approvalWait(client: Client, io: Io, id: string, message: string | null, seconds: number): Promise<number> {
  if (message) io.err(message);
  const a = await client.callName<ApprovalInfo>("approvals.wait", { id, timeout: Math.min(110, seconds) });
  switch (a.status) {
    case "approved":
      io.out(json(a.result));
      return EXIT.ok;
    case "waiting":
      io.err(`Still waiting for the person's approval. Wait again with \`watchwright approvals wait ${id}\`, or ask them to answer it on the web page (${client.base}).`);
      return EXIT.approvalWaiting;
    case "failed":
      io.err(`Approved, but it failed: ${a.error?.message ?? "no reason given"} (${a.error?.code ?? "failed"})`);
      return EXIT.failed;
    default:
      io.err(a.status === "refused" ? `The person refused: ${a.summary}. Nothing was changed.` : `Nobody answered the approval in time. Nothing was changed.`);
      return EXIT.failed;
  }
}

async function readInput(file: string): Promise<Record<string, unknown>> {
  const { readFileSync } = await import("node:fs");
  const text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new UsageError(`--input ${file} must hold a JSON object.`);
  }
}

/** `watchwright actions`: every action, grouped by plugin. */
export async function actionsCommand(client: Client, io: Io, asJson: boolean): Promise<number> {
  const actions = await client.listActions();
  if (asJson) {
    io.out(json(actions));
    return EXIT.ok;
  }
  const width = Math.max(...actions.map((a) => a.name.length)) + 2;
  for (const a of actions) io.out(`${a.name.split(".").join(" ").padEnd(width)}${a.title}${a.destructive ? " (asks first)" : ""}`);
  io.out(`\nRun one as \`watchwright <words> [args] [--options]\`; \`--help\` after it lists its options.`);
  return EXIT.ok;
}

interface RunListItem {
  id: string;
  packName: string;
  status: string;
  label: string;
  startedBy: string;
  counts: Record<string, number> & { planned: number };
}

/** `watchwright status`: the server, and the runs going or queued. */
export async function statusCommand(client: Client, io: Io, asJson: boolean): Promise<number> {
  const health = await client.health();
  if (!health) throw new NoServer(`No Watchwright answers at ${client.base}. Start it with \`watchwright serve\`.`);
  const runs = await client.callName<RunListItem[]>("runs.list", { status: "queued,running,pausing,paused" });
  if (asJson) {
    io.out(json({ server: { url: client.base, version: health.version, dataDir: health.dataDir }, runs }));
    return EXIT.ok;
  }
  io.out(`Watchwright ${health.version} is running at ${client.base}`);
  io.out(`Data folder: ${health.dataDir}`);
  if (runs.length === 0) io.out("No runs are going.");
  for (const r of runs) io.out(`${r.id}  ${r.status.padEnd(8)}  ${done(r.counts)}/${r.counts.planned}  ${r.packName}${r.label ? ` "${r.label}"` : ""}  started by ${r.startedBy}  ${client.base}#/runs/${r.id}`);
  return EXIT.ok;
}

const done = (c: Record<string, number>) => ["passed", "failed", "broken", "skipped", "stopped"].reduce((n, k) => n + (c[k] ?? 0), 0);

/** The exit code a run's state gives. */
export function exitOf(reason: WaitResult["reason"], run: RunDigest): number {
  if (reason === "paused") return EXIT.runPaused;
  if (reason === "timeout" || reason === "gone") return EXIT.runGoing;
  if (run.status === "failed_to_start") return EXIT.failed;
  const bad = (run.counts.failed ?? 0) + (run.counts.broken ?? 0) + (run.counts.stopped ?? 0) + (run.counts.interrupted ?? 0);
  return run.status === "finished" && bad === 0 ? EXIT.ok : EXIT.runFailed;
}

export function describeHappening(h: Happening): string {
  const t = h.time.slice(11, 19);
  switch (h.type) {
    case "attempt.finished": {
      const err = typeof h.error === "string" && h.error ? `: ${h.error.split("\n")[0]}` : "";
      const flags = Array.isArray(h.flags) && h.flags.length ? ` [${h.flags.join(", ")}]` : "";
      return `${t}  ${String(h.testId)}${Number(h.number) > 1 ? ` #${String(h.number)}` : ""} ${String(h.status)}${err}${flags}`;
    }
    case "run.paused":
      return `${t}  paused${h.reason === "broken" ? ` on broken ${String(h.testId)}: retry or skip` : h.by ? ` by ${String(h.by)}` : ""}`;
    case "run.resumed":
      return `${t}  resumed`;
    case "run.started":
      return `${t}  started`;
    case "run.stopping":
      return `${t}  stopping ${String(h.when)}`;
    case "run.finished":
      return `${t}  run ${String(h.status)}`;
    case "run.interrupted":
      return `${t}  interrupted: ${String(h.message ?? h.reason)}`;
    default:
      return `${t}  ${h.type}`;
  }
}

function describeEnd(client: Client, w: WaitResult): string {
  const r = w.run;
  const counts = Object.entries(r.counts)
    .filter(([k]) => k !== "planned")
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  const what =
    w.reason === "paused"
      ? r.live?.pauseReason === "broken"
        ? `Paused on broken ${r.live.testId ?? "attempt"}: retry or skip (watchwright runs control ${r.id} --do retry).`
        : `Paused${r.live?.pausedBy ? ` by ${r.live.pausedBy}` : ""}.`
      : w.reason === "ended"
        ? `Run ${r.status}.`
        : `Still ${r.status}; wait again with --after ${w.cursor}.`;
  return `${what} ${counts || "No attempts yet"}. ${client.base}#/runs/${r.id}`;
}

/** One wait, or several in a row up to `totalS`, printing what happened. */
async function waitLoop(client: Client, io: Io, id: string, after: number | undefined, totalS: number, asJson: boolean): Promise<number> {
  const end = Date.now() + totalS * 1000;
  let cursor = after;
  const all: Happening[] = [];
  for (;;) {
    const left = Math.max(0, (end - Date.now()) / 1000);
    const w = await client.callName<WaitResult>("runs.wait", { id, ...(cursor !== undefined ? { after: cursor } : {}), timeout: Math.min(110, left) });
    cursor = w.cursor;
    if (asJson) all.push(...w.happened);
    else for (const h of w.happened) io.out(describeHappening(h));
    if (w.reason !== "timeout" || Date.now() >= end) {
      if (asJson) io.out(json({ ...w, happened: all }));
      else io.out(describeEnd(client, w));
      return exitOf(w.reason, w.run);
    }
  }
}

export interface RunOpts {
  params: Record<string, string>;
  preset?: string;
  label?: string;
  attempts?: number;
  trace?: string;
  video?: boolean;
  pauseOnBroken?: boolean;
  wait: boolean;
  timeout: number;
  json: boolean;
}

/** `watchwright run <pack> [test…]`. */
export async function runCommand(client: Client, io: Io, pack: string, tests: string[], o: RunOpts): Promise<number> {
  const p = await resolvePack(client, pack);
  const body: Record<string, unknown> = { packId: p.id };
  if (tests.length) body.tests = tests;
  if (Object.keys(o.params).length) body.params = o.params;
  for (const k of ["preset", "label", "attempts", "trace", "video", "pauseOnBroken"] as const) if (o[k] !== undefined) body[k] = o[k];
  const run = await client.callName<{ id: string; counts: { planned: number } }>("runs.start", body);
  if (o.json && !o.wait) {
    io.out(json(run));
    return EXIT.ok;
  }
  (o.json ? io.err : io.out)(`Started run ${run.id} of "${p.name}". Watch it at ${client.base}#/runs/${run.id}`);
  if (!o.wait) return EXIT.ok;
  return waitLoop(client, io, run.id, undefined, o.timeout, o.json);
}

/** `watchwright wait <run>`. */
export function waitCommand(client: Client, io: Io, id: string, after: number | undefined, timeoutS: number, asJson: boolean): Promise<number> {
  return waitLoop(client, io, id, after, timeoutS, asJson);
}

/** `watchwright results <run> [--attempt id]`. */
export async function resultsCommand(client: Client, io: Io, id: string, attempt: string | undefined, asJson: boolean): Promise<number> {
  if (attempt) {
    const doc = await client.callName<ResultDocument>("runs.attempt", { id, attemptId: attempt });
    if (asJson) {
      io.out(json(doc));
      return EXIT.ok;
    }
    io.out(`${doc.test.id} (${doc.test.title}) attempt ${doc.attempt.number}, try ${doc.attempt.try}: ${doc.status}`);
    if (doc.error) io.out(`Error (${doc.error.kind}): ${doc.error.message}`);
    for (const f of doc.flags) io.out(`Flag ${f.kind}: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    for (const n of doc.notes) io.out(`Note: ${n}`);
    for (const [k, m] of Object.entries(doc.metrics)) io.out(`Metric ${k}: ${m.value}${m.unit ? ` ${m.unit}` : ""}`);
    for (const a of doc.artifacts) io.out(`File ${a.kind}: ${a.path} (${a.contentType}, ${Math.round(a.size / 1024)} KB)`);
    return EXIT.ok;
  }
  const r = await client.callName<RunDigest>("runs.summary", { id });
  if (asJson) {
    io.out(json(r));
    return EXIT.ok;
  }
  io.out(`Run ${r.id} of "${r.pack.name}"${r.label ? ` "${r.label}"` : ""}: ${r.status}, started by ${r.startedBy}. ${client.base}#/runs/${r.id}`);
  for (const a of r.attempts) {
    const flags = [a.robot ? `${a.robot} robot` : "", a.findings ? `${a.findings} finding${a.findings > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
    io.out(`${a.id}  ${(a.parentId ? "  " : "") + a.testId}${a.number > 1 ? ` #${a.number}` : ""}  ${a.status}${a.error ? `  ${a.error}` : ""}${flags ? `  [${flags}]` : ""}`);
  }
  if (r.pending) io.out(`${r.pending} attempts still to run.`);
  return exitOf(r.status === "paused" ? "paused" : ["queued", "running", "pausing"].includes(r.status) ? "timeout" : "ended", r);
}
