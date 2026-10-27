// Hash routes (#/…): the server serves one index.html, so the page address after # picks the
// view. Each route has its own address, so a run, a pack or a filtered list can be linked to.
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export type Route =
  | { name: "runs"; query: Record<string, string> }
  | { name: "new"; query: Record<string, string> }
  | { name: "run"; id: string }
  | { name: "attempt"; runId: string; attemptId: string }
  | { name: "packs" }
  | { name: "pack"; id: string }
  | { name: "compare"; query: Record<string, string> }
  | { name: "kit" };

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
  if (path === "/packs") return { name: "packs" };
  if (path === "/kit") return { name: "kit" };
  if (path === "/compare") return { name: "compare", query };
  if ((m = new RegExp(`^/runs/${ID8}$`).exec(path))) return { name: "run", id: m[1]! };
  if ((m = new RegExp(`^/runs/${ID8}/attempts/([0-9a-f]{12})$`).exec(path))) return { name: "attempt", runId: m[1]!, attemptId: m[2]! };
  if ((m = new RegExp(`^/packs/${ID8}$`).exec(path))) return { name: "pack", id: m[1]! };
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
      return "#/packs";
    case "pack":
      return `#/packs/${route.id}`;
    case "compare":
      return `#/compare${qs(route.query)}`;
    case "kit":
      return "#/kit";
  }
}

/** Which top bar section a route belongs to. */
export function sectionOf(route: Route): "runs" | "packs" | "compare" | null {
  if (route.name === "runs" || route.name === "run" || route.name === "attempt" || route.name === "new") return "runs";
  if (route.name === "packs" || route.name === "pack") return "packs";
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
