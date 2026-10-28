import type { Action, ActionGate } from "../actions/registry.js";
import type { PluginPage } from "./plugin.js";
import { serviceKey } from "./services.js";

/** The web app's pages the loaded plugins bring, in menu order (the core lists them at GET /health). */
export const PAGES = serviceKey<readonly (PluginPage & { plugin: string })[]>("pages");

/** Every action the loaded plugins declare (the core lists them at GET /actions). */
export const ACTIONS = serviceKey<readonly Action[]>("actions");

/** Asked before a destructive action runs; the approvals plugin provides it. */
export const ACTION_GATE = serviceKey<ActionGate>("action-gate");
