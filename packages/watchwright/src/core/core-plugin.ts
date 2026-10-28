import { ActionError, describeAction, defineAction } from "../actions/registry.js";
import { EVENTS_MIGRATION_SQL } from "../events/log.js";
import { ACTIONS } from "./keys.js";
import { VERSION } from "../version.js";
import { definePlugin } from "./plugin.js";

export interface HealthData {
  name: "watchwright";
  version: string;
  dataDir: string;
  /** Loaded plugins with the newest store migration each one applied. */
  plugins: { name: string; schemaVersion: number }[];
}

/** Longest wait `GET /events` accepts, in seconds; under common proxy and client timeouts. */
export const MAX_EVENT_WAIT_S = 110;

/** The server's own plugin: the meta table, the event log, /health, /actions and /events. */
export const corePlugin = definePlugin({
  name: "core",
  migrations: [
    {
      id: 1,
      name: "init",
      sql: `
        CREATE TABLE meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `,
    },
    { id: 2, name: "events", sql: EVENTS_MIGRATION_SQL },
  ],
  actions: ({ events, services, stop }) => [
    defineAction({
      name: "core.actions",
      agent: { tool: "list_actions", say: "Every action the server has, for call_action." },
      title: "List every action with its input schema",
      method: "GET",
      path: "/actions",
      handler: () => services.get(ACTIONS).map(describeAction),
    }),
    defineAction({
      name: "core.stop",
      destructive: true,
      explain: () => "Stop the Watchwright server. Runs going now become interrupted, ready to resume when it starts again.",
      title: "Stop the server: runs going now become interrupted, ready to resume when it starts again",
      method: "POST",
      path: "/stop",
      handler: () => {
        if (!stop) throw new ActionError("cant_stop", "This server wasn't started by the watchwright command, so it can't stop itself.", 409);
        // After the answer has gone out.
        setTimeout(stop, 200);
        return { stopping: true };
      },
    }),
    defineAction<{ after?: number; wait?: number; runId?: string; types?: string; limit?: number }>({
      name: "core.events",
      title: "Read events after a cursor, waiting for new ones when there are none",
      method: "GET",
      path: "/events",
      input: {
        type: "object",
        properties: {
          after: { type: "integer", minimum: 0, default: 0, description: "Return events with a sequence number above this." },
          wait: { type: "number", minimum: 0, maximum: MAX_EVENT_WAIT_S, default: 0, description: "Seconds to wait when there are no events yet." },
          runId: { type: "string", description: "Only events of this run (plus events that belong to no run)." },
          types: { type: "string", description: "Comma-separated event types; `run.*` matches a prefix." },
          limit: { type: "integer", minimum: 1, maximum: 1000, default: 500 },
        },
      },
      handler: async ({ after = 0, wait = 0, runId, types, limit = 500 }, { signal }) => {
        const filter = { runId, types: types ? types.split(",").map((t) => t.trim()).filter(Boolean) : undefined };
        const list = await events.wait(after, wait * 1000, filter, limit, signal);
        return { events: list, next: list.length > 0 ? list[list.length - 1]!.seq : Math.max(after, 0), head: events.head() };
      },
    }),
  ],
  routes(app, { store, plugins }) {
    app.get("/health", async () => {
      const data: HealthData = {
        name: "watchwright",
        version: VERSION,
        dataDir: store.dataDir,
        plugins: plugins.map((name) => ({ name, schemaVersion: store.schemaVersion(name) })),
      };
      return { data };
    });
  },
});
