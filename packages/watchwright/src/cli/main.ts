#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { BUILTIN_PLUGINS } from "../core/builtin.js";
import { migrationsOf } from "../core/plugin.js";
import { DEFAULT_HOST, DEFAULT_PORT, LOOPBACK_HOSTS, resolveDataDir } from "../config.js";
import { buildServer } from "../server/app.js";
import { openStore } from "../store/db.js";
import { VERSION } from "../version.js";

const HELP = `Watchwright ${VERSION}

Usage:
  watchwright serve [--port ${DEFAULT_PORT}] [--host ${DEFAULT_HOST}] [--data <folder>] [--no-open]
  watchwright --version

serve      Starts the server: the web app, the HTTP API and the store. It stays up between runs.
--port     Port to listen on (default ${DEFAULT_PORT}).
--host     Address to bind. Only loopback addresses for now (127.0.0.1, localhost, ::1).
--data     Folder for the database and run files (default: WATCHWRIGHT_DATA, else the OS's app data folder).
--no-open  Don't open the web page in the browser on start.
`;

async function main(argv: string[]): Promise<number> {
  // Pack bundles carry inline source maps: errors then point at the pack's own files and lines.
  process.setSourceMapsEnabled(true);
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      data: { type: "string" },
      "no-open": { type: "boolean" },
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

  // Playwright can throw from its own message loop when a browser goes away mid-call (a run
  // stopped at the wrong moment). That must not take the server and every other run down with it.
  process.on("uncaughtException", (err) => {
    if (/was not bound in the connection|Cannot find object to/.test(err.message)) {
      console.error(`Ignored a Playwright error after a browser closed: ${err.message}`);
      return;
    }
    console.error(err);
    process.exit(1);
  });

  await app.listen({ port, host });
  const shown = host === "::1" ? "[::1]" : host;
  const url = `http://${shown}:${port}/`;
  console.log(`Watchwright ${VERSION} is running at ${url}`);
  console.log(`Data folder: ${dataDir}`);
  if (!values["no-open"]) openBrowser(url);
  return -1; // keep running
}

/** Opens the web page in the default browser. Failing to open it is not an error: the address is printed. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // no opener on this system
  }
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
