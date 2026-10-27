import { PACK_SHAPE } from "./pack-shape.js";
import type { Shape } from "./shape.js";
import { STEPS, TEST_META } from "./steps.js";
import { TARGET_MAP } from "./targets.js";

// JSON Schemas for YAML test files and pack.yaml, generated from the same shapes the loader
// checks with. They ship in the package (dist/schema/*.json) for VS Code's YAML extension and
// for agents. The loader's own checks say more (did you mean, checks across fields).

type Json = Record<string, unknown>;

function convert(s: Shape): Json {
  const doc = s.doc ? { description: s.doc } : {};
  switch (s.t) {
    case "string":
      return { type: "string", ...doc, ...(s.enum ? { anyOf: [{ enum: s.enum }, { pattern: "\\$\\{" }] } : {}), ...(s.pattern ? { pattern: s.pattern } : {}) };
    case "number":
    case "integer":
      return { anyOf: [{ type: s.t, ...(s.min !== undefined ? { minimum: s.min } : {}), ...(s.max !== undefined ? { maximum: s.max } : {}) }, { $ref: "#/$defs/variable" }], ...doc };
    case "boolean":
      return { anyOf: [{ type: "boolean" }, { $ref: "#/$defs/variable" }], ...doc };
    case "scalar":
      return { type: ["string", "number", "boolean"], ...doc };
    case "any":
      return { ...doc };
    case "target":
      return { $ref: "#/$defs/target", ...doc };
    case "match":
      return { $ref: "#/$defs/match", ...doc };
    case "steps":
      return { $ref: "#/$defs/steps", ...doc };
    case "array":
      return { type: "array", items: convert(s.items), ...(s.min !== undefined ? { minItems: s.min } : {}), ...doc };
    case "union":
      return { anyOf: s.of.map(convert), ...doc };
    case "object": {
      const required = Object.entries(s.props)
        .filter(([, p]) => p.required)
        .map(([k]) => k);
      return {
        type: "object",
        ...doc,
        properties: Object.fromEntries(Object.entries(s.props).map(([k, p]) => [k, convert(p)])),
        ...(required.length ? { required } : {}),
        additionalProperties: s.extra ? convert(s.extra) : false,
      };
    }
  }
}

function stepSchemas(): Json[] {
  const out: Json[] = [];
  const bare = STEPS.filter((d) => d.bare).map((d) => d.name);
  if (bare.length) out.push({ enum: bare });
  for (const d of STEPS) {
    const fields = Object.fromEntries(Object.entries(d.fields).map(([k, p]) => [k, convert(p)]));
    const asMap = { type: "object", properties: fields, additionalProperties: false };
    const value: Json[] = [asMap];
    if (d.short) value.unshift(convert(d.fields[d.short]!));
    if (d.bare || Object.keys(d.fields).length === 0) value.push({ type: "null" });
    // The step's name holds its value; its fields may also sit beside it ("flat" form).
    out.push({ type: "object", description: d.doc, properties: { [d.name]: { anyOf: value, description: d.doc }, ...fields }, required: [d.name], additionalProperties: false });
  }
  return out;
}

function defs(): Json {
  return {
    variable: { type: "string", pattern: "\\$\\{[^}]+\\}", description: "A ${…} variable: params.…, saved.…, env.…, attempt, attempts or last." },
    match: { anyOf: [{ type: ["string", "number"] }, { type: "object", properties: { regex: { type: "string" }, flags: { type: "string" } }, required: ["regex"], additionalProperties: false }] },
    target: { anyOf: [{ type: "string", description: "A Playwright selector." }, convert(TARGET_MAP)] },
    steps: { type: "array", items: { anyOf: stepSchemas() } },
  };
}

const TEST: Shape = { t: "object", props: { ...TEST_META, steps: { t: "steps", required: true } } };

export function testFileSchema(): Json {
  const test = convert(TEST);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Watchwright YAML test file",
    description: "One test, or several under `tests:`.",
    $defs: { ...defs(), test },
    anyOf: [
      { $ref: "#/$defs/test" },
      {
        type: "object",
        properties: { tests: { type: "array", items: { $ref: "#/$defs/test" } }, section: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
        required: ["tests"],
        additionalProperties: false,
      },
    ],
  };
}

export function packSchema(): Json {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Watchwright pack.yaml",
    $defs: defs(),
    ...convert(PACK_SHAPE),
  };
}
