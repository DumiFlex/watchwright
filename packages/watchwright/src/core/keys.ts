import type { Action } from "../actions/registry.js";
import { serviceKey } from "./services.js";

/** Every action the loaded plugins declare (the core lists them at GET /actions). */
export const ACTIONS = serviceKey<readonly Action[]>("actions");
