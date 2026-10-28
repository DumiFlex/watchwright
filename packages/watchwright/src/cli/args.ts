import type { ActionInfo, JsonSchema } from "../actions/registry.js";

// Turns command-line arguments into an action's input, typed from its JSON Schema: path
// parameters in order, every property as a flag (`--pack-id` or `--packId`), arrays as repeated
// flags or commas, objects as JSON or `key=value`, `--no-x` for false (docs/plans/step-5.md, section 3).

export class UsageError extends Error {}

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
/** `packId` → `pack-id`, `baseURL` → `base-url`: a run of capitals is one word. */
export const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();

/** The `:name` parameters of an action's path, in order. */
export function pathParamsOf(a: ActionInfo): string[] {
  return [...a.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]!);
}

function typesOf(s: JsonSchema): string[] {
  if (s.type) return [s.type];
  if (s.anyOf) return s.anyOf.flatMap(typesOf);
  return ["string"];
}

/** One value from text, by the property's schema. */
export function coerce(name: string, raw: string, s: JsonSchema): unknown {
  const types = typesOf(s);
  for (const t of types) {
    if (t === "integer" && /^-?\d+$/.test(raw.trim())) return Number(raw);
    if (t === "number" && raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
    if (t === "boolean" && (raw === "true" || raw === "false")) return raw === "true";
    if (t === "object") {
      if (raw.trim().startsWith("{")) return parseJson(name, raw);
      const eq = raw.indexOf("=");
      if (eq > 0) return { [raw.slice(0, eq)]: raw.slice(eq + 1) };
    }
    if (t === "array") {
      if (raw.trim().startsWith("[")) return parseJson(name, raw);
      const items = s.items ?? { type: "string" };
      return raw.split(",").map((x) => x.trim()).filter((x) => x !== "").map((x) => coerce(name, x, items));
    }
    if (t === "string") return raw;
  }
  throw new UsageError(`--${kebab(name)} takes ${types.join(" or ")}, not "${raw}".`);
}

function parseJson(name: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new UsageError(`--${kebab(name)}: "${raw}" isn't valid JSON.`);
  }
}

function merge(name: string, s: JsonSchema, before: unknown, value: unknown): unknown {
  if (before === undefined) return value;
  const types = typesOf(s);
  if (types.includes("array") && Array.isArray(before) && Array.isArray(value)) return [...before, ...value];
  if (types.includes("object") && typeof before === "object" && typeof value === "object" && before && value) return { ...before, ...value };
  throw new UsageError(`--${kebab(name)} is given twice.`);
}

export interface Parsed {
  input: Record<string, unknown>;
  /** Flags the command itself reads (not action input): `--yes`, `--json`, … */
  own: Set<string>;
}

/**
 * Parses arguments for an action. `ownFlags` are boolean flags the command handles itself and
 * `ownValues` flags with a value (both are kept out of the input).
 */
export function parseActionArgs(
  action: ActionInfo,
  args: readonly string[],
  opts: { ownFlags?: readonly string[]; ownValues?: Record<string, (v: string) => void> } = {},
): Parsed {
  const props = action.input.properties;
  const byFlag = new Map<string, string>();
  for (const key of Object.keys(props)) {
    byFlag.set(key, key);
    byFlag.set(kebab(key), key);
  }
  const input: Record<string, unknown> = {};
  const own = new Set<string>();
  const positionals: string[] = [];
  const set = (key: string, value: unknown) => (input[key] = merge(key, props[key]!, input[key], value));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--") || arg === "--") {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    let value: string | undefined = eq > 0 ? arg.slice(eq + 1) : undefined;
    if (opts.ownFlags?.includes(flag)) {
      own.add(flag);
      continue;
    }
    const ownValue = opts.ownValues?.[flag];
    if (ownValue) {
      value ??= args[++i];
      if (value === undefined) throw new UsageError(`--${flag} needs a value.`);
      ownValue(value);
      continue;
    }
    let key = byFlag.get(flag) ?? byFlag.get(camel(flag));
    if (!key && flag.startsWith("no-")) {
      const neg = byFlag.get(flag.slice(3)) ?? byFlag.get(camel(flag.slice(3)));
      if (neg && typesOf(props[neg]!).includes("boolean") && value === undefined) {
        set(neg, false);
        continue;
      }
    }
    if (!key) {
      // `--param k=v` for an object property named in the plural (`params`).
      const plural = byFlag.get(`${flag}s`) ?? byFlag.get(camel(`${flag}s`));
      if (plural && typesOf(props[plural]!).includes("object")) key = plural;
    }
    if (!key) throw new UsageError(`Unknown option --${flag} for ${action.name}. Options: ${Object.keys(props).map((k) => `--${kebab(k)}`).join(", ") || "none"}.`);
    const schema = props[key]!;
    if (value === undefined && typesOf(schema).includes("boolean")) {
      const next = args[i + 1];
      if (next === "true" || next === "false") value = args[++i];
      else {
        set(key, true);
        continue;
      }
    }
    value ??= args[++i];
    if (value === undefined) throw new UsageError(`--${flag} needs a value.`);
    set(key, coerce(key, value, schema));
  }
  const params = pathParamsOf(action).filter((p) => input[p] === undefined);
  if (positionals.length > params.length) {
    throw new UsageError(`Too many arguments for ${action.name}: ${positionals.slice(params.length).join(" ")}. ${params.length ? `It takes ${params.map((p) => `<${p}>`).join(" ")} in order; the rest are --options.` : "Its input goes in --options."}`);
  }
  positionals.forEach((v, i) => set(params[i]!, coerce(params[i]!, v, props[params[i]!] ?? { type: "string" })));
  return { input, own };
}

/** `--help` text for an action. */
export function actionHelp(a: ActionInfo, command: string): string {
  const params = pathParamsOf(a);
  const required = new Set(a.input.required ?? []);
  const lines = [`${command} ${params.map((p) => `<${p}>`).join(" ")}`.trim(), "", a.title + "."];
  if (a.agent?.say) lines.push(a.agent.say);
  if (a.destructive) lines.push("Deletes data: asks you first on a terminal; called from elsewhere, it waits for approval on the web page.");
  const opts = Object.entries(a.input.properties).filter(([k]) => !params.includes(k));
  if (opts.length) {
    lines.push("", "Options:");
    for (const [k, s] of opts) {
      const type = s.enum ? s.enum.join("|") : typesOf(s).join("|");
      const extra = [required.has(k) ? "required" : "", s.default !== undefined ? `default ${JSON.stringify(s.default)}` : ""].filter(Boolean).join(", ");
      lines.push(`  --${kebab(k)} <${type}>${extra ? ` (${extra})` : ""}${s.description ? `  ${s.description}` : ""}`);
    }
  }
  lines.push("", `Action ${a.name}: ${a.method} ${a.path}. Prints the answer's data as JSON.`);
  return lines.join("\n");
}
