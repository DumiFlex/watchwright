// Writes the docs site's "YAML steps" page from the step list (see src/plugins/packs/yaml/reference.ts).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stepsReference } from "../src/plugins/packs/yaml/reference.js";

writeFileSync(fileURLToPath(new URL("../../site/reference/yaml-steps.md", import.meta.url)), stepsReference());
