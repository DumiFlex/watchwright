#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BUILTIN_PLUGINS } from "../core/core-plugin.js";
import { migrationsOf } from "../core/plugin.js";
import { DEFAULT_HOST, DEFAULT_PORT, LOOPBACK_HOSTS, resolveDataDir } from "../config.js";
import { buildServer } from "../server/app.js";
import { openStore } from "../store/db.js";
import { VERSION } from "../version.js";

const HELP = `Watchwright ${VERSION}

Usage:
  watchwright serve [--port ${DEFAULT_PORT}] [--host ${DEFAULT_HOST}] [--data <folder>]
  watchwright --version

serve      Starts the server: the web app, the HTTP API and the store. It stays up between runs.
--port     Port to listen on (default ${DEFAULT_PORT}).
--host     Address to bind. Only loopback addresses for now (127.0.0.1, localhost, ::1).
--data     Folder for the database and run files (default: WATCHWRIGHT_DATA, else the OS's app data folder).
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      data: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const command = positionals[0];
  if (values.help || command === undefined) {
    console.log(HELP);
    return command === undefined && !values.help ? 1 : 0;
  }
  if (command !== "serve") {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }

  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be a whole number from 1 to 65535, got "${values.port}".`);
    return 1;
  }
  const host = values.host ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.includes(host)) {
    console.error(`--host ${host} would open the server to other machines. That needs token auth, which isn't built yet; use 127.0.0.1.`);
    return 1;
  }

  const dataDir = resolveDataDir({ flag: values.data });
  const plugins = BUILTIN_PLUGINS;
  const store = openStore(dataDir, migrationsOf(plugins));
  const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
  const app = await buildServer({ store, port, webRoot, plugins });
  const shutdown = async () => {
    await app.close();
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await app.listen({ port, host });
  const shown = host === "::1" ? "[::1]" : host;
  console.log(`Watchwright ${VERSION} is running at http://${shown}:${port}/`);
  console.log(`Data folder: ${dataDir}`);
  return -1; // keep running
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
