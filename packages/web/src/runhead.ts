// Keeps the tab's title and favicon dot on a run's page in step with the run. Live events patch
// the run in place (its counts, its plan rows, its live state) rather than replacing it, so this
// watches the words and the tone the run gives, not the run object, which only changes when the
// page loads the run again.
import { watch, type Ref, type WatchStopHandle } from "vue";
import { setIconDot, setTitle } from "./pagehead";
import { runTitle, runTone, type LiveLike } from "./runstate";

type RunArg = Parameters<typeof runTitle>[0];

export function followRunHead(run: Readonly<Ref<RunArg | null>>, live: Readonly<Ref<LiveLike | null>>): WatchStopHandle {
  return watch(
    () => (run.value ? { title: runTitle(run.value, live.value), tone: runTone(run.value, live.value) } : null),
    (head) => {
      if (!head) return;
      setTitle(head.title);
      void setIconDot(head.tone);
    },
    { immediate: true },
  );
}
