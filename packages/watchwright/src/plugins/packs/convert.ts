import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PackLoadError } from "./loader.js";
import { formatProblems, parseTestFile } from "./yaml/parse.js";
import { testsToCode } from "./yaml/to-code.js";

/** A file inside the pack folder, given relative to it; links that lead out are refused. */
export function packPath(dir: string, rel: string): string {
  const abs = path.resolve(dir, rel);
  const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  if (!inside(abs, dir)) throw new PackLoadError(`${rel} isn't inside the pack folder.`);
  if (existsSync(abs) && !inside(realpathSync(abs), realpathSync(dir))) throw new PackLoadError(`${rel} leads out of the pack folder.`);
  return abs;
}

/**
 * Writes a YAML test file as a TypeScript file beside it (same name, .ts). `check` loads the pack
 * with the new file in place of the old; the YAML file goes only once that worked.
 */
export async function convertToCode(dir: string, rel: string, check: () => Promise<void>): Promise<string> {
  if (!/\.ya?ml$/i.test(rel)) throw new PackLoadError(`${rel} isn't a YAML test file.`);
  const yamlFile = packPath(dir, rel);
  if (!existsSync(yamlFile)) throw new PackLoadError(`${rel} doesn't exist.`);
  const parsed = parseTestFile(readFileSync(yamlFile, "utf8"));
  if (parsed.problems.length > 0) throw new PackLoadError(`Fix ${rel} before converting it.`, formatProblems(rel, parsed.problems));
  const tsRel = rel.replace(/\.ya?ml$/i, ".ts");
  const tsFile = packPath(dir, tsRel);
  if (existsSync(tsFile)) throw new PackLoadError(`${tsRel} already exists.`);
  const yamlText = readFileSync(yamlFile, "utf8");
  writeFileSync(tsFile, testsToCode(parsed.value));
  rmSync(yamlFile);
  try {
    await check();
  } catch (err) {
    writeFileSync(yamlFile, yamlText);
    rmSync(tsFile, { force: true });
    throw err;
  }
  return tsRel.split(path.sep).join("/");
}
