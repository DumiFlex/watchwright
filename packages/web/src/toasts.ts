// Short messages that show in a corner and go away by themselves ("Run finished", "Pack
// reloaded"). Call toast() from anywhere; ToastHost in App.vue shows them. Hovering or
// focusing the stack holds the timers so a message can be read or its action reached.
import { reactive } from "vue";

export type ToastTone = "info" | "ok" | "bad" | "warn";
export type Toast = { id: number; text: string; tone: ToastTone; action?: { label: string; run: () => void } | undefined; timeout: number };

const MAX = 4;
export const toasts = reactive<Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;
let held = false;

function arm(t: Toast) {
  if (t.timeout > 0 && !held) timers.set(t.id, setTimeout(() => dismissToast(t.id), t.timeout));
}

/** Shows a message. `timeout` 0 keeps it until it is closed. Returns its id. */
export function toast(text: string, opts: { tone?: ToastTone; action?: Toast["action"]; timeout?: number } = {}): number {
  const t: Toast = { id: nextId++, text, tone: opts.tone ?? "info", action: opts.action, timeout: opts.timeout ?? (opts.tone === "bad" ? 8000 : 5000) };
  toasts.push(t);
  while (toasts.length > MAX) dismissToast(toasts[0]!.id);
  arm(t);
  return t.id;
}

export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Stops the timers while the person reads (true) and starts them again in full (false). */
export function holdToasts(on: boolean) {
  if (held === on) return;
  held = on;
  if (on) {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  } else for (const t of toasts) arm(t);
}
