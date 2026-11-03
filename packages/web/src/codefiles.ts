// Which pack files are code (docs/research/teams-and-audience-dashboards.md): with login on, only
// admins change them, since they run on the server. Mirrors `isCodeFile` in the server's editor
// plugin (packages/watchwright/src/plugins/editor/files.ts).

const CODE_EXT = /\.(ts|mts|cts|tsx|js|mjs|cjs|jsx)$/i;
const BUILD_FILES = /^(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|\.npmrc|\.yarnrc(\.yml)?|[tj]sconfig(\..+)?\.json)$/i;

export function isCodeFile(path: string): boolean {
  const base = path.replaceAll("\\", "/").split("/").pop() ?? "";
  return CODE_EXT.test(base) || BUILD_FILES.test(base);
}
