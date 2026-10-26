import type { Collector, CollectorRecord } from "../packs/api.js";

// Built-in collectors. Each listens on the browser context and records what it sees; the engine
// stores each attempt's records as `collectors/<name>.json`. Secrets in headers are redacted.

const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? "[redacted]" : v;
  return out;
}

function matcher(match: string | RegExp | undefined): (url: string) => boolean {
  if (match === undefined) return () => true;
  if (typeof match === "string") return (url) => url.includes(match);
  return (url) => match.test(url);
}

/** Console errors and uncaught page errors. */
export function consoleErrors(options: { warnings?: boolean } = {}): Collector {
  return {
    name: "console-errors",
    attach(context, record) {
      context.on("console", (msg) => {
        const type = msg.type();
        if (type !== "error" && !(options.warnings && type === "warning")) return;
        const loc = msg.location();
        record({ type, text: msg.text(), url: loc.url || null, line: loc.lineNumber, page: msg.page()?.url() ?? null });
      });
      context.on("weberror", (err) => {
        const e = err.error();
        record({ type: "pageerror", text: e.message, stack: e.stack ?? null, page: err.page()?.url() ?? null });
      });
    },
  };
}

/** Requests that failed to complete, and responses with status 400 or more. */
export function failedRequests(options: { match?: string | RegExp } = {}): Collector {
  const wanted = matcher(options.match);
  return {
    name: "failed-requests",
    attach(context, record) {
      context.on("requestfailed", (req) => {
        if (!wanted(req.url())) return;
        record({ method: req.method(), url: req.url(), failure: req.failure()?.errorText ?? "failed", resourceType: req.resourceType() });
      });
      context.on("response", (res) => {
        if (res.status() < 400 || !wanted(res.url())) return;
        record({ method: res.request().method(), url: res.url(), status: res.status(), resourceType: res.request().resourceType() });
      });
    },
  };
}

/** Responses whose URL matches, with redacted headers and (optionally) text bodies up to `maxBody` bytes. */
export function responses(options: { match?: string | RegExp; bodies?: boolean; maxBody?: number } = {}): Collector {
  const wanted = matcher(options.match);
  const maxBody = options.maxBody ?? 64 * 1024;
  return {
    name: "responses",
    attach(context, record) {
      context.on("response", (res) => {
        if (!wanted(res.url())) return;
        const req = res.request();
        const entry: CollectorRecord = {
          time: new Date().toISOString(),
          method: req.method(),
          url: res.url(),
          status: res.status(),
          requestHeaders: redactHeaders(req.headers()),
          responseHeaders: redactHeaders(res.headers()),
        };
        const type = res.headers()["content-type"] ?? "";
        if (!options.bodies || !/json|text|xml|javascript/.test(type)) {
          record(entry);
          return;
        }
        res.text().then(
          (text) => record({ ...entry, body: text.length > maxBody ? `${text.slice(0, maxBody)}…[cut]` : text }),
          () => record(entry),
        );
      });
    },
  };
}
