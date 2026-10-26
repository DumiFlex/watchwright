import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/watchwright", "packages/web", "packages/site"],
  },
});
