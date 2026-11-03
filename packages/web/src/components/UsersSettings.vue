<script setup lang="ts">
// Admin > Users (admins, while login is on): who can sign in and with which role. A new user
// gets a password here to pass on; they can change it under Your account.
import { computed, onMounted, ref } from "vue";
import { getJson, sendJson, type Pack, type PackAccess, type UserInfo } from "../api";
import { when } from "../format";
import { Copy, KeyRound, Mail, Trash2, UserRound, UsersRound } from "../icons";
import { session, type Role } from "../session";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import GroupsField from "./GroupsField.vue";
import ModalDialog from "./ModalDialog.vue";
import SelectMenu from "./SelectMenu.vue";
import TextField from "./TextField.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

const ROLE_OPTIONS = [
  { value: "viewer" as const, label: "Viewer" },
  { value: "user" as const, label: "User" },
  { value: "admin" as const, label: "Admin" },
];

const users = ref<UserInfo[] | null>(null);
async function load() {
  const res = await getJson<UserInfo[]>("/api/v1/auth/users");
  users.value = res.ok ? res.data : [];
}
onMounted(load);

async function change(u: UserInfo, body: Record<string, unknown>, done: string) {
  const res = await sendJson<UserInfo>(`/api/v1/auth/users/${u.id}`, body);
  if (!res.ok) {
    toast(res.error.message, { tone: "bad" });
    await load();
    return false;
  }
  toast(done, { tone: "ok" });
  await load();
  return true;
}
const setRole = (u: UserInfo, role: Role) => void change(u, { role }, `${u.name} is now ${role === "admin" ? "an" : "a"} ${role}.`);
const setEnabled = (u: UserInfo, on: boolean) => void change(u, { disabled: !on }, on ? `${u.name} can sign in again.` : `${u.name} can't sign in any more.`);

// Add
const name = ref("");
const role = ref<Role>("user");
const password = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const ready = computed(() => name.value.trim() !== "" && password.value.length >= 10);
async function add() {
  if (!ready.value) return;
  busy.value = true;
  error.value = null;
  const res = await sendJson<UserInfo>("/api/v1/auth/users", { name: name.value.trim(), role: role.value, password: password.value });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  toast(`Added ${res.data.name}. Pass the password on; they can change it under Your account.`, { tone: "ok", timeout: 6000 });
  name.value = password.value = "";
  role.value = "user";
  await load();
}

// Invitations: a one-time link the person opens to make their own account with this role.
interface InviteInfo {
  id: string;
  role: Role;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
}
const invites = ref<InviteInfo[]>([]);
async function loadInvites() {
  const res = await getJson<InviteInfo[]>("/api/v1/auth/invites");
  invites.value = res.ok ? res.data : [];
}
onMounted(loadInvites);
const inviteRole = ref<Role>("user");
const inviteDays = ref<"1" | "7" | "30">("7");
const inviteNote = ref("");
const INVITE_DAYS = [
  { value: "1" as const, label: "Works for a day" },
  { value: "7" as const, label: "Works for a week" },
  { value: "30" as const, label: "Works for 30 days" },
];
const link = ref<string | null>(null);
const linkOpen = computed({
  get: () => link.value !== null,
  set: (open: boolean) => {
    if (!open) link.value = null;
  },
});
async function invite() {
  const res = await sendJson<InviteInfo & { code: string }>("/api/v1/auth/invites", { role: inviteRole.value, days: Number(inviteDays.value), ...(inviteNote.value.trim() ? { note: inviteNote.value.trim() } : {}) });
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  link.value = `${location.origin}${location.pathname}#/invite?code=${res.data.code}`;
  inviteNote.value = "";
  await loadInvites();
}
async function takeBack(i: InviteInfo) {
  const res = await sendJson(`/api/v1/auth/invites/${i.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast("Invitation taken back.");
  await loadInvites();
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", { tone: "ok", timeout: 1500 });
  } catch {
    toast("Couldn't copy: the browser blocked the clipboard", { tone: "bad" });
  }
}

// New password
const resetting = ref<UserInfo | null>(null);
const resetPassword = ref("");
const resetOpen = computed({
  get: () => resetting.value !== null,
  set: (open: boolean) => {
    if (!open) resetting.value = null;
  },
});
function askReset(u: UserInfo) {
  resetPassword.value = "";
  resetting.value = u;
}
async function reset() {
  const u = resetting.value;
  if (!u || resetPassword.value.length < 10) return;
  if (await change(u, { password: resetPassword.value }, `New password set for ${u.name}; their sign-ins have ended.`)) resetting.value = null;
}

// Groups, for pack access: the ones set here, and the ones the sign-in provider sends (read-only).
const kept = ref<Record<string, PackAccess>>({});
const packNames = ref<Record<string, string>>({});
async function loadPacks() {
  const [a, p] = await Promise.all([getJson<Record<string, PackAccess>>("/api/v1/packs/access"), getJson<Pack[]>("/api/v1/packs")]);
  kept.value = a.ok ? a.data : {};
  packNames.value = p.ok ? Object.fromEntries(p.data.map((x) => [x.id, x.name])) : {};
}
onMounted(loadPacks);
const knownGroups = computed(() => [...(users.value ?? []).flatMap((u) => [...u.groups, ...u.ssoGroups]), ...Object.values(kept.value).flatMap((a) => (a.mode === "chosen" ? a.groups : []))]);
const grouping = ref<UserInfo | null>(null);
const groupsDraft = ref<string[]>([]);
const groupsOpen = computed({
  get: () => grouping.value !== null,
  set: (open: boolean) => {
    if (!open) grouping.value = null;
  },
});
function askGroups(u: UserInfo) {
  groupsDraft.value = [...u.groups];
  grouping.value = u;
}
async function saveGroups() {
  const u = grouping.value;
  if (u && (await change(u, { groups: groupsDraft.value }, `Groups saved for ${u.name}.`))) grouping.value = null;
}
const groupsOf = (u: UserInfo) => [...new Map([...u.groups, ...u.ssoGroups].map((g) => [g.toLowerCase(), g])).values()];
/** The kept packs this person sees (with the groups being edited), and the ones they don't. */
const keptFor = computed(() => {
  const u = grouping.value;
  if (!u) return { sees: [] as string[], not: [] as string[] };
  const mine = new Set([...groupsDraft.value, ...u.ssoGroups].map((g) => g.toLowerCase()));
  const sees: string[] = [];
  const not: string[] = [];
  for (const [id, a] of Object.entries(kept.value)) {
    if (a.mode !== "chosen") continue;
    const name = packNames.value[id] ?? id;
    (u.role === "admin" || a.people.includes(u.id) || a.groups.some((g) => mine.has(g.toLowerCase())) ? sees : not).push(name);
  }
  return { sees: sees.sort(), not: not.sort() };
});

// Remove
const doomed = ref<UserInfo | null>(null);
const removeOpen = computed({
  get: () => doomed.value !== null,
  set: (open: boolean) => {
    if (!open) doomed.value = null;
  },
});
async function remove() {
  const u = doomed.value;
  doomed.value = null;
  if (!u) return;
  const res = await sendJson(`/api/v1/auth/users/${u.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Removed ${u.name}.`);
  await load();
}
const seen = (u: UserInfo) => (u.seenAt ? `seen ${new Date(u.seenAt).toLocaleDateString()}` : "never signed in");
</script>

<template>
  <section class="card" aria-labelledby="s-users">
    <h2 id="s-users" class="display">Users</h2>
    <p class="muted small">
      Viewers see runs, results and packs. Users also start runs, record, review and edit packs. Admins also manage users, settings, secrets, sign-ins and alerts. Pack code runs on this server and can read every secret, so give the user role only to people you'd trust with that.
    </p>
    <ul v-if="users && users.length" class="users">
      <li v-for="u in users" :key="u.id" :class="{ off: u.disabled }">
        <UserRound :size="15" class="muted" />
        <div class="who">
          <span class="uname">{{ u.displayName ?? u.name }}<span v-if="u.displayName" class="muted small login">{{ u.name }}</span><span v-if="u.id === session.user?.id" class="muted small"> (you)</span></span>
          <span class="muted small"><span v-tip="u.seenAt ? when(u.seenAt) : 'Not signed in yet'">{{ u.disabled ? "can't sign in · " : "" }}{{ seen(u) }}</span><template v-if="groupsOf(u).length"> · {{ groupsOf(u).join(", ") }}</template></span>
        </div>
        <SelectMenu :id="`s-user-role-${u.id}`" class="role" :model-value="u.role" :options="ROLE_OPTIONS" :disabled="u.id === session.user?.id" @update:model-value="(r: Role) => setRole(u, r)" />
        <ToggleSwitch :id="`s-user-on-${u.id}`" :model-value="!u.disabled" :disabled="u.id === session.user?.id" @update:model-value="(on: boolean) => setEnabled(u, on)"><span class="small">Can sign in</span></ToggleSwitch>
        <button v-tip="'Groups'" type="button" class="ib key grp" :aria-label="`Groups of ${u.name}`" @click="askGroups(u)"><UsersRound :size="15" /></button>
        <button v-tip="'Set a new password'" type="button" class="ib key" :aria-label="`Set a new password for ${u.name}`" @click="askReset(u)"><KeyRound :size="15" /></button>
        <button v-tip="'Remove this user'" type="button" class="ib" :disabled="u.id === session.user?.id" :aria-label="`Remove ${u.name}`" @click="doomed = u"><Trash2 :size="14" /></button>
      </li>
    </ul>
    <h3 class="sub">Invite someone</h3>
    <p class="muted small">A link they open to make their own account with the role you pick. It works once.</p>
    <ul v-if="invites.length" class="users">
      <li v-for="i in invites" :key="i.id">
        <Mail :size="15" class="muted" />
        <div class="who">
          <span class="uname">{{ i.note ?? "Invitation" }} <span class="muted small">as {{ i.role }}</span></span>
          <span v-tip="when(i.expiresAt)" class="muted small">made by {{ i.createdBy ?? "an admin" }} · works until {{ new Date(i.expiresAt).toLocaleDateString() }}</span>
        </div>
        <button v-tip="'Take back this invitation'" type="button" class="ib" :aria-label="`Take back the invitation ${i.note ?? ''}`" @click="takeBack(i)"><Trash2 :size="14" /></button>
      </li>
    </ul>
    <form class="invite" @submit.prevent="invite">
      <div class="fld">
        <label for="s-invite-note" class="lbl small">For</label>
        <TextField id="s-invite-note" v-model="inviteNote" placeholder="Sam (optional)" />
      </div>
      <div class="fld">
        <label for="s-invite-role" class="lbl small">Role</label>
        <SelectMenu id="s-invite-role" v-model="inviteRole" :options="ROLE_OPTIONS" />
      </div>
      <div class="fld">
        <label for="s-invite-days" class="lbl small">Link</label>
        <SelectMenu id="s-invite-days" v-model="inviteDays" :options="INVITE_DAYS" />
      </div>
      <button type="submit" class="btn primary">Make invite link</button>
    </form>

    <h3 class="sub">Add a user yourself</h3>
    <p class="muted small">With a password you pass on; they can change it under Your account.</p>
    <form class="add" @submit.prevent="add">
      <div class="fld">
        <label for="s-user-name" class="lbl small">Name</label>
        <TextField id="s-user-name" v-model="name" autocomplete="off" placeholder="sam" />
      </div>
      <div class="fld">
        <label for="s-user-role" class="lbl small">Role</label>
        <SelectMenu id="s-user-role" v-model="role" :options="ROLE_OPTIONS" />
      </div>
      <div class="fld">
        <label for="s-user-password" class="lbl small">Password</label>
        <TextField id="s-user-password" v-model="password" type="password" autocomplete="new-password" :invalid="password !== '' && password.length < 10" />
      </div>
      <button type="submit" class="btn primary" :disabled="busy || !ready">Add user</button>
    </form>
    <p v-if="password !== '' && password.length < 10" class="muted small">At least 10 characters.</p>
    <p v-else-if="error" class="error small" role="alert">{{ error }}</p>

    <ModalDialog v-model="linkOpen" heading="Invitation link" width="560px">
      <p>Send this link to the person. It works once, and it isn't shown again.</p>
      <div class="linkbox">
        <code class="link">{{ link }}</code>
        <button v-tip="'Copy the link'" type="button" class="ib copy" aria-label="Copy the link" @click="copy(link ?? '')"><Copy :size="15" /></button>
      </div>
      <template #actions>
        <button class="btn primary" @click="link = null">Done</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="resetOpen" :heading="`New password for ${resetting?.name ?? ''}`">
      <p>Their sign-ins end, and tokens keep working. Pass the password on; they can change it under Your account.</p>
      <div class="fld">
        <label for="s-user-reset" class="lbl small">New password</label>
        <TextField id="s-user-reset" v-model="resetPassword" type="password" autocomplete="new-password" :invalid="resetPassword !== '' && resetPassword.length < 10" />
      </div>
      <template #actions>
        <button class="btn" @click="resetting = null">Cancel</button>
        <button class="btn primary" :disabled="resetPassword.length < 10" @click="reset">Set password</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="groupsOpen" :heading="`Groups of ${grouping?.displayName ?? grouping?.name ?? ''}`" width="520px">
      <div class="groups">
        <p class="muted small">An admin can keep a pack to chosen people and groups (Who sees this pack, in the pack's menu). Groups are names you make up, like <em>qa</em> or <em>night shift</em>.</p>
        <div class="fld">
          <label for="s-user-groups" class="lbl small">Groups set here</label>
          <GroupsField id="s-user-groups" v-model="groupsDraft" :known="knownGroups" />
        </div>
        <div v-if="grouping?.ssoGroups.length" class="fld">
          <span class="lbl small">From the sign-in provider</span>
          <p class="small">{{ grouping.ssoGroups.join(", ") }}</p>
          <p class="muted small">Updated each time they sign in; change them at the provider.</p>
        </div>
        <div class="fld">
          <span class="lbl small">Packs kept to chosen people</span>
          <p v-if="grouping?.role === 'admin'" class="muted small">Admins see every pack.</p>
          <p v-else-if="!keptFor.sees.length && !keptFor.not.length" class="muted small">None: every pack is open to everyone signed in.</p>
          <template v-else>
            <p class="small">Sees: {{ keptFor.sees.length ? keptFor.sees.join(", ") : "none of them" }}</p>
            <p v-if="keptFor.not.length" class="muted small">Doesn't see: {{ keptFor.not.join(", ") }}</p>
          </template>
        </div>
      </div>
      <template #actions>
        <button class="btn" @click="grouping = null">Cancel</button>
        <button class="btn primary" @click="saveGroups">Save</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="removeOpen" heading="Remove this user?">
      <p>
        <strong>{{ doomed?.name }}</strong> can't sign in any more, and their tokens stop working. Runs and reviews they made stay.
      </p>
      <template #actions>
        <button class="btn" @click="doomed = null">Cancel</button>
        <button class="btn danger" @click="remove">Remove</button>
      </template>
    </ModalDialog>
  </section>
</template>

<style scoped>
.card {
  display: grid;
  gap: var(--space-3);
}
.card > h2:first-child,
.card p {
  margin: 0;
}
.card > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.users {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.users li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.login {
  margin-left: var(--space-1);
}
.users li.off .uname {
  color: var(--muted);
}
.who {
  flex: 1;
  min-width: 0;
  display: grid;
}
.uname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role {
  width: 120px;
}
.sub {
  margin: var(--space-2) 0 0;
  font-size: 13px;
}
.sub + p {
  margin-top: calc(-1 * var(--space-2));
}
.invite {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px 190px auto;
  align-items: end;
  gap: var(--space-3);
}
.linkbox {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.link {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.ib.copy:hover,
.ib.key:hover {
  color: var(--text);
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.groups {
  display: grid;
  gap: var(--space-3);
}
.groups p {
  margin: 0;
}
.error {
  color: var(--bad);
}
.ib {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--bad);
}
.ib:disabled {
  opacity: 0.4;
  cursor: default;
}
@media (max-width: 720px) {
  /* Name and the buttons on the first line; the role and the switch on the next, under the name. */
  .users li {
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .who {
    flex-basis: calc(100% - 128px);
  }
  .users li > .ib {
    order: 1;
  }
  .users li > :deep(.mb),
  .users li > .role,
  .users li > :deep(.sw) {
    order: 2;
  }
  .users li > .role {
    margin-left: 23px;
  }
  .add,
  .invite {
    grid-template-columns: 1fr;
  }
}
</style>
