// Where each settings section lives: the Account page (who you are), Settings (your own
// preferences) or Admin (the server's, for admins). Server sections that people who aren't admins
// may still see (secret names, their share links, runners…) show on their Settings page, under
// "On this server". See docs/research/settings-pages.md.
import { can, session, type Role } from "./session";

export type SettingsPage = "account" | "settings" | "admin";

export interface SectionDef {
  /** `#/<page>?section=<id>`; the card's heading has the id `s-<id>`. */
  id: string;
  label: string;
  /** The page it's on for the person signed in now; null when they can't see it. */
  where: () => SettingsPage | null;
  /** On Admin: a heading above it in the page's list when it starts a group. */
  group?: string | undefined;
  /** A server section some people see on their Settings page. */
  shared?: true;
}

const signedIn = () => session.on && session.user !== null;
const account = (): SettingsPage | null => (signedIn() ? "account" : null);
const mine = (): SettingsPage => "settings";
const admin = (): SettingsPage | null => (can("admin") ? "admin" : null);
const adminWithLogin = (): SettingsPage | null => (session.on && can("admin") ? "admin" : null);
/** Admin for admins; on Settings for roles that could see it before. */
const shared = (role: Role) => (): SettingsPage | null => (can("admin") ? "admin" : can(role) ? "settings" : null);

/** Every section in page order. */
export const SECTIONS: readonly SectionDef[] = [
  { id: "account", label: "Your account", where: account },
  { id: "password", label: "Password", where: account },
  { id: "sso-links", label: "Single sign-on", where: () => (signedIn() && (session.signin.oidc || session.user?.signins?.length) ? "account" : null) },
  { id: "tokens", label: "API tokens", where: account },

  { id: "look", label: "Look and mode", where: mine },
  { id: "notify", label: "Notifications", where: mine },
  { id: "editor", label: "Editor", where: mine },
  { id: "newrun", label: "New run", where: () => (can("user") ? "settings" : null) },
  { id: "agents", label: "Agents", where: () => (can("user") ? "settings" : null) },

  { id: "users", label: "Users", where: adminWithLogin, group: "People" },
  { id: "sso", label: "Single sign-on", where: adminWithLogin },
  { id: "defaults", label: "Defaults", where: adminWithLogin },
  { id: "secrets", shared: true, label: "Secrets", where: shared("user"), group: "Runs and packs" },
  { id: "signins", shared: true, label: "Sign-ins", where: shared("user") },
  { id: "runners", shared: true, label: "Runners", where: shared("viewer") },
  { id: "runs", label: "Interrupted runs", where: admin },
  { id: "packs", label: "Packs", where: admin },
  { id: "sharing", shared: true, label: "Sharing", where: shared("user"), group: "Sharing and alerts" },
  { id: "alerts", label: "Alerts", where: admin },
  { id: "storage", shared: true, label: "Storage", where: shared("user"), group: "This server" },
  { id: "recent", shared: true, label: "Recent folders", where: shared("user") },
  { id: "server", label: "Server", where: admin },

  { id: "about", label: "About", where: mine },
];

/** The sections a page shows to the person signed in now, in order. */
export function sectionsOn(page: SettingsPage): SectionDef[] {
  const list = SECTIONS.filter((s) => s.where() === page);
  if (page !== "settings") return list;
  // On Settings the server's sections come as one group after the person's own.
  let first = true;
  return list.map((s) => {
    const group = s.shared && first ? "On this server" : undefined;
    if (group) first = false;
    return { ...s, group };
  });
}

/** The link to a section, on the page it lives on for this person (Settings when they can't see it). */
export function sectionHref(id: string): string {
  const where = SECTIONS.find((s) => s.id === id)?.where() ?? "settings";
  return `#/${where}?section=${id}`;
}

/** Where a section asked for on `page` really is, when that's another page (old `#/settings?section=` links). */
export function movedTo(page: SettingsPage, id: string): SettingsPage | null {
  const where = SECTIONS.find((s) => s.id === id)?.where() ?? null;
  return where !== null && where !== page ? where : null;
}
