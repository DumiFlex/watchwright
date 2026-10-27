// The editor page's plain logic: the file tree, which problems belong to the open file, the
// tests a file holds, and the starting text of a new test.
import type { Pack, PackTest } from "./api";
import { buildErrorSpot } from "./editor";

export type FileKind = "code" | "yaml" | "json" | "markdown" | "text";

export interface PackFile {
  path: string;
  kind: FileKind;
  size: number;
  big: boolean;
}

export type TreeRow = { type: "dir"; path: string; name: string; depth: number } | { type: "file"; path: string; name: string; depth: number; file: PackFile };

/** The files as tree rows: each folder once, before its files (the server sends them folders-first). */
export function fileTree(files: readonly PackFile[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (seen.has(dir)) continue;
      seen.add(dir);
      rows.push({ type: "dir", path: dir, name: parts[i - 1]!, depth: i - 1 });
    }
    rows.push({ type: "file", path: f.path, name: parts[parts.length - 1]!, depth: parts.length - 1, file: f });
  }
  return rows;
}

export interface FileProblem {
  line: number;
  col: number;
  message: string;
}

/**
 * The pack's load problems that point into `path` (`tests/a.yaml:4:5 …`). esbuild counts
 * columns from 0 and the YAML checks from 1; both come out counted from 1.
 */
export function problemsIn(problems: readonly string[], path: string): FileProblem[] {
  const out: FileProblem[] = [];
  for (const p of problems) {
    const spot = buildErrorSpot(p);
    if (!spot || spot.spot.file.replaceAll("\\", "/") !== path) continue;
    const zeroBased = /\.(m|c)?[jt]sx?$/.test(path);
    out.push({ line: spot.spot.line, col: (spot.spot.column ?? 0) + (zeroBased ? 1 : 0), message: spot.rest });
  }
  return out;
}

/** Problems that name no file of the pack, or a file other than `path`. */
export function otherProblems(problems: readonly string[], path: string | null): string[] {
  return problems.filter((p) => {
    const spot = buildErrorSpot(p);
    return !spot || spot.spot.file.replaceAll("\\", "/") !== path;
  });
}

export function testsInFile(pack: Pack | null, path: string | null): PackTest[] {
  return pack && path ? pack.tests.filter((t) => t.file === path) : [];
}

/** The file to open when none is named: the first test file, else the pack file. */
export function defaultFile(pack: Pack | null, files: readonly PackFile[]): string | null {
  const first = pack?.tests[0]?.file;
  if (first && files.some((f) => f.path === first)) return first;
  const packFile = files.find((f) => /^pack\.(ya?ml|[mc]?[jt]s)$/.test(f.path));
  return packFile?.path ?? files[0]?.path ?? null;
}

/** pack.yaml (checked as the pack's options), a YAML test file, or neither. */
export function yamlRole(path: string, pack: Pack | null): "pack" | "test" | null {
  if (!/\.ya?ml$/i.test(path)) return null;
  if (/^pack\.ya?ml$/i.test(path)) return "pack";
  if (pack?.tests.some((t) => t.file === path) || /^tests\//.test(path)) return "test";
  return null;
}

/** An unused test id like the pack's own (`T3` after `T1`, `T2`). */
export function nextTestId(pack: Pack | null, prefix = "T"): string {
  const ids = new Set(pack?.tests.map((t) => t.id) ?? []);
  for (let n = 1; ; n++) if (!ids.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

export function yamlTestTemplate(id: string, title: string): string {
  return `id: ${id}
title: ${title}
steps:
  - goto: /
  - shot: start
`;
}

export function codeTestTemplate(id: string, title: string): string {
  return `import { expect, test } from "watchwright";

test(${JSON.stringify(id)}, { title: ${JSON.stringify(title)} }, async ({ page, h }) => {
  await h.goto("/");
  await expect(page).toHaveTitle(/./);
  await h.shot("start");
});
`;
}

/** A file name from a title: "Check out as a guest" → check-out-as-a-guest. */
export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 48) || "test"
  );
}
