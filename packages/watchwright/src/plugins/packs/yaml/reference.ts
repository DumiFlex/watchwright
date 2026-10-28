import type { Prop, Shape } from "./shape.js";
import { STEPS, type StepGroup } from "./steps.js";

// The docs site's "YAML steps" page, written from the step list so the two can't drift apart.
// `pnpm --filter watchwright steps-reference` writes it; a test checks it is current.

const GROUPS: Record<StepGroup, string> = {
  go: "Go",
  act: "Act",
  wait: "Wait",
  check: "Check",
  keep: "Keep",
  shape: "Shape",
};

function typeOf(s: Shape): string {
  switch (s.t) {
    case "string":
      return s.enum ? s.enum.map((e) => `\`${e}\``).join(", ") : "text";
    case "number":
      return "number";
    case "integer":
      return "whole number";
    case "boolean":
      return "true / false";
    case "scalar":
      return "text, number or true / false";
    case "any":
      return "any value";
    case "target":
      return "[target](#targets)";
    case "match":
      return "text or `{ regex }`";
    case "steps":
      return "steps";
    case "array":
      return `list of ${typeOf(s.items)}`;
    case "union":
      return s.of.map(typeOf).join(" or ");
    case "object":
      return "map";
  }
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function fieldsTable(fields: Record<string, Prop>): string[] {
  const rows = Object.entries(fields);
  if (rows.length === 0) return [];
  return ["| Field | Type | |", "|---|---|---|", ...rows.map(([k, p]) => `| \`${k}\`${p.required ? " (required)" : ""} | ${cell(typeOf(p))} | ${cell(p.doc ?? "")} |`), ""];
}

export function stepsReference(): string {
  const out: string[] = [
    "<!-- Written from packages/watchwright/src/plugins/packs/yaml/steps.ts by `pnpm --filter watchwright steps-reference`. Edit the steps there, not here. -->",
    "",
    "# YAML steps",
    "",
    "Every step a [YAML test](../guide/yaml-tests) can use. A step is one verb with its value: `- goto: /cart`, or with fields, `- click: { target: \"#save\", timeout: 2000 }`. Fields can also sit beside the verb on their own lines. Steps with a plain-value form name the field it fills.",
    "",
    "Text values can use `${params.name}`, `${saved.key}`, `${secret.NAME}`, `${env.NAME}`, `${attempt}`, `${attempts}` and `${last}` (see [Variables](../guide/yaml-tests#variables)). Where a number or true / false goes, a variable works too.",
    "",
  ];
  for (const [group, title] of Object.entries(GROUPS) as [StepGroup, string][]) {
    out.push(`## ${title}`, "");
    for (const s of STEPS.filter((x) => x.group === group)) {
      out.push(`### ${s.name}`, "", s.doc, "");
      const forms: string[] = [];
      if (s.bare) forms.push(`\`- ${s.name}\``);
      if (s.short) forms.push(`\`- ${s.name}: <${s.short}>\``);
      if (forms.length) out.push(`Also written as ${forms.join(" or ")}.`, "");
      out.push(...fieldsTable(s.fields));
    }
  }
  out.push(
    "## Targets",
    "",
    "A target is a Playwright selector string (`\"#save\"`, `\"text=Save\"`, `\"[data-test=save]\"`), or a map with one of `role`, `label`, `placeholder`, `text`, `alt`, `title`, `testId` or `css`, plus optional filters:",
    "",
    "| Key | Same as in Playwright |",
    "|---|---|",
    "| `role` with `name`, `exact`, `checked`, `disabled`, `expanded`, `pressed`, `selected`, `level`, `includeHidden` | `getByRole` |",
    "| `label`, `placeholder`, `text`, `alt`, `title` (with `exact`) | `getByLabel`, `getByPlaceholder`, `getByText`, `getByAltText`, `getByTitle` |",
    "| `testId` | `getByTestId` |",
    "| `css` | `locator(css)` |",
    "| `hasText`, `hasNotText`, `has` | `filter()` |",
    "| `nth` (from 0, -1 is the last), `first`, `last` | `nth()`, `first()`, `last()` |",
    "| `within` | a target to look inside |",
    "| `frame` | an iframe to look inside |",
    "",
    "Text in `name`, `label`, `text` and the other text keys can be a regex: `{ regex: \"^Save\", flags: i }`.",
    "",
  );
  return out.join("\n");
}
