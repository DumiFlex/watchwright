// Checks what `npm pack` would put in the published package: the files it needs are there,
// and nothing that only belongs in the repository (sources, tests, local data, secrets) slipped in.
// Run after `pnpm build`: `pnpm --filter watchwright check-package`.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface PackedFile {
  path: string;
  size: number;
}

/** Files the package can't work without. */
export const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "NOTICE",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/main.js",
  "dist/schema/test.json",
  "dist/schema/pack.json",
  "dist/web/index.html",
  "skill/watchwright/SKILL.md",
];

/** Paths that must never ship. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /^(src|test|scripts|coverage|test-results)\//, why: "repository-only folder" },
  { pattern: /(^|\/)\.watchwright\//, why: "a local server's data folder" },
  { pattern: /(^|\/)\.env(\..*)?$/, why: "environment file" },
  { pattern: /\.(sqlite|sqlite3|db|log|tgz|zip|pem|key)$/, why: "local data, archive or key file" },
  { pattern: /(^|\/)\.npmrc$/, why: "npm settings, can hold a token" },
  { pattern: /\.tsbuildinfo$/, why: "TypeScript build cache" },
];

/** Upper bound on the unpacked size; the web app's chunks are most of it. */
export const MAX_UNPACKED_BYTES = 15 * 1024 * 1024;

export function checkPackage(files: PackedFile[]): string[] {
  const problems: string[] = [];
  const paths = new Set(files.map((f) => f.path));
  for (const file of REQUIRED) if (!paths.has(file)) problems.push(`missing ${file}`);
  for (const file of files) {
    const hit = FORBIDDEN.find((rule) => rule.pattern.test(file.path));
    if (hit) problems.push(`${file.path} should not ship (${hit.why})`);
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_UNPACKED_BYTES) problems.push(`unpacked size ${(total / 1024 / 1024).toFixed(1)} MB is over ${MAX_UNPACKED_BYTES / 1024 / 1024} MB`);
  return problems;
}

function main(): void {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd, encoding: "utf8", shell: process.platform === "win32" });
  const [pack] = JSON.parse(out) as { name: string; version: string; files: PackedFile[] }[];
  if (!pack) throw new Error("npm pack printed nothing");
  const problems = checkPackage(pack.files);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`✓ ${pack.name}@${pack.version}: ${pack.files.length} files look right`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
