import { VERSION } from "../version.js";
import { definePlugin } from "./plugin.js";

export interface HealthData {
  name: "watchwright";
  version: string;
  dataDir: string;
  /** Loaded plugins with the newest store migration each one applied. */
  plugins: { name: string; schemaVersion: number }[];
}

/** The server's own plugin: the meta table, /health and the live WebSocket. */
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

    // The live channel. Step 1 streams the event log and screencast frames here (docs/plan.md, section 8);
    // for now it only greets, so the web app can show that the connection works.
    app.get("/live", { websocket: true }, (socket) => {
      socket.send(JSON.stringify({ type: "hello", data: { version: VERSION } }));
    });
  },
});

/** The plugins every server loads, in order. */
export const BUILTIN_PLUGINS = [corePlugin];
