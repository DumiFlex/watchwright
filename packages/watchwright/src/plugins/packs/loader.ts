import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin as EsbuildPlugin } from "esbuild";
import { beginCollecting, endCollecting, type PackOptions, type TestDefinition, type TestMeta } from "./api.js";
import { glob } from "./glob.js";
import { rubricProblems } from "./rubric.js";
import { readDashboard, readShare } from "./dashboard.js";
import { readPackYaml } from "./yaml/pack-yaml.js";
import { formatProblems, parseTestFile } from "./yaml/parse.js";
import { yamlBody } from "./yaml/run.js";

// Packs are ESM or TypeScript, so hot reload can't clear a require cache. Instead every load
// bundles the pack (pack file + test files) with esbuild into one file in the data folder and
// imports it under a new name. See docs/research/step-1-engine.md.

export const PACK_FILES = ["pack.ts", "pack.mts", "pack.js", "pack.mjs", "pack.yaml", "pack.yml"];
export const DEFAULT_TEST_GLOB = "tests/**/*.{ts,mts,js,mjs,yaml,yml}";

const isYaml = (f: string) => /\.ya?ml$/i.test(f);

export interface LoadedPack {
  /** Absolute path of the pack folder. */
  dir: string;
  /** The pack file, relative to `dir`. */
  packFile: string;
  options: PackOptions;
  tests: TestDefinition[];
  /** Every source file of the build with its stamp, plus the test glob result. */
  stamp: string;
  buildFile: string;
  builtAt: string;
  /**
   * Absolute paths of the build's source files outside `dir` (a pack can import files it shares with
   * other packs from the folder above it). A pack's zip brings them along.
   */
  outside: string[];
}

export class PackLoadError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(problems.length > 0 ? `${message}\n${problems.map((p) => `  - ${p}`).join("\n")}` : message);
  }
}

/** Finds the pack file for a folder or file path. */
export function findPackFile(input: string): { dir: string; packFile: string } {
  const abs = path.resolve(input);
  if (!existsSync(abs)) throw new PackLoadError(`No file or folder at ${abs}.`);
  if (statSync(abs).isFile()) return { dir: path.dirname(abs), packFile: path.basename(abs) };
  const file = PACK_FILES.find((f) => existsSync(path.join(abs, f)));
  if (!file) throw new PackLoadError(`${abs} has no pack file (${PACK_FILES.join(", ")}).`);
  return { dir: abs, packFile: file };
}

// The modules a pack imports by bare name must be the server's own copies: "watchwright" so tests
// register into this engine, and Playwright so pages and expect match the engine's.
const here = fileURLToPath(import.meta.url);
const ownEntry = pathToFileURL(path.join(path.dirname(here), "..", "..", `index${path.extname(here)}`)).href;
const require = createRequire(import.meta.url);

function esmEntry(pkg: string, subpath: string): string {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const manifest = JSON.parse(readFileSync(pkgJson, "utf8")) as { exports?: Record<string, string | Record<string, string>> };
  const entry = manifest.exports?.[subpath];
  const file = typeof entry === "string" ? entry : (entry?.import ?? entry?.default ?? entry?.require);
  if (!file) throw new Error(`${pkg} has no export "${subpath}".`);
  return pathToFileURL(path.join(path.dirname(pkgJson), file)).href;
}

const SHARED: Record<string, () => string> = {
  watchwright: () => ownEntry,
  playwright: () => esmEntry("playwright", "."),
  "playwright/test": () => esmEntry("playwright", "./test"),
  "@playwright/test": () => esmEntry("playwright", "./test"),
};

const sharedPlugin: EsbuildPlugin = {
  name: "watchwright-shared",
  setup(b) {
    b.onResolve({ filter: /^(watchwright|playwright|playwright\/test|@playwright\/test)$/ }, (args) => ({ path: SHARED[args.path]!(), external: true }));
  },
};

const insideDir = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Build errors made readable. An import that leaves the pack's folder and finds nothing usually
 * means only the pack's folder was copied or uploaded, without the folder above it that holds the
 * files it shares: say so, with where it looked.
 */
function buildProblems(dir: string, errors: { text: string; location?: { file: string; line: number; column: number } | null }[]): PackLoadError {
  let outside = 0;
  const problems = errors.map((e) => {
    if (!e.location) return e.text;
    const at = `${e.location.file}:${e.location.line}:${e.location.column}`;
    const spec = /^Could not resolve "(\.{1,2}\/[^"]*)"$/.exec(e.text)?.[1];
    if (spec) {
      const target = path.resolve(dir, path.dirname(e.location.file), spec);
      if (!insideDir(target, dir)) {
        outside++;
        return `${at} imports "${spec}" from outside the pack's folder, and it isn't in ${path.dirname(target)}.`;
      }
    }
    return `${at} ${e.text}`;
  });
  if (outside > 0) {
    return new PackLoadError("The pack imports files from outside its folder that aren't on this server. Copy the folder above it too, or upload a zip of that folder.", problems);
  }
  return new PackLoadError("The pack doesn't build.", problems);
}

async function bundle(dir: string, entry: string, outFile: string): Promise<string[]> {
  try {
    const result = await build({
      stdin: { contents: entry, resolveDir: dir, sourcefile: "watchwright-entry.ts", loader: "ts" },
      absWorkingDir: dir,
      // The real output path, so the inline source map's paths lead back to the pack's own files
      // (stack traces then name /my/pack/tests/home.ts, not a file in the build cache).
      outfile: outFile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      sourcemap: "inline",
      write: false,
      metafile: true,
      logLevel: "silent",
      plugins: [sharedPlugin],
    });
    writeFileSync(outFile, result.outputFiles[0]!.text);
    return Object.keys(result.metafile.inputs).filter((f) => f !== "watchwright-entry.ts");
  } catch (err) {
    const errors = (err as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors;
    if (errors) throw buildProblems(dir, errors);
    throw err;
  }
}

// One import at a time, so `pack()` / `test()` calls always land in the right collector.
let importChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = importChain.then(fn, fn);
  importChain = next.catch(() => undefined);
  return next;
}

async function importCollecting(file: string) {
  return serial(async () => {
    const collected = beginCollecting();
    try {
      await import(pathToFileURL(file).href);
      return { pack: collected.pack, tests: [...collected.tests] };
    } finally {
      endCollecting();
    }
  });
}

function stampOf(dir: string, files: readonly string[], tests: readonly string[]): string {
  const parts = files.map((f) => {
    try {
      const s = statSync(path.resolve(dir, f));
      return `${f}:${s.size}:${Math.round(s.mtimeMs)}`;
    } catch {
      return `${f}:gone`;
    }
  });
  return `${parts.sort().join("|")}#${tests.join(",")}`;
}

let buildCounter = 0;

function testGlobs(options: PackOptions): string[] {
  const t = options.tests ?? DEFAULT_TEST_GLOB;
  return typeof t === "string" ? [t] : [...t];
}

/** Bundles and imports a pack. `cacheDir` gets the bundle files; old ones are removed. */
export async function loadPack(input: string, cacheDir: string): Promise<LoadedPack> {
  const { dir, packFile } = findPackFile(input);
  mkdirSync(cacheDir, { recursive: true });
  const id = `${Date.now().toString(36)}-${(buildCounter++).toString(36)}`;

  // First the pack options: pack.yaml is read as it is; a code pack file is bundled alone and
  // imported, since its options name the test globs.
  let options: PackOptions;
  const yamlPack = isYaml(packFile);
  if (yamlPack) {
    const { value, problems } = readPackYaml(readFileSync(path.join(dir, packFile), "utf8"), path.join(dir, packFile));
    if (!value) throw new PackLoadError(`${packFile} isn't valid.`, formatProblems(packFile, problems));
    options = value;
  } else {
    const first = path.join(cacheDir, `${id}-pack.mjs`);
    await bundle(dir, `await import(${JSON.stringify(`./${packFile}`)});`, first);
    const head = await importCollecting(first);
    rmSync(first, { force: true });
    if (!head.pack) throw new PackLoadError(`${packFile} doesn't call pack({ ... }).`);
    options = head.pack;
  }
  checkOptions(options);

  // Then the code tests in one build. Dynamic imports keep files in order, so each test knows its
  // file. YAML tests are read beside it and put back in file order.
  const testFiles = glob(dir, testGlobs(options)).filter((f) => f !== packFile);
  const codeFiles = testFiles.filter((f) => !isYaml(f));
  const lines = [`import { __fileMarker } from "watchwright";`];
  if (!yamlPack) lines.push(`await import(${JSON.stringify(`./${packFile}`)});`);
  for (const f of codeFiles) lines.push(`__fileMarker(${JSON.stringify(f)});`, `await import(${JSON.stringify(`./${f}`)});`);
  const buildFile = path.join(cacheDir, `${id}.mjs`);
  const inputs = await bundle(dir, lines.join("\n"), buildFile);
  const full = await importCollecting(buildFile);
  if (yamlPack && full.pack) throw new PackLoadError(`The pack has ${packFile} and a file that calls pack({ ... }). Keep one.`);
  if (!yamlPack && !full.pack) throw new PackLoadError(`${packFile} doesn't call pack({ ... }).`);
  if (!yamlPack) options = full.pack!;

  const problems: string[] = [];
  const tests: TestDefinition[] = [];
  for (const f of testFiles) {
    if (!isYaml(f)) {
      tests.push(...full.tests.filter((t) => t.file === f));
      continue;
    }
    const abs = path.join(dir, f);
    const parsed = parseTestFile(readFileSync(abs, "utf8"));
    problems.push(...formatProblems(f, parsed.problems));
    for (const t of parsed.value) tests.push({ id: t.id, meta: t.meta as TestMeta, body: yamlBody(t.steps, abs), file: f, yaml: { line: t.line, steps: t.steps } });
  }
  if (problems.length > 0) throw new PackLoadError("Some YAML tests aren't valid.", problems);
  // Results are filed in a folder per test id, so ids must make folders on every system: on
  // Windows "a1" and "A1" are one folder, and some names can't be folders at all.
  const seen = new Map<string, string>();
  const idProblems: string[] = [];
  for (const t of tests) {
    const other = seen.get(t.id.toLowerCase());
    if (other === t.id) throw new PackLoadError(`Two tests have the id "${t.id}".`);
    if (other !== undefined) idProblems.push(`"${other}" and "${t.id}" differ only in case: on Windows their results would go to one folder. Rename one.`);
    seen.set(t.id.toLowerCase(), t.id);
    const reserved = windowsUnsafe(t.id);
    if (reserved) idProblems.push(`"${t.id}" ${reserved}`);
  }
  if (idProblems.length > 0) throw new PackLoadError("Some test ids can't be used as folder names.", idProblems);
  pruneBuilds(cacheDir, buildFile);
  const stamped = [...inputs, ...(yamlPack ? [packFile] : []), ...testFiles.filter(isYaml)];
  return {
    dir,
    packFile,
    options,
    tests,
    stamp: stampOf(dir, stamped, testFiles),
    buildFile,
    builtAt: new Date().toISOString(),
    outside: [...new Set(inputs.map((f) => path.resolve(dir, f)))].filter((f) => !insideDir(f, dir) && !f.split(/[\\/]/).includes("node_modules")).sort(),
  };
}

/** The stamp of the build's source files as they are on disk now. */
export function currentStamp(loaded: LoadedPack): string {
  const files = loaded.stamp.split("#")[0]!.split("|").map((p) => p.slice(0, p.indexOf(":")));
  let tests: string[] = [];
  try {
    tests = glob(loaded.dir, testGlobs(loaded.options)).filter((f) => f !== loaded.packFile);
  } catch {
    // the folder went away: every file reads as gone
  }
  return stampOf(loaded.dir, files, tests);
}

/** True when a source file of the build changed, appeared or went away since it was loaded. */
export function packChanged(loaded: LoadedPack): boolean {
  return currentStamp(loaded) !== loaded.stamp;
}

function pruneBuilds(cacheDir: string, keep: string): void {
  const builds = readdirSync(cacheDir)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => path.join(cacheDir, f))
    .filter((f) => f !== keep)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  // Keep a couple of older builds: a run that's still importing one shouldn't lose it.
  for (const f of builds.slice(2)) rmSync(f, { force: true });
}

/** Why `id` can't be a folder on Windows (a reserved device name, a trailing dot), or null. */
export function windowsUnsafe(id: string): string | null {
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(id)) return "is a name Windows keeps for a device, so it can't be a folder there. Rename it.";
  if (id.endsWith(".")) return "ends with a dot, which Windows drops from folder names. Rename it.";
  return null;
}

const SITE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const FLAG_KINDS = ["robot", "finding", "info"];

function checkOptions(o: PackOptions): void {
  const problems: string[] = [];
  if (typeof o.name !== "string" || o.name.trim() === "") problems.push("`name` must be a non-empty string.");
  if (!o.site || typeof o.site.key !== "string" || !SITE_KEY.test(o.site.key)) problems.push("`site.key` must be letters, digits, dots, dashes or underscores.");
  if (o.site?.baseURL !== undefined) {
    try {
      new URL(o.site.baseURL);
    } catch {
      problems.push("`site.baseURL` must be an absolute URL.");
    }
  }
  if (o.site?.signIn !== undefined && o.site.signIn !== "saved") problems.push('`site.signIn` must be "saved" (or left out).');
  if (o.site?.network !== undefined && (typeof o.site.network !== "string" || o.site.network.trim() === "" || o.site.network.length > 60)) problems.push('`site.network` must be "server" or a runner\'s name.');
  if (o.browser?.name !== undefined && !["chromium", "firefox", "webkit"].includes(o.browser.name)) problems.push("`browser.name` must be chromium, firefox or webkit.");
  for (const [name, kind] of Object.entries(o.flags ?? {})) if (!FLAG_KINDS.includes(kind)) problems.push(`Flag "${name}" must be robot, finding or info.`);
  problems.push(...rubricProblems(o.rubric, "rubric"));
  readDashboard(o.dashboard, problems);
  readShare(o.share, problems);
  if (problems.length > 0) throw new PackLoadError("The pack's options aren't valid.", problems);
}
