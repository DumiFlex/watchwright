# Packs that share files with the folder above them

## What happened

A self-hosted server (Docker) showed the pack `smoke` at `/packs/smoke` as failing to build:

```
pack.ts:7 Could not resolve "../bench.js"
pack.ts:8 Could not resolve "../shared.js"
```

The pack lives in `bench/smoke/` of its project and imports helpers from `bench/` (the folder of a second, bigger pack). Only `smoke/` reached the server. Nothing was wrong in the pack or in the build: the files simply weren't there. But nothing told the person that, and none of the ways to move a pack could bring the shared files along:

- **Download .zip** zipped only the pack's folder.
- **Upload .zip** wanted a pack file at the zip's top (or in one folder at its top), so a zip of `bench/` gave the `bench` pack only, and a zip of shared files with the pack in a subfolder was refused.
- **Find packs here** stopped at a pack folder, so `bench/smoke` was never offered once `bench/` was a pack.

## Options

1. **Make the parent the pack root** (build from `bench/`). Changes what a pack is (its folder is its identity: README, editor, test glob, stamps), and the server can't know which parent to pick. No.
2. **Bring the imported files along** when a pack moves. The build already knows every source file (esbuild's metafile), so the files outside the pack's folder are exactly the ones it needs. Zip them at their place relative to the pack, starting at the folder that holds them all. Small, general, nothing to configure.
3. **Explain the failure.** An esbuild "Could not resolve" for a relative import whose target is outside the pack's folder is this case in nearly every instance. Say so, with where it looked and how to fix it.

## Decision

2 and 3, plus the two discover/upload gaps:

- The loader records `outside`: the build's inputs outside the pack's folder (not `node_modules`).
- **Download .zip** includes them, when the folder browser may show them (`WATCHWRIGHT_FOLDERS`). The zip starts at their common folder and is named `<that folder>-<pack>.zip` (`bench-smoke.zip`), so unpacking it next to another download of `bench` doesn't clash.
- **Upload .zip** accepts a zip whose pack sits below shared files and adds every pack in it: the pack at the top and its direct subfolders that are packs, or each pack folder when there is none at the top. Deeper pack files inside a pack stay its fixtures, as before.
- **Find packs here** looks in a pack's direct subfolders too, by the same rule.
- A missing import outside the folder gives "The pack imports files from outside its folder that aren't on this server. Copy the folder above it too, or upload a zip of that folder.", with one line per import naming the folder it looked in, and the pack page explains how to fix it instead of "fix the files and save".

The editor still shows only the pack's own folder; editing the shared files is done in the other pack, or on disk.
