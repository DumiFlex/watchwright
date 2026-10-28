import { definePlugin } from "../../core/plugin.js";
import { JOB_KINDS } from "../runs/plugin.js";
import { testKind } from "./kind.js";

/** Testing: the `test` job kind (a pack's tests, `h`, outcomes). Loaded after `runs`. */
export const testingPlugin = definePlugin({
  name: "testing",
  setup({ services }) {
    services.get(JOB_KINDS).register(testKind);
  },
});
