// Desktop notifications for runs: finished, paused on a broken test, failed to start. Opt-in per
// browser (the browser asks for permission), kept in this browser like the look. While the tab
// is in front a toast says the same, unless you are already on that run's page.
import { reactive, watch } from "vue";
import { getJson, type RunSummary } from "./api";
import { LiveConnection } from "./live";
import { noteFor } from "./runstate";
import { browserStore } from "./theme";
import { toast } from "./toasts";

const KEY = "ww.notify";
export type NotifySupport = "unsupported" | "denied" | "default" | "granted";

function readPref(): "on" | "off" | null {
  try {
    const v = browserStore()?.getItem(KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}
function writePref(v: "on" | "off") {
  try {
    browserStore()?.setItem(KEY, v);
  } catch {
    // private window: the choice lasts for this page only
  }
  notify.pref = v;
}

export const notify = reactive<{ pref: "on" | "off" | null }>({ pref: readPref() });

export function notifySupport(): NotifySupport {
  if (typeof Notification === "undefined" || !window.isSecureContext) return "unsupported";
  return Notification.permission;
}

/** Whether notices go out now: switched on here and allowed by the browser. */
export function notifyOn(): boolean {
  return notify.pref === "on" && notifySupport() === "granted";
}

/** Asks the browser, then switches notices on. Returns what the browser allows. */
export async function turnOnNotify(): Promise<NotifySupport> {
  if (notifySupport() === "unsupported") return "unsupported";
  const answer = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  writePref(answer === "granted" ? "on" : "off");
  return answer;
}

export function turnOffNotify(): void {
  writePref("off");
}

/** The first time a run starts from this browser, offers notices once. */
export function offerNotify(): void {
  if (notify.pref !== null || notifySupport() !== "default") return;
  writePref("off");
  toast("Get a desktop notice when a run finishes, or pauses on a broken test?", {
    timeout: 12000,
    action: { label: "Turn on", run: () => void turnOnNotify() },
  });
}

/** Where a notice for this run goes: the desktop when the tab is hidden, a toast when you're elsewhere in the app, nowhere on its page. */
export function noticeTarget(hidden: boolean, viewingRunId: string | null, runId: string): "desktop" | "toast" | null {
  if (hidden) return "desktop";
  return viewingRunId === runId ? null : "toast";
}

const WATCHED = new Set(["run.finished", "run.paused", "run.failed_to_start"]);

/** Listens to every run while notices are on. `viewing` says which run's page is open. Returns a stop function. */
export function startNotifier(viewing: () => string | null): () => void {
  let live: LiveConnection | null = null;
  const sync = () => {
    if (notifyOn() && !live) {
      live = new LiveConnection(
        {},
        {
          onEvent: (e) => {
            if (e.runId && WATCHED.has(e.type)) void announce(e.type, e.data, e.runId, viewing());
          },
        },
      );
    } else if (!notifyOn() && live) {
      live.close();
      live = null;
    }
  };
  const stop = watch(() => notify.pref, sync, { immediate: true });
  return () => {
    stop();
    live?.close();
  };
}

async function announce(type: string, data: Record<string, unknown>, runId: string, viewingRunId: string | null) {
  const target = noticeTarget(document.hidden, viewingRunId, runId);
  if (!target) return;
  const res = await getJson<RunSummary>(`/api/v1/runs/${runId}`);
  if (!res.ok) return;
  const note = noteFor(type, data, res.data);
  if (!note) return;
  const open = () => {
    window.focus();
    location.hash = `#/runs/${runId}`;
  };
  if (target === "toast") {
    toast(`${note.title}. ${note.body}`, { tone: type === "run.finished" && !res.data.counts.failed && !res.data.counts.broken ? "ok" : "warn", action: { label: "Open", run: open } });
    return;
  }
  if (notifySupport() !== "granted") return;
  const n = new Notification(note.title, { body: note.body, tag: note.tag, icon: "/favicon.svg" });
  n.onclick = () => {
    open();
    n.close();
  };
}
