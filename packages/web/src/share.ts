// Share links in the web app: the full address of a link, and copying it.
import { toast } from "./toasts";

/** The address someone opens: this server's origin and the link's page (`#/s/<token>`). */
export function shareUrl(page: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/${page.replace(/^\/+/, "")}`;
}

/** Puts a link's address on the clipboard and says so. */
export async function copyShare(page: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl(page, location.origin));
    toast("Link copied", { tone: "ok", timeout: 1500 });
  } catch {
    toast("Couldn't copy: the browser blocked the clipboard", { tone: "bad" });
  }
}
