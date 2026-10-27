// Hash routes (#/…): the server serves one index.html, so the page address after # picks the
// view. Each route has its own address, so a run, a pack or a filtered list can be linked to.
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export type Route =
  | { name: "runs"; query: Record<string, string> }
  | { name: "new"; query: Record<string, string> }
  | { name: "run"; id: string }
  | { name: "attempt"; runId: string; attemptId: string }
  | { name: "packs"; query: Record<string, string> }
  | { name: "pack"; id: string }
  /** The editor: a pack's file (null for the first one), optionally at a line; `record` starts Record there. */
  | { name: "edit"; id: string; file: string | null; line: number | null; record?: boolean }
  | { name: "compare"; query: Record<string, string> }
  | { name: "kit" }
  | { name: "settings" };

const ID8 = "([0-9a-f]{8})";

function queryOf(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) if (v !== "") out[k] = v;
  return out;
}

/** Reads a location hash such as `#/runs/0a1b2c3d` or `#/?pack=…`. Unknown addresses show the runs list. */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const q = raw.indexOf("?");
  const path = q === -1 ? raw : raw.slice(0, q);
  const query = queryOf(q === -1 ? "" : raw.slice(q + 1));
  let m: RegExpExecArray | null;
  if (path === "/new") return { name: "new", query };
  if (path === "/packs") return { name: "packs", query };
  if (path === "/kit") return { name: "kit" };
  if (path === "/settings") return { name: "settings" };
  if (path === "/compare") return { name: "compare", query };
  if ((m = new RegExp(`^/runs/${ID8}$`).exec(path))) return { name: "run", id: m[1]! };
  if ((m = new RegExp(`^/runs/${ID8}/attempts/([0-9a-f]{12})$`).exec(path))) return { name: "attempt", runId: m[1]!, attemptId: m[2]! };
  if ((m = new RegExp(`^/packs/${ID8}$`).exec(path))) return { name: "pack", id: m[1]! };
  if ((m = new RegExp(`^/packs/${ID8}/edit(?:/(.+))?$`).exec(path))) {
    let file: string | null;
    try {
      file = m[2] ? m[2].split("/").map(decodeURIComponent).join("/") : null;
    } catch {
      file = null;
    }
    const line = Number(query.line);
    return { name: "edit", id: m[1]!, file, line: Number.isInteger(line) && line > 0 ? line : null, ...(query.record === "1" ? { record: true } : {}) };
  }
  return { name: "runs", query: path === "/" ? query : {} };
}

/** The hash for a route: the inverse of parseRoute. Empty query values are left out. */
export function href(route: Route): string {
  const qs = (query: Record<string, string>) => {
    const s = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "")).toString();
    return s ? `?${s}` : "";
  };
  switch (route.name) {
    case "runs":
      return `#/${qs(route.query)}`;
    case "new":
      return `#/new${qs(route.query)}`;
    case "run":
      return `#/runs/${route.id}`;
    case "attempt":
      return `#/runs/${route.runId}/attempts/${route.attemptId}`;
    case "packs":
      return `#/packs${qs(route.query)}`;
    case "pack":
      return `#/packs/${route.id}`;
    case "edit":
      return `#/packs/${route.id}/edit${route.file ? `/${route.file.split("/").map(encodeURIComponent).join("/")}` : ""}${qs({ ...(route.line ? { line: String(route.line) } : {}), ...(route.record ? { record: "1" } : {}) })}`;
    case "compare":
      return `#/compare${qs(route.query)}`;
    case "kit":
      return "#/kit";
    case "settings":
      return "#/settings";
  }
}

/** Which top bar section a route belongs to. */
export function sectionOf(route: Route): "runs" | "packs" | "compare" | null {
  if (route.name === "runs" || route.name === "run" || route.name === "attempt" || route.name === "new") return "runs";
  if (route.name === "packs" || route.name === "pack" || route.name === "edit") return "packs";
  if (route.name === "compare") return "compare";
  return null;
}

/** The current route, kept in step with the address. */
export function useRoute(): Ref<Route> {
  const route = ref<Route>(parseRoute(window.location.hash));
  const onHash = () => {
    const next = parseRoute(window.location.hash);
    // Changing only the query (filters) keeps the scroll position; a new page starts at the top.
    if (href(next).split("?")[0] !== href(route.value).split("?")[0]) window.scrollTo(0, 0);
    route.value = next;
  };
  onMounted(() => window.addEventListener("hashchange", onHash));
  onBeforeUnmount(() => window.removeEventListener("hashchange", onHash));
  return route;
}

/** Replaces the address without adding a history entry (for filters as they change). */
export function replaceRoute(route: Route): void {
  const h = href(route);
  if (window.location.hash !== h) window.history.replaceState(null, "", h);
}
