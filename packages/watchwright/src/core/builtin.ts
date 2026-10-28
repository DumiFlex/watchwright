import { agentsPlugin } from "../plugins/agents/plugin.js";
import { approvalsPlugin } from "../plugins/approvals/plugin.js";
import { livePlugin } from "../plugins/live/plugin.js";
import { editorPlugin } from "../plugins/editor/plugin.js";
import { foldersPlugin } from "../plugins/folders/plugin.js";
import { packsPlugin } from "../plugins/packs/plugin.js";
import { settingsPlugin } from "../plugins/settings/plugin.js";
import { reviewsPlugin } from "../plugins/reviews/plugin.js";
import { recordPlugin } from "../plugins/record/plugin.js";
import { runsPlugin } from "../plugins/runs/plugin.js";
import { testingPlugin } from "../plugins/testing/plugin.js";
import { corePlugin } from "./core-plugin.js";

/** The plugins every server loads, in order. A plugin can use the services of the ones before it. */
export const BUILTIN_PLUGINS = [corePlugin, settingsPlugin, approvalsPlugin, livePlugin, foldersPlugin, packsPlugin, editorPlugin, runsPlugin, testingPlugin, recordPlugin, reviewsPlugin, agentsPlugin];
