import type { Action, ActionGate } from "../actions/registry.js";
import { serviceKey } from "./services.js";

/** Every action the loaded plugins declare (the core lists them at GET /actions). */
export const ACTIONS = serviceKey<readonly Action[]>("actions");

/** Asked before a destructive action runs; the approvals plugin provides it. */
export const ACTION_GATE = serviceKey<ActionGate>("action-gate");
