// Writes the JSON Schemas for YAML test files and pack.yaml into dist/schema, after tsc.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packSchema, testFileSchema } from "../dist/plugins/packs/yaml/schema.js";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "schema");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "test.json"), `${JSON.stringify(testFileSchema(), null, 2)}\n`);
writeFileSync(path.join(out, "pack.json"), `${JSON.stringify(packSchema(), null, 2)}\n`);
