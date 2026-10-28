// Approvals: actions an agent or a script asked for that delete data or stop the server, waiting
// for the person to approve them here. The bar under the top bar lists them; a new one also
// shows a toast, and a desktop notice when the tab is hidden and notices are on.
import { onBeforeUnmount, ref } from "vue";
import { getJson, sendJson } from "./api";
import { LiveConnection } from "./live";
import { notifyOn } from "./notify";
import { setTitlePrefix } from "./pagehead";
import { toast } from "./toasts";

export interface Approval {
  id: string;
  action: string;
  client: string;
  summary: string;
  status: "waiting" | "approved" | "refused" | "expired" | "failed";
  answeredBy: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  expiresAt: string;
}

/** The title prefix for this many approvals waiting. */
export function titlePrefix(n: number): string {
  return n > 0 ? `(${n}) Approve? · ` : "";
}

/** The approvals waiting, kept current from the event log, and answering them. */
export function useApprovals() {
  const waiting = ref<Approval[]>([]);
  const busy = ref<string | null>(null);

  async function load() {
    const res = await getJson<Approval[]>("/api/v1/approvals?status=waiting");
    if (!res.ok) return;
    waiting.value = res.data;
    setTitlePrefix(titlePrefix(res.data.length));
  }

  const live = new LiveConnection(
    {},
    {
      onState: (s) => {
        if (s === "open") void load();
      },
      onEvent: (e) => {
        if (e.type === "approval.requested") {
          void load();
          const who = String(e.data.client ?? "An agent");
          const what = String(e.data.summary ?? "");
          if (document.hidden && notifyOn()) {
            const n = new Notification(`${who} asks for your approval`, { body: what, tag: `approval-${String(e.data.id)}`, icon: "/favicon.svg" });
            n.onclick = () => {
              window.focus();
              n.close();
            };
          } else toast(`${who} asks for your approval: ${what}`, { tone: "warn" });
        } else if (e.type === "approval.answered") void load();
      },
    },
  );
  onBeforeUnmount(() => {
    live.close();
    setTitlePrefix("");
  });

  async function answer(id: string, approve: boolean) {
    busy.value = id;
    const res = await sendJson<Approval>(`/api/v1/approvals/${id}/answer`, { approve });
    busy.value = null;
    if (!res.ok) toast(res.error.message, { tone: "bad" });
    else if (res.data.status === "failed") toast(`Approved, but it failed: ${res.data.error?.message ?? "no reason given"}`, { tone: "bad" });
    else toast(approve ? "Approved. It's done." : "Refused. Nothing was changed.", { tone: approve ? "ok" : "info" });
    await load();
  }

  return { waiting, busy, answer, load };
}
