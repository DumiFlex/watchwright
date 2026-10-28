// Writes the agent skill's references from the docs site's pages (see src/plugins/agents/skill.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { references, SKILL_DIR } from "../src/plugins/agents/skill.js";

const dir = path.join(SKILL_DIR, "references");
mkdirSync(dir, { recursive: true });
for (const [file, text] of references(fileURLToPath(new URL("../../site/", import.meta.url)))) writeFileSync(path.join(dir, file), text);
