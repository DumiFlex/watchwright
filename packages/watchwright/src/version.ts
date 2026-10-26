import { readFileSync } from "node:fs";

// src/version.ts and dist/version.js both sit one folder below package.json.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

export const VERSION: string = pkg.version;
