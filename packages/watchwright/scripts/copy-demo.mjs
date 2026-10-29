// Copies the TodoMVC example pack into dist/demo, after tsc: `watchwright demo` runs it.
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "dist", "demo", "todomvc");
rmSync(out, { recursive: true, force: true });
cpSync(path.join(here, "..", "..", "..", "examples", "todomvc"), out, { recursive: true });
