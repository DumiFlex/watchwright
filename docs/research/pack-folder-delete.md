# Deleting nested packs, upload leftovers and loose folders

After #225 a pack could be removed with its files, but three cases still left files on a server with no desktop:

1. **A folder no added pack uses.** A pack that was never added, or one removed without its files (an older `/packs/smoke` next to a newer `/packs/bench/smoke`), could only be deleted by adding it first and removing it again.
2. **Nested packs.** `bench/` holding the pack `bench/smoke/`: deleting bench's files was refused (`folder_shared`) until smoke was removed first, in a second dialog.
3. **Shared files from one zip.** A zip of `shared/`, `bench/` and `smoke/` unpacks into `/packs/wp/`. Deleting each pack's files removes `wp/bench` and `wp/smoke`; `wp/shared` and `wp/` stay, and nothing in the app could delete them.

## What other tools do

Package managers keep a record of what an install wrote (npm's lockfile, pip's `RECORD`) and remove only files nothing else owns; a "prune"/"autoremove" step clears what is left over. Watchwright has no install record for older uploads, so it works it out from the folder tree: a folder is a leftover when no added pack lives in it.

## Choice

- `DELETE /packs/folder?path=` (admins, destructive): deletes a folder no added pack uses. With `WATCHWRIGHT_FOLDERS` (servers, Docker) any folder inside those may go; on a server that shows the whole machine, only folders with a pack file in them or below (4 levels), so it never becomes a general "delete any folder" tool. The same guards as remove: not a shown root, the home folder or the data folder.
- `DELETE /packs/:id?deleteFiles=true&nested=true`: removes the packs inside the folder with it. The dialog lists them and always sends `nested`, so it is one step.
- `GET /packs/:id/remove-plan` + `leftover=true`: the highest folder above the pack's, below a shown root, that holds no other added pack. The remove dialog offers it as "Delete the whole uploaded folder" for the last pack of an upload. Only with `WATCHWRIGHT_FOLDERS`: without it the tree above a pack is the person's own disk.

No install record (no migration); packs uploaded before this change get the same help.
