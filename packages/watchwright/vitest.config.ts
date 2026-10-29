import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "watchwright",
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Most tests here start a real server, many a browser too. Vitest's 5 s default is tight on a
    // busy CI runner (Windows above all), so they get longer; a test that waits on a run sets its own.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
