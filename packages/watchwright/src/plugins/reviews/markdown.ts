import type { Criterion, Score } from "../packs/rubric.js";
import { mean, type CompareCell, type CompareFile, type CompareShot, type Comparison } from "./compare.js";

// Writes a comparison (one run or several) as Markdown: the runs, then one section per test with
// its mean score, then per attempt: status, flags, metrics, the scores as a small table, the
// reviewers' notes and links to the screenshots and files. `link` and `fileLink` decide where a
// link points: the server for a plain export, a file next to the Markdown in a zip.

export interface MarkdownOptions {
  link: (shot: CompareShot, cell: CompareCell) => string;
  /** Where a kept file's link points (default: its url on the server). */
  fileLink?: (file: CompareFile, cell: CompareCell) => string;
  /** When the export was made (ISO); shown under the title. */
  now: string;
}

const esc = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");
const oneLine = (s: string) => esc(s.replace(/\s+/g, " ").trim());
const cellText = (s: string) => oneLine(s) || " ";
const fixed = (n: number | null) => (n === null ? "–" : n.toFixed(1));

function scoreText(c: Criterion, v: Score | undefined): string {
  if (v === undefined) return "–";
  if (c.kind === "scale") return `${String(v)} / ${c.scale}`;
  if (c.kind === "yesNo") return v ? "yes" : "no";
  return String(v);
}

function duration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function params(p: Comparison["runs"][number]["params"]): string {
  const xs = Object.entries(p);
  return xs.length ? xs.map(([k, v]) => `${k}=${String(v)}`).join(", ") : "–";
}

function cellLines(cell: CompareCell, criteria: Criterion[], o: MarkdownOptions): string[] {
  const out: string[] = [];
  const head = [`**${cell.status}**`, duration(cell.durationMs), cell.score === null ? "" : `score ${fixed(cell.score)} / 5`].filter(Boolean);
  out.push(head.join(" · "), "");
  if (cell.error) out.push(`Error: ${oneLine(cell.error.split("\n")[0] ?? "")}`, "");
  if (cell.flags.length) {
    out.push("Flags:", "");
    for (const f of cell.flags) out.push(`- \`${f.name}\` (${f.kind})${f.detail ? `: ${oneLine(f.detail)}` : ""}`);
    out.push("");
  }
  const metrics = Object.entries(cell.metrics);
  if (metrics.length) out.push(`Metrics: ${metrics.map(([k, m]) => `${oneLine(k)} ${m.value}${m.unit ? ` ${oneLine(m.unit)}` : ""}`).join(", ")}`, "");
  if (cell.notes.length) {
    out.push("Notes from the test:", "");
    for (const n of cell.notes) out.push(`- ${oneLine(n)}`);
    out.push("");
  }
  if (cell.reviews.length) {
    out.push(`| Criterion | ${cell.reviews.map((r) => cellText(r.reviewer)).join(" | ")} |`);
    out.push(`|---|${cell.reviews.map(() => "---").join("|")}|`);
    for (const c of criteria) out.push(`| ${cellText(c.title)} | ${cell.reviews.map((r) => scoreText(c, r.scores[c.id])).join(" | ")} |`);
    out.push("");
    for (const r of cell.reviews.filter((x) => x.note.trim())) out.push(`> **${esc(r.reviewer)}**: ${r.note.trim().split("\n").map(esc).join("\n> ")}`, "");
  } else out.push("Not reviewed.", "");
  if (cell.shots.length) {
    out.push(`Screenshots: ${cell.shots.map((s) => `[${esc(s.name)}](${o.link(s, cell)})`).join(", ")}`, "");
  }
  if (cell.files.length) {
    const link = o.fileLink ?? ((f: CompareFile) => f.url);
    out.push(`Files: ${cell.files.map((f) => `[${esc(f.at)}](${link(f, cell)})`).join(", ")}`, "");
  }
  return out;
}

export function toMarkdown(c: Comparison, o: MarkdownOptions): string {
  const many = c.runs.length > 1;
  const out: string[] = [];
  const only = c.runs[0]!;
  out.push(many ? `# ${esc(c.packName)}: ${c.runs.length} runs compared` : `# ${esc(c.packName)}: run ${only.id}${only.label ? ` (${esc(only.label)})` : ""}`, "");
  out.push(`Exported ${o.now.slice(0, 16).replace("T", " ")} UTC from Watchwright.`, "");
  // Facts the runs saved while running (the app's version, the model it used) get a column when there are any.
  const facts = c.runs.some((r) => Object.keys(r.info ?? {}).length > 0);
  out.push(
    `| Run | Started | Parameters |${facts ? " Facts |" : ""} Status | Passed | Failed | Broken | Score |`,
    `|---|---|---|${facts ? "---|" : ""}---|---|---|---|---|`,
  );
  c.runs.forEach((r, i) => {
    const score = mean(c.rows.map((row) => row.cells[i]?.score ?? null));
    const started = (r.startedAt ?? r.createdAt).slice(0, 16).replace("T", " ");
    const fact = facts ? ` ${cellText(Object.entries(r.info ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(", ") || "–")} |` : "";
    out.push(`| ${r.id}${r.label ? ` ${cellText(r.label)}` : ""} | ${started} | ${cellText(params(r.params))} |${fact} ${r.status} | ${r.counts.passed} | ${r.counts.failed} | ${r.counts.broken} | ${fixed(score)} |`);
  });
  out.push("", "Scores are the mean of the scale criteria on 1 to 5, over every reviewer.", "");

  const tests = new Map<string, typeof c.rows>();
  for (const row of c.rows) tests.set(row.testId, [...(tests.get(row.testId) ?? []), row]);
  for (const [testId, rows] of tests) {
    const criteria = c.criteria[testId] ?? [];
    out.push(`## ${esc(testId)} ${esc(rows[0]!.title)}`, "");
    const perRun = c.runs.map((_, i) => mean(rows.map((r) => r.cells[i]?.score ?? null)));
    out.push(many ? `Mean score: ${c.runs.map((r, i) => `${r.id} ${fixed(perRun[i] ?? null)}`).join(", ")}` : `Mean score: ${fixed(perRun[0] ?? null)}`, "");
    for (const row of rows) {
      if (rows.length > 1 || many) out.push(`### Attempt ${row.number}`, "");
      row.cells.forEach((cell, i) => {
        if (many) {
          const p = c.runs[i]!.params;
          out.push(Object.keys(p).length ? `#### Run ${c.runs[i]!.id} (${cellText(params(p))})` : `#### Run ${c.runs[i]!.id}`, "");
        }
        if (!cell) out.push("Not run.", "");
        else out.push(...cellLines(cell, criteria, o));
      });
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
