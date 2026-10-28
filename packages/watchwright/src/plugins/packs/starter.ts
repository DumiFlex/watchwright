import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PACK_FILES } from "./loader.js";

// A starter pack: the smallest pack that runs and shows each part (site, browser, a flag, a collector, a
// test with a step, a check and a screenshot), so a new pack starts from something that works.

export interface StarterInput {
  name: string;
  baseURL: string;
  /** "code" (pack.ts and a TypeScript test, the default) or "yaml" (pack.yaml and a YAML test). */
  format?: "code" | "yaml";
}

export class StarterError extends Error {}

/** A site key from a name: "My Shop" → "my-shop". */
export function siteKey(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "site"
  );
}

export function starterFiles({ name, baseURL, format = "code" }: StarterInput): Record<string, string> {
  const key = siteKey(name);
  if (format === "yaml") return yamlStarter(name, key, baseURL);
  return {
    "pack.ts": `import { pack, consoleErrors, failedRequests } from "watchwright";

// The pack: which site it tests, in which browser, and the values a run can choose.
// Every option is explained at https://github.com/DumiFlex/watchwright (Writing a test pack).
export default pack({
  name: ${JSON.stringify(name)},
  site: { key: ${JSON.stringify(key)}, baseURL: ${JSON.stringify(baseURL)} },
  browser: { name: "chromium", viewport: { width: 1280, height: 800 } },
  flags: { "slow-page": "finding" },
  collectors: [consoleErrors(), failedRequests()],
});
`,
    "tests/home.ts": `import { test } from "watchwright";

// A first test. Save the file while a run is going and the next attempt uses the new code.
test("HOME1", { title: "The home page loads", section: "Home" }, async ({ h, expect }) => {
  await h.step("open the home page", async () => {
    const started = Date.now();
    await h.goto("/");
    if (Date.now() - started > 5000) await h.flag("slow-page", "The home page took more than 5 s");
  });
  await expect(h.page.locator("body")).toBeVisible();
  await h.shot("home");
});
`,
    "README.md": `# ${name}

A [Watchwright](https://github.com/DumiFlex/watchwright) test pack for ${baseURL}.

- \`pack.ts\` names the site, the browser and what a run can choose.
- \`tests/\` holds the tests, one or more per file.

Start a run from the Watchwright page (New run), and watch it live.
`,
  };
}

const yamlText = (s: string) => (/^[\w ./:-]*$/.test(s) && !/^[\s-]|: |\s$/.test(s) ? s : JSON.stringify(s));

function yamlStarter(name: string, key: string, baseURL: string): Record<string, string> {
  return {
    "pack.yaml": `# The pack: which site it tests, in which browser, and what to keep from every attempt.
# Every option is explained at https://github.com/DumiFlex/watchwright (YAML tests).
name: ${yamlText(name)}
site:
  key: ${key}
  baseURL: ${yamlText(baseURL)}
browser:
  name: chromium
  viewport: { width: 1280, height: 800 }
flags:
  slow-page: finding
collectors:
  - consoleErrors
  - failedRequests
`,
    "tests/home.yaml": `# A first test, as a list of steps. Save the file while a run is going and the next attempt uses it.
id: HOME1
title: The home page loads
section: Home
steps:
  - goto: /
  - expect: { target: body, visible: true }
  - shot: home
`,
    "README.md": `# ${name}

A [Watchwright](https://github.com/DumiFlex/watchwright) test pack for ${baseURL}, written in YAML.

- \`pack.yaml\` names the site, the browser and what to keep from each attempt.
- \`tests/\` holds the tests: each file is one test, or several under \`tests:\`.

Start a run from the Watchwright page (New run), and watch it live.
`,
  };
}

/**
 * Writes a starter pack into `dir` (made when missing). Refuses a folder that already has a pack
 * file, and never overwrites a file that's there.
 */
export function writeStarter(dir: string, input: StarterInput): string[] {
  if (existsSync(dir) && PACK_FILES.some((f) => existsSync(path.join(dir, f)))) throw new StarterError(`${dir} already has a pack.`);
  if (!/^https?:\/\//i.test(input.baseURL)) throw new StarterError("The site's address must start with http:// or https://.");
  mkdirSync(dir, { recursive: true });
  const files = starterFiles(input);
  const clashes = Object.keys(files).filter((f) => existsSync(path.join(dir, f)));
  if (clashes.length) throw new StarterError(`${dir} already has ${clashes.join(" and ")}; pick an empty folder.`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content, { flag: "wx" });
  }
  return Object.keys(files);
}
