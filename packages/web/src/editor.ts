// "Open in your editor" links. Editors register their own URL schemes, so a link is enough:
// the browser hands it to the editor. The editor is a machine-wide setting (settings.editor).

export type Editor = "vscode" | "cursor" | "windsurf" | "idea" | "webstorm" | "none";

export const EDITOR_OPTIONS: { value: Editor; label: string }[] = [
  { value: "vscode", label: "Visual Studio Code" },
  { value: "cursor", label: "Cursor" },
  { value: "windsurf", label: "Windsurf" },
  { value: "idea", label: "IntelliJ IDEA" },
  { value: "webstorm", label: "WebStorm" },
  { value: "none", label: "None (show paths only)" },
];

export function editorName(e: Editor): string {
  return EDITOR_OPTIONS.find((o) => o.value === e)?.label ?? e;
}

/** The link that opens `file` (absolute) at a line and column in the editor, or null for none. */
export function editorUrl(editor: Editor, file: string, line?: number, column?: number): string | null {
  if (editor === "none") return null;
  const slashed = file.replaceAll("\\", "/");
  const abs = slashed.startsWith("/") ? slashed : `/${slashed}`; // C:/x → /C:/x
  if (editor === "idea" || editor === "webstorm") {
    const q = new URLSearchParams({ file: file });
    if (line) q.set("line", String(line));
    if (column) q.set("column", String(column));
    return `${editor}://open?${q.toString()}`;
  }
  const at = line ? `:${line}${column ? `:${column}` : ""}` : "";
  return `${editor}://file${encodeURI(abs)}${at}`;
}

export interface SourceSpot {
  file: string;
  line: number;
  column?: number | undefined;
}

/** "tests/home.ts:4:12 Unexpected ;" (a build error) → the spot and the rest of the text. */
export function buildErrorSpot(text: string): { spot: SourceSpot; rest: string } | null {
  const m = /^(.+?):(\d+):(\d+)\s+(.*)$/s.exec(text);
  return m ? { spot: { file: m[1]!, line: Number(m[2]), column: Number(m[3]) }, rest: m[4]! } : null;
}

/** The first stack frame in the person's own code: not Node's, not a package's, not Watchwright's. */
export function firstOwnFrame(stack: string): SourceSpot | null {
  for (const line of stack.split("\n")) {
    const m = /(?:\(|at )((?:[a-zA-Z]:[\\/]|\/)[^():]*?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!m) continue;
    const file = m[1]!;
    if (/[\\/]node_modules[\\/]|[\\/]watchwright[\\/](dist|src)[\\/]/.test(file)) continue;
    return { file, line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}
