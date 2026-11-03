import { definePlugin } from "../../core/plugin.js";
import { JOB_KINDS } from "../runs/plugin.js";
import { taskKind } from "./kind.js";

/** Tasks: the `task` job kind, a pack's named steps run on their own. Loaded after `runs`. */
export const tasksPlugin = definePlugin({
  name: "tasks",
  setup({ services }) {
    services.get(JOB_KINDS).register(taskKind);
  },
});
