import { ActionError, defineAction } from "../../actions/registry.js";
import { definePlugin } from "../../core/plugin.js";
import { FOLDERS, FOLDERS_MIGRATION_SQL, FolderError, FolderService } from "./folders.js";

const STATUS: Record<FolderError["code"], number> = { bad_path: 400, not_found: 404, not_a_folder: 400, unreadable: 403, not_allowed: 403 };

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof FolderError) throw new ActionError(err.code, err.message, STATUS[err.code]);
    throw err;
  }
}

/** Folders on this machine: listing them for the web app's folder browser, recent ones, opening known ones. */
export const foldersPlugin = definePlugin({
  name: "folders",
  migrations: [{ id: 1, name: "recent", sql: FOLDERS_MIGRATION_SQL }],
  setup({ store, services }) {
    services.provide(FOLDERS, new FolderService(store.db, { dataDir: store.dataDir }));
  },
  actions: ({ services }) => {
    const folders = services.get(FOLDERS);
    return [
      defineAction<{ path: string; hidden?: boolean }>({
        name: "folders.list",
        title: "List the folders inside a folder, marking the ones plugins care about (pack folders)",
        method: "GET",
        path: "/folders",
        input: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1, description: "Absolute folder path. Quotes, `file://` and `~` are accepted." },
            hidden: { type: "boolean", default: false, description: "Include hidden and system folders." },
          },
          required: ["path"],
        },
        handler: ({ path, hidden }) => wrap(() => folders.list(path, { hidden: hidden ?? false })),
      }),
      defineAction({
        name: "folders.places",
        title: "Where to start browsing: the home folder, drives or root, and recent folders",
        method: "GET",
        path: "/folders/places",
        handler: () => folders.places(),
      }),
      defineAction<{ path?: string }>({
        name: "folders.forget",
        title: "Remove one folder, or all of them, from the recent folders",
        method: "DELETE",
        path: "/folders/recent",
        input: { type: "object", properties: { path: { type: "string", description: "The folder to forget; leave out to clear the list." } } },
        handler: ({ path }) => {
          folders.forget(path);
          return folders.places().recent;
        },
      }),
      defineAction<{ path: string }>({
        name: "folders.open",
        title: "Show a pack folder or a run folder in the system's file manager",
        method: "POST",
        path: "/folders/open",
        input: { type: "object", properties: { path: { type: "string", minLength: 1 } }, required: ["path"] },
        handler: ({ path }) => wrap(() => ({ opened: folders.open(path) })),
      }),
    ];
  },
});
