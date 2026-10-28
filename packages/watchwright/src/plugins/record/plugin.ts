import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { serviceKey } from "../../core/services.js";
import { FRAMES } from "../live/hub.js";
import { resolveParams } from "../packs/order.js";
import { PACKS } from "../packs/registry.js";
import { STEP_BY_NAME, type StepArgs } from "../packs/yaml/steps.js";
import type { Target } from "../packs/yaml/targets.js";
import { ENGINE, FILES_ROOT } from "../runs/plugin.js";
import { SECRETS } from "../secrets/plugin.js";
import { stepsYaml } from "./explore.js";
import { RecordNotReady, RecordSession, type RecordInput } from "./session.js";

// Record: click and type on the live view of a recording browser, and the steps appear as you go
// (docs/plans/step-4.md, section 4). A recording holds its pack's site like a run does, so runs of
// the site wait for it and it waits for them. Its events and frames use the recording's id where a
// run's would use the run id, so the live channel serves both.

/** Ended recordings stay readable this long, for the page that finishes them. */
const KEEP_ENDED_MS = 10 * 60_000;

export class Recordings {
  private readonly all = new Map<string, RecordSession>();

  add(r: RecordSession): void {
    this.all.set(r.id, r);
  }

  get(id: string): RecordSession {
    const r = this.all.get(id);
    if (!r) throw new ActionError("not_found", `No recording with id ${id}.`, 404);
    return r;
  }

  list(): RecordSession[] {
    return [...this.all.values()];
  }

  async stop(id: string, message: string | null = null): Promise<RecordSession> {
    const r = this.get(id);
    await r.stop(message);
    setTimeout(() => this.all.delete(id), KEEP_ENDED_MS).unref();
    return r;
  }

  async close(): Promise<void> {
    await Promise.all(this.list().map((r) => r.stop("The server closed.")));
  }
}

export const RECORDINGS = serviceKey<Recordings>("record.sessions");

/** True when a browser window can open on the server's machine (Record in a window). */
export function canOpenWindow(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32" || platform === "darwin") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

const REC = { type: "string", pattern: "^[0-9a-f]{8}$", description: "Recording id." } as const;
const STEP_ID = { type: "string", pattern: "^s[0-9]+$" } as const;
const STEP = { type: "object", description: "A YAML step's fields." } as const;
const XY = { x: { type: "number", minimum: 0 }, y: { type: "number", minimum: 0 } } as const;
const BUTTON = { type: "string", enum: ["left", "right", "middle"] } as const;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RecordNotReady) throw new ActionError("not_recording", err.message, 409);
    if (err instanceof ActionError) throw err;
    throw new ActionError("input_failed", err instanceof Error ? err.message.split("\n")[0]! : String(err), 400);
  }
}

function checkStep(name: string): void {
  if (!STEP_BY_NAME.has(name)) throw new ActionError("bad_step", `"${name}" isn't a step.`, 400);
}

export const recordPlugin = definePlugin({
  name: "record",
  setup({ services }) {
    services.provide(RECORDINGS, new Recordings());
  },
  async close({ services }) {
    await services.get(RECORDINGS).close();
  },
  actions: ({ services, events }) => {
    const recordings = services.get(RECORDINGS);
    const packs = services.get(PACKS);
    const engine = services.get(ENGINE);
    const frames = services.get(FRAMES);
    const dataDir = services.get(FILES_ROOT);
    return [
      defineAction({
        name: "record.list",
        title: "Recordings going or recently ended, and whether Record in a window can open a browser on this machine",
        method: "GET",
        path: "/record",
        handler: () => ({ canWindow: canOpenWindow(), recordings: recordings.list().map((r) => r.state()) }),
      }),
      defineAction<{ packId: string; testId?: string; replay?: number; line?: number; url?: string; params?: Record<string, unknown>; window?: boolean }>({
        name: "record.start",
        title: "Start recording: a browser with the pack's options, shown on the live view (or in a window), whose clicks and typing become steps",
        agent: {
          tool: "explore_start",
          say: "Opens the site in a browser the person can watch on the web page, for you to explore with explore_do and explore_look before writing a test. With testId and replay, the test's first steps run first. Stop it with explore_stop when done.",
        },
        method: "POST",
        path: "/record",
        status: 201,
        input: {
          type: "object",
          properties: {
            packId: { type: "string", pattern: "^[0-9a-f]{8}$" },
            testId: { type: "string", description: "The test the steps are for; with `replay`, its first steps run before recording starts." },
            replay: { type: "integer", minimum: 0, default: 0, description: "In a YAML test: how many of its top-level steps to run first (Record from here)." },
            line: { type: "integer", minimum: 1, description: "In a code test: run its code up to this line first (Record from here); it stops at the first Playwright call below it." },
            url: { type: "string", description: "Where to open; the site's base URL by default." },
            params: { type: "object", description: "Parameter values for the steps that run first." },
            window: { type: "boolean", default: false, description: "Open a browser window on the server's machine instead of the live view." },
          },
          required: ["packId"],
        },
        handler: async ({ packId, testId, replay = 0, line, url, params = {}, window = false }, { client }) => {
          const summary = packs.get(packId);
          if (!summary) throw new ActionError("not_found", `No pack with id ${packId}.`, 404);
          const pack = await packs.current(packId).catch((err: unknown) => {
            throw new ActionError("bad_pack", err instanceof Error ? err.message : String(err), 400);
          });
          if (window && !canOpenWindow()) throw new ActionError("no_window", "This machine has no screen to open a window on. Record on the live view instead.", 400);
          const test = testId === undefined ? undefined : pack.tests.find((t) => t.id === testId);
          if (testId !== undefined && !test) throw new ActionError("bad_test", `The pack has no test ${testId} (save the file first).`, 400);
          if (replay > 0 && !test?.yaml) throw new ActionError("bad_test", testId ? `${testId} isn't a YAML test of this pack (save the file first).` : "Record from here needs `testId`.", 400);
          if (line !== undefined && (!test || test.yaml)) throw new ActionError("bad_test", testId ? `${testId} isn't a code test; use \`replay\` for a YAML test.` : "`line` needs `testId`.", 400);
          const resolved = (() => {
            try {
              return resolveParams(pack.options.params ?? {}, params);
            } catch (err) {
              throw new ActionError("bad_params", err instanceof Error ? err.message : String(err), 400);
            }
          })();
          const session = new RecordSession(
            { pack, packId, siteKey: pack.options.site.key, testId: testId ?? null, replay, line: line ?? null, url: url ?? null, params: resolved, window, dataDir, startedBy: client },
            { events, frames, siteBusy: (k) => engine.siteBusy(k), holdSite: (k) => engine.holdSite(k), secret: (name) => services.get(SECRETS).get(name) },
          );
          recordings.add(session);
          events.append("record.started", { packId, testId: testId ?? null, window, startedBy: client }, { runId: session.id });
          session.start();
          return session.state();
        },
      }),
      defineAction<{ id: string }>({
        name: "record.get",
        title: "One recording: its status, pages and the steps so far",
        method: "GET",
        path: "/record/:id",
        input: { type: "object", properties: { id: REC }, required: ["id"] },
        handler: ({ id }) => recordings.get(id).state(),
      }),
      defineAction<{ id: string } & Record<string, unknown>>({
        name: "record.input",
        title: "Send a click, key, text or navigation from the live view to the recording's active page (x and y in page pixels); a move, up or wheel answers with the element now under the pointer (`hover`: its box, tag and best target)",
        method: "POST",
        path: "/record/:id/input",
        input: {
          type: "object",
          properties: {
            id: REC,
            type: { type: "string", enum: ["click", "dblclick", "down", "up", "move", "wheel", "key", "text", "goto", "back", "reload"] },
            ...XY,
            button: BUTTON,
            clickCount: { type: "integer", minimum: 1, maximum: 3, description: "For down and up: 2 on the second press of a double click." },
            deltaX: { type: "number" },
            deltaY: { type: "number" },
            key: { type: "string", minLength: 1, maxLength: 60, description: "A key in Playwright's form: Enter, a, Shift+Tab." },
            text: { type: "string", maxLength: 10000 },
            url: { type: "string", minLength: 1 },
          },
          required: ["id", "type"],
        },
        handler: async ({ id, ...input }) => {
          const i = input as RecordInput;
          const need = (keys: string[]) => {
            const missing = keys.filter((k) => (input as Record<string, unknown>)[k] === undefined);
            if (missing.length) throw new ActionError("bad_input", `A ${i.type} needs ${missing.join(" and ")}.`, 400);
          };
          if (["click", "dblclick", "down", "up", "move"].includes(i.type)) need(["x", "y"]);
          if (i.type === "wheel") need(["x", "y", "deltaX", "deltaY"]);
          if (i.type === "key") need(["key"]);
          if (i.type === "text") need(["text"]);
          if (i.type === "goto") need(["url"]);
          const hover = await guard(() => recordings.get(id).input(i));
          return { ok: true, hover };
        },
      }),
      defineAction<{ id: string; x: number; y: number }>({
        name: "record.pick",
        title: "The element under a point on the recording's page: its targets (best first), text, value and checked state, for Check and Wait for",
        method: "POST",
        path: "/record/:id/pick",
        input: { type: "object", properties: { id: REC, ...XY }, required: ["id", "x", "y"] },
        handler: async ({ id, x, y }) => {
          const found = await guard(() => recordings.get(id).pick(x, y));
          if (!found) throw new ActionError("nothing_there", "There's no element at that point.", 404);
          return found;
        },
      }),
      defineAction<{ id: string; steps: unknown[]; shot?: boolean }>({
        name: "record.do",
        title: "Run steps on the recording's active page, one at a time until one fails; each step that ran joins the recording's steps",
        agent: {
          tool: "explore_do",
          say: "Steps are YAML test steps as JSON ({ click: { role: button, name: Save } }, { fill: { target: { label: Email }, value: a@b.c } }, or a bare name such as reload). A target may be { ref: e4 }, from the last look's snapshot; it is saved as the element's own target. Answers each step's outcome, then the page as explore_look does.",
        },
        method: "POST",
        path: "/record/:id/do",
        input: {
          type: "object",
          properties: {
            id: REC,
            steps: { type: "array", minItems: 1, maxItems: 50, items: {}, description: "YAML test steps, as JSON. A target may be `{ ref: e4 }` from the snapshot." },
            shot: { type: "boolean", default: false, description: "Add a screenshot of the viewport to the look." },
          },
          required: ["id", "steps"],
        },
        handler: ({ id, steps, shot = false }) => guard(() => recordings.get(id).do(steps, shot)),
      }),
      defineAction<{ id: string; shot?: boolean }>({
        name: "record.look",
        title: "The recording's active page: its address, title and aria snapshot, whose elements carry refs (e4) steps can name; a screenshot when asked",
        agent: { tool: "explore_look", say: "Ask for shot: true when how the page looks matters, not just what is on it." },
        method: "GET",
        path: "/record/:id/look",
        input: { type: "object", properties: { id: REC, shot: { type: "boolean", default: false, description: "Add a screenshot of the viewport (JPEG, base64)." } }, required: ["id"] },
        handler: ({ id, shot = false }) => guard(() => recordings.get(id).look(shot)),
      }),
      defineAction<{ id: string; pageId: string }>({
        name: "record.page",
        title: "Make one of the recording's tabs the one the live view shows and input goes to",
        method: "POST",
        path: "/record/:id/page",
        input: { type: "object", properties: { id: REC, pageId: { type: "string", pattern: "^p[0-9]+$" } }, required: ["id", "pageId"] },
        handler: ({ id, pageId }) => {
          if (!recordings.get(id).setActivePage(pageId)) throw new ActionError("not_found", `The recording has no page ${pageId}.`, 404);
          return { ok: true };
        },
      }),
      defineAction<{ id: string; name: string; args?: StepArgs; targets?: Target[]; index?: number }>({
        name: "record.add-step",
        title: "Add a step to the recording (Check, Shot, Note, Wait for, or any step)",
        method: "POST",
        path: "/record/:id/steps",
        status: 201,
        input: {
          type: "object",
          properties: { id: REC, name: { type: "string" }, args: STEP, targets: { type: "array", description: "Other targets for the same element, to offer later." }, index: { type: "integer", minimum: 0 } },
          required: ["id", "name"],
        },
        handler: ({ id, name, args = {}, targets = [], index }) => {
          checkStep(name);
          const t = args.target as Target | undefined;
          return recordings.get(id).addStep(name, args, t === undefined ? targets : [t, ...targets.filter((o) => JSON.stringify(o) !== JSON.stringify(t))], index);
        },
      }),
      defineAction<{ id: string; step: string; name?: string; args?: StepArgs }>({
        name: "record.update-step",
        title: "Change a recorded step: its fields, or which of its targets it uses",
        method: "POST",
        path: "/record/:id/steps/:step",
        input: { type: "object", properties: { id: REC, step: STEP_ID, name: { type: "string" }, args: STEP }, required: ["id", "step"] },
        handler: ({ id, step, name, args }) => {
          if (name !== undefined) checkStep(name);
          const entry = recordings.get(id).updateStep(step, { ...(name !== undefined ? { name } : {}), ...(args !== undefined ? { args } : {}) });
          if (!entry) throw new ActionError("not_found", `The recording has no step ${step}.`, 404);
          return entry;
        },
      }),
      defineAction<{ id: string; step: string }>({
        name: "record.remove-step",
        title: "Remove a recorded step",
        method: "DELETE",
        path: "/record/:id/steps/:step",
        input: { type: "object", properties: { id: REC, step: STEP_ID }, required: ["id", "step"] },
        handler: ({ id, step }) => {
          if (!recordings.get(id).removeStep(step)) throw new ActionError("not_found", `The recording has no step ${step}.`, 404);
          return { ok: true };
        },
      }),
      defineAction<{ id: string }>({
        name: "record.stop",
        title: "End a recording and close its browser; returns its steps, and as `yaml` the list a test's `steps:` takes (Done puts them in the file, Cancel drops them)",
        agent: { tool: "explore_stop", say: "Only stop sessions you started. Put the yaml under a test's steps: and save it with write_pack_file, then check and run it." },
        method: "POST",
        path: "/record/:id/stop",
        input: { type: "object", properties: { id: REC }, required: ["id"] },
        handler: async ({ id }) => {
          const r = await recordings.stop(id);
          return { ...r.state(), yaml: stepsYaml(r.steps) };
        },
      }),
    ];
  },
});
