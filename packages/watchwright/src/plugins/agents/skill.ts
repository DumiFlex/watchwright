import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The agent skill that ships in the package (`skill/watchwright/`): SKILL.md, written by hand, and
// its references, made from the docs site's pages so the two never disagree
// (`pnpm --filter watchwright skill-references` writes them; a test fails when they are stale).

/** The package's folder: three levels above this file in both src/ and dist/. */
const PACKAGE_DIR = fileURLToPath(new URL("../../../", import.meta.url));

/** The skill's folder in the package. */
export const SKILL_DIR = path.join(PACKAGE_DIR, "skill", "watchwright");

/** Where the docs site is published; links to pages the skill doesn't carry point there. */
export const SITE_URL = "https://dumiflex.github.io/watchwright/";

/** The site pages the skill carries, by their path on the site, and the file each becomes. */
export const REFERENCES: Record<string, string> = {
  "guide/yaml-tests": "yaml-tests.md",
  "reference/yaml-steps": "yaml-steps.md",
  "guide/test-packs": "test-packs.md",
  "reference/mcp": "mcp.md",
  "reference/cli": "cli.md",
};

/**
 * A site page as a reference file: links to pages the skill carries point at its file, others at
 * the published site, and VitePress boxes (`::: warning Title`) become quotes.
 */
export function referenceOf(page: string, text: string): string {
  const dir = path.posix.dirname(page);
  const linked = text.replace(/\]\((\.{1,2}\/[^)#\s]*)(#[^)\s]*)?\)/g, (_m, rel: string, hash = "") => {
    const target = path.posix.normalize(path.posix.join(dir, rel)).replace(/\.md$/, "");
    const file = REFERENCES[target];
    return `](${file ?? `${SITE_URL}${target}`}${hash})`;
  });
  const out: string[] = [];
  let inBox = false;
  for (const line of linked.split("\n")) {
    const open = /^:::\s*(\w+)\s*(.*)$/.exec(line);
    if (open && !inBox) {
      inBox = true;
      out.push(`> **${open[2] || open[1]!.replace(/^./, (c) => c.toUpperCase())}**`, ">");
    } else if (/^:::\s*$/.test(line) && inBox) inBox = false;
    else out.push(inBox ? (line ? `> ${line}` : ">") : line);
  }
  return `<!-- Made from ${SITE_URL}${page} by \`pnpm --filter watchwright skill-references\`; edit the site page, not this file. -->\n\n${out.join("\n")}`;
}

/** Every reference file as it should be, from the site's pages in `siteDir`. */
export function references(siteDir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [page, file] of Object.entries(REFERENCES)) out.set(file, referenceOf(page, readFileSync(path.join(siteDir, `${page}.md`), "utf8")));
  return out;
}

/** Copies the skill folder into `dest` (replacing the files it has there). */
export function copySkill(dest: string): void {
  if (!existsSync(path.join(SKILL_DIR, "SKILL.md"))) throw new Error(`The skill isn't in this install of Watchwright (looked in ${SKILL_DIR}).`);
  cpSync(SKILL_DIR, dest, { recursive: true, force: true });
}
