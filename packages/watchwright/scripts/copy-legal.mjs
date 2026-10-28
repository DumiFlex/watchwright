// Copies the repository's LICENSE and NOTICE into this package before `npm pack` / `npm publish`,
// so the published tarball carries them (npm only picks them up from the package's own folder).
import { copyFileSync } from "node:fs";

for (const file of ["LICENSE", "NOTICE"]) copyFileSync(new URL(`../../../${file}`, import.meta.url), new URL(`../${file}`, import.meta.url));
