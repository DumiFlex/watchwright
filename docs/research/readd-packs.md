# Removed packs: adding them again, updating them, deleting their files

## What happened

On a self-hosted server (Docker, packs under `/packs`), removing a pack left its folder on the server, as designed. But from the web page there was then no way forward:

- **Upload .zip** with the same folder name was refused: `409 exists`, "pick another name". So a pack couldn't be updated from a zip, and a removed one couldn't come back the same way.
- **Add a pack** listed the leftover folders (`bench`, `smoke`, badged "Pack"), but adding one took opening the folder first and then **Add this pack**; with the dialog open on `/packs`, the button was disabled and the footer said "No pack file in this folder", which reads as a dead end.
- There was no way to delete a pack's files without a terminal.
- A pack added again got a new id, so its earlier runs, schedules and dashboard stayed with the old, removed id.

## Options

1. **Upload onto an existing folder.** (a) Merge the zip's files over the folder: stale tests linger, and a renamed file leaves its old copy behind. (b) Replace the folder: the zip is the pack, as Download .zip makes it. Replace, with a confirm that names the packs added from the folder. Unpack beside the folder and swap by renaming, so a bad zip or a locked file (Windows) leaves the old files untouched. Keep `node_modules` and `.git` (the zip never has them; a pack with installed dependencies would otherwise break).
2. **Keep runs linked.** (a) Soft-delete packs (a `removed_at` column): only works for packs removed from now on. (b) Runs already carry `pack_id` and `pack_path`: re-adding a pack file gives it the id of its newest run, when no pack uses that id. Covers packs removed before this change too. The registry asks through a `PackLinks` hook the runs plugin registers, so packs doesn't read the runs table.
3. **Delete files on remove.** An admin-only option on remove (`deleteFiles`), with guards: the folder must be one the browser shows, must not hold one of its places, the home folder or the data folder, must not hold another added pack, and no run of the pack may be going on.
4. **Folder browser.** An **Add** button on the row of each pack folder that isn't added, "Added" on those that are, and a footer that points at them.

## Decision

All four (1b, 2b, 3, 4). Replace and delete both refuse while a run of an affected pack is running, pausing or paused (`pack_busy`), so a long bench is never pulled from under itself.

Shared parent files (#215): a zip of `bench/` uploaded onto `/packs/bench` replaces the whole folder and updates both `bench` and `bench/smoke`. A `bench-smoke.zip` (made by Download .zip of `smoke`) holds only the shared files `smoke` imports, so its default folder name stays the zip's name (`bench-smoke`): defaulting to the zip's top folder (`bench`) would offer to replace the full `bench` folder with a partial one. Deleting `bench`'s files is refused while `smoke` is added from inside it; remove `smoke` (with its files) first.
