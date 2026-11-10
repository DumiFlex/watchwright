import type { FlagKind, PackRunOptions, ParamDef } from "../api.js";
import type { RubricCriterion } from "../rubric.js";
import { bool, int, list, num, obj, oneOrMore, req, str, type Shape } from "./shape.js";

// The shape of `pack.yaml` (see pack-yaml.ts). Kept apart from it so the web app can use it.

type CollectorEntry =
  | "consoleErrors"
  | "failedRequests"
  | "responses"
  | { consoleErrors?: { warnings?: boolean }; failedRequests?: { match?: string }; responses?: { match?: string; bodies?: boolean; maxBody?: number } };

export interface PackYaml {
  name: string;
  description?: string;
  site: { key: string; baseURL?: string; signIn?: "saved"; network?: string };
  browser?: { name?: "chromium" | "firefox" | "webkit"; viewport?: { width: number; height: number }; headless?: boolean; context?: Record<string, unknown> };
  params?: Record<string, ParamDef>;
  flags?: Record<string, FlagKind>;
  tests?: string | string[];
  run?: PackRunOptions;
  rubric?: RubricCriterion[];
  collectors?: CollectorEntry[];
  dashboard?: unknown;
  share?: unknown;
  setup?: unknown[];
  teardown?: unknown[];
  afterTask?: unknown[];
  beforeEach?: unknown[];
  afterEach?: unknown[];
  tasks?: Record<string, { title?: string; description?: string; readOnly?: boolean; timeout?: number; steps: unknown[] }>;
}

const TASK = obj({
  title: str("What the task is called on the pack page."),
  description: str(),
  readOnly: bool("True when the task leaves the site as it found it: a paused run then goes on where it was."),
  timeout: int("Time limit in ms.", { min: 1 }),
  steps: req({ t: "steps", doc: "What the task does, step by step." }),
});

const size = obj({ width: req(int(undefined, { min: 1 })), height: req(int(undefined, { min: 1 })) });

const CONTEXT = obj(
  {
    locale: str("A locale such as en-GB."),
    timezoneId: str("A time zone such as Europe/London."),
    colorScheme: str(undefined, { enum: ["light", "dark", "no-preference"] }),
    reducedMotion: str(undefined, { enum: ["reduce", "no-preference"] }),
    userAgent: str(),
    deviceScaleFactor: num(undefined, { min: 0.1 }),
    isMobile: bool(),
    hasTouch: bool(),
    javaScriptEnabled: bool(),
    ignoreHTTPSErrors: bool(),
    offline: bool(),
    extraHTTPHeaders: obj({}, "Headers sent with every request.", { extra: str() }),
    permissions: list(str(), "Browser permissions to grant: geolocation, notifications, …"),
    geolocation: obj({ latitude: req(num()), longitude: req(num()), accuracy: num() }),
    httpCredentials: obj({ username: req(str()), password: req(str()) }, "Use ${env.…} values here rather than the password itself."),
    storageState: str("A storage state file (cookies and local storage), relative to the pack folder."),
  },
  "Playwright browser context options.",
);

const PARAM = obj({
  type: str(undefined, { enum: ["string", "number", "boolean"] }),
  choices: list({ t: "scalar" }),
  default: { t: "scalar" },
  description: str(),
  labels: obj({}, "Display names for choices.", { extra: str() }),
});

const CRITERION = obj({ id: req(str()), title: req(str()), description: str(), scale: int(undefined, { min: 2, max: 10 }), choices: list(str()), yesNo: bool() });

const RUN = obj(
  {
    pauseOnBroken: bool("Pause the run when an attempt ends broken (default true)."),
    pauseLimitMinutes: num("Minutes a broken pause waits before it skips (default 20).", { min: 0 }),
    testTimeout: int("Time limit per attempt in ms (default 30 minutes).", { min: 0 }),
    trace: str("Which attempts keep a trace (default problems).", { enum: ["problems", "always", "never"] }),
    video: { t: "union", of: [bool(), str(undefined, { enum: ["always", "problems", "never"] })], doc: "Which attempts keep a video: always (default, also true), problems (failed or broken) or never (also false)." },
    runVideo: bool("Record one video of the whole run, of what the live view follows (default false)."),
    followVideo: bool("Record each attempt's video of the page the live view follows, as one video across tabs and popups, instead of one per page (default false)."),
    videoQuality: str("How sharp this pack's videos are, over the server's Video quality setting: high (for videos people watch), full, compact or small.", { enum: ["high", "full", "compact", "small"] }),
    videoFps: int("At most this many frames a second in this pack's videos, over the server's Frame rate setting: 60, 30, 15, 10 (any from 1 to 120), or 0 for every frame the browser sends.", { min: 0, max: 120 }),
    showActions: bool("Draw click points and action titles into the live view (default true)."),
    chapters: bool("Show each step's title as a small caption in the bottom-left corner of the live view and video (default false)."),
    keepTabs: bool("Keep tabs and popups a test opened for the tests after it (default false: they close between tests)."),
    screencastSize: size,
    frameQuality: int("JPEG quality of live frames (default 70).", { min: 1, max: 100 }),
  },
  "How runs of this pack behave.",
);

const COLLECTOR: Shape = {
  t: "union",
  of: [
    str(undefined, { enum: ["consoleErrors", "failedRequests", "responses"] }),
    obj({
      consoleErrors: obj({ warnings: bool("Also keep warnings.") }),
      failedRequests: obj({ match: str("Only requests whose URL contains this.") }),
      responses: obj({ match: str("Only responses whose URL contains this."), bodies: bool("Keep the bodies."), maxBody: int("Largest body to keep, in bytes.", { min: 0 }) }),
    }),
  ],
  doc: "A built-in collector: consoleErrors, failedRequests or responses, by name or with options.",
};

export const PACK_SHAPE: Shape = obj({
  name: req(str("The pack's name.")),
  description: str(),
  site: req(obj({ key: req(str("Runs of packs with the same key wait for each other.", { pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" })), baseURL: str("Relative URLs in goto join to this."), signIn: str('"saved": runs start with the sign-in saved for this site (Settings > Sign-ins).', { enum: ["saved"] }), network: str('Where runs reach the site from: "server" (the default) or a runner\'s name (Settings > Runners).') })),
  browser: obj({ name: str(undefined, { enum: ["chromium", "firefox", "webkit"] }), viewport: size, headless: bool(), context: CONTEXT }),
  params: obj({}, "Values chosen when a run starts.", { extra: PARAM }),
  flags: obj({}, "Flags tests may raise, with their kind.", { extra: str(undefined, { enum: ["robot", "finding", "info"] }) }),
  tests: oneOrMore(str(), "Globs of test files (default tests/**/*.{ts,mts,js,mjs,yaml,yml})."),
  run: RUN,
  rubric: list(CRITERION, "What reviewers score each attempt on."),
  collectors: list(COLLECTOR),
  dashboard: { t: "any", doc: "What the pack's dashboard shows: `tiles` (or `groups` of them), `runs`, `days` and `filters`. See the Dashboards guide." },
  share: { t: "any", doc: "What shares and the status page leave out: `texts: false`, `metrics: false`, `reviews: false`, `outputs: [names]`." },
  setup: { t: "steps", doc: "Steps run at each start of a run (new, resume, redo), before the first test." },
  teardown: { t: "steps", doc: "Steps run once when a run ends (finished, stopped, or setup failed)." },
  afterTask: { t: "steps", doc: "Steps run when a paused run goes on after a task used the site." },
  tasks: obj({}, "Named steps that run on their own, from the pack page, the CLI, agents or schedules.", {
    extra: TASK,
    check: (v) => {
      const bad = Object.keys(v).find((k) => !/^[a-z][a-z0-9-]{0,39}$/.test(k));
      return bad === undefined ? null : `Task "${bad}": names are lowercase letters, digits and dashes, starting with a letter.`;
    },
  }),
  beforeEach: { t: "steps", doc: "Steps run before each attempt." },
  afterEach: { t: "steps", doc: "Steps run after each attempt, also when it failed." },
});
