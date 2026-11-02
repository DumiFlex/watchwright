// Where a dashboard tile's links go. In the app a run or an attempt opens its page; on the public
// status page and on a shared run there are no such pages, so a run opens read-only (when the
// status page lets its runs open) or nothing does, and buttons that need an account are hidden.
import { inject, provide, type InjectionKey } from "vue";
import { href } from "./router";

export interface TileLinks {
  run(id: string): string | null;
  attempt(runId: string, attemptId: string): string | null;
  /** Buttons that need an account (score an attempt, start a run) show. */
  actions: boolean;
}

const KEY: InjectionKey<TileLinks> = Symbol("tile-links");

export const appLinks: TileLinks = {
  run: (id) => href({ name: "run", id }),
  attempt: (runId, attemptId) => href({ name: "attempt", runId, attemptId }),
  actions: true,
};

/** Links for public pages: runs open read-only when `openRuns`, otherwise nothing links. */
export function publicLinks(openRuns: boolean): TileLinks {
  const run = (id: string) => (openRuns ? href({ name: "status-run", id }) : null);
  return { run, attempt: (runId) => run(runId), actions: false };
}

export const provideTileLinks = (links: TileLinks) => provide(KEY, links);
export const useTileLinks = (): TileLinks => inject(KEY, appLinks);
