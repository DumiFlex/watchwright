import { livePlugin } from "../plugins/live/plugin.js";
import { packsPlugin } from "../plugins/packs/plugin.js";
import { runsPlugin } from "../plugins/runs/plugin.js";
import { corePlugin } from "./core-plugin.js";

/** The plugins every server loads, in order. A plugin can use the services of the ones before it. */
export const BUILTIN_PLUGINS = [corePlugin, livePlugin, packsPlugin, runsPlugin];
