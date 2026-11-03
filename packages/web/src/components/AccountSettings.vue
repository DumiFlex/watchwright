<script setup lang="ts">
// The Account page's cards, while login is on: who you are, your password, the single sign-on
// identities linked to the account, and your API tokens for the CLI, scripts and agents. A new
// token is shown once, here, and never again.
import { computed, onMounted, ref } from "vue";
import { getJson, sendJson } from "../api";
import { when } from "../format";
import { Copy, KeyRound, Link, LogOut, Trash2 } from "../icons";
import { loadSession, session, signInLabel, signOut, type LinkedSignIn } from "../session";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import ModalDialog from "./ModalDialog.vue";
import SelectMenu from "./SelectMenu.vue";
import TextField from "./TextField.vue";

interface TokenInfo {
  id: string;
  name: string;
  kind: "api" | "runner";
  createdAt: string;
  usedAt: string | null;
  expiresAt: string | null;
}

const ROLE_WORDS: Record<string, string> = {
  viewer: "a viewer: you can see runs, results and packs",
  user: "a user: you can also start runs, record, review and edit packs",
  admin: "an admin: you can also manage users, secrets, alerts and the server on the Admin page",
};

// Password
const current = ref("");
const next = ref("");
const again = ref("");
const pwBusy = ref(false);
const pwError = ref<string | null>(null);
const short = computed(() => next.value !== "" && next.value.length < 10);
const differs = computed(() => again.value !== "" && again.value !== next.value);
/** An account made by single sign-on has no password to give first: it sets one. */
const hasPassword = computed(() => session.user?.hasPassword !== false);
const pwReady = computed(() => (current.value !== "" || !hasPassword.value) && next.value.length >= 10 && again.value === next.value);
async function changePassword() {
  if (!pwReady.value) return;
  pwBusy.value = true;
  pwError.value = null;
  const res = await sendJson("/api/v1/auth/password", { current: current.value, password: next.value });
  pwBusy.value = false;
  if (!res.ok) return void (pwError.value = res.error.message);
  current.value = next.value = again.value = "";
  toast(hasPassword.value ? "Password changed. Your other sign-ins have ended." : "Password set. You can sign in with it too.", { tone: "ok" });
  await loadSession();
}

// Single sign-on: the identities linked to this account, and linking the provider's.
const signins = computed(() => session.user?.signins ?? []);
const provider = computed(() => session.signin.oidc);
const oidcLinked = computed(() => signins.value.some((s) => s.source === "oidc"));
/** The account's only way in can't be unlinked. */
const onlyWay = computed(() => !hasPassword.value && signins.value.length <= 1);
onMounted(() => {
  // Back from the provider: `#/account?section=sso-links&linked=1` or `&error=…`.
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const err = q.get("error");
  if (err) toast(err, { tone: "bad", timeout: 8000 });
  else if (q.get("linked")) toast(`Linked. Sign in with ${provider.value ?? "single sign-on"} now opens this account.`, { tone: "ok" });
  if (err || q.get("linked")) history.replaceState(null, "", "#/account?section=sso-links");
});
const unlinking = ref<LinkedSignIn | null>(null);
const unlinkOpen = computed({
  get: () => unlinking.value !== null,
  set: (open: boolean) => {
    if (!open) unlinking.value = null;
  },
});
async function unlink() {
  const s = unlinking.value;
  unlinking.value = null;
  if (!s) return;
  const res = await sendJson(`/api/v1/auth/signins/${s.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Unlinked ${signInLabel(s.source)}.`);
  await loadSession();
}

// Tokens
const tokens = ref<TokenInfo[] | null>(null);
async function load() {
  const res = await getJson<TokenInfo[]>("/api/v1/auth/tokens");
  tokens.value = res.ok ? res.data.filter((t) => t.kind === "api") : [];
}
onMounted(load);

const tokenName = ref("");
const days = ref<"0" | "30" | "90" | "365">("90");
const DAY_OPTIONS = [
  { value: "30" as const, label: "Expires in 30 days" },
  { value: "90" as const, label: "Expires in 90 days" },
  { value: "365" as const, label: "Expires in a year" },
  { value: "0" as const, label: "Never expires" },
];
const made = ref<{ name: string; token: string } | null>(null);
const madeOpen = computed({
  get: () => made.value !== null,
  set: (open: boolean) => {
    if (!open) made.value = null;
  },
});
const tkBusy = ref(false);
async function makeToken() {
  if (!tokenName.value.trim()) return;
  tkBusy.value = true;
  const res = await sendJson<TokenInfo & { token: string }>("/api/v1/auth/tokens", { name: tokenName.value.trim(), ...(days.value === "0" ? {} : { days: Number(days.value) }) });
  tkBusy.value = false;
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  made.value = { name: res.data.name, token: res.data.token };
  tokenName.value = "";
  await load();
}
const server = `${location.origin}/`;
const example = computed(() => (made.value ? `WATCHWRIGHT_URL=${server}\nWATCHWRIGHT_TOKEN=${made.value.token}` : ""));
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", { tone: "ok", timeout: 1500 });
  } catch {
    toast("Couldn't copy: the browser blocked the clipboard", { tone: "bad" });
  }
}

const doomed = ref<TokenInfo | null>(null);
const removeOpen = computed({
  get: () => doomed.value !== null,
  set: (open: boolean) => {
    if (!open) doomed.value = null;
  },
});
async function removeToken() {
  const t = doomed.value;
  doomed.value = null;
  if (!t) return;
  const res = await sendJson(`/api/v1/auth/tokens/${t.id}`, {}, "DELETE");
  if (!res.ok) return void toast(res.error.message, { tone: "bad" });
  toast(`Removed the token ${t.name}.`);
  await load();
}
const day = (iso: string) => new Date(iso).toLocaleDateString();
</script>

<template>
  <section class="card" aria-labelledby="s-account">
    <h2 id="s-account" class="display">Your account</h2>
    <p v-if="session.user" class="muted small">
      Signed in as <strong>{{ session.user.displayName ?? session.user.name }}</strong>, {{ ROLE_WORDS[session.user.role] }}.
    </p>
    <div>
      <button type="button" class="btn" @click="signOut"><LogOut :size="15" /> Sign out</button>
    </div>
  </section>

  <section class="card" aria-labelledby="s-password">
    <h2 id="s-password" class="display">Password</h2>
    <p v-if="hasPassword" class="muted small">Changing it ends your sign-ins in other browsers.</p>
    <p v-else class="muted small">Your account signs in with single sign-on and has no password. Set one to sign in without the provider too{{ session.signin.passwords ? "" : " (only admins may, while passwords are off on this server)" }}.</p>
    <form :class="['pw', { first: !hasPassword }]" @submit.prevent="changePassword">
      <div v-if="hasPassword" class="fld">
        <label for="s-pw-current" class="lbl small">Current password</label>
        <TextField id="s-pw-current" v-model="current" type="password" autocomplete="current-password" />
      </div>
      <div class="fld">
        <label for="s-pw-next" class="lbl small">New password</label>
        <TextField id="s-pw-next" v-model="next" type="password" autocomplete="new-password" :invalid="short" />
      </div>
      <div class="fld">
        <label for="s-pw-again" class="lbl small">Same again</label>
        <TextField id="s-pw-again" v-model="again" type="password" autocomplete="new-password" :invalid="differs" />
      </div>
      <button type="submit" class="btn" :disabled="!pwReady || pwBusy">{{ hasPassword ? "Change password" : "Set password" }}</button>
    </form>
    <p v-if="short" class="muted small">At least 10 characters.</p>
    <p v-else-if="differs" class="muted small">The two new passwords aren't the same.</p>
    <p v-else-if="pwError" class="error small" role="alert">{{ pwError }}</p>
  </section>

  <section v-if="provider || signins.length" class="card" aria-labelledby="s-sso-links">
    <h2 id="s-sso-links" class="display">Single sign-on</h2>
    <p class="muted small">Sign-ins from your sign-in provider that open this account. Link one when signing in with {{ provider ?? "single sign-on" }} made a separate account, or before you start using it.</p>
    <ul v-if="signins.length" class="tokens">
      <li v-for="s in signins" :key="s.id">
        <Link :size="15" class="muted" />
        <div class="who">
          <span class="tname">{{ signInLabel(s.source) }}<span v-if="s.name" class="muted"> as {{ s.name }}</span></span>
          <span v-tip="s.usedAt ? `Last used ${when(s.usedAt)}` : 'Not used yet'" class="muted small">linked {{ day(s.createdAt) }}{{ s.usedAt ? ` · used ${day(s.usedAt)}` : "" }}</span>
        </div>
        <button v-tip="onlyWay ? 'Your only way in: set a password first' : 'Unlink'" type="button" class="ib" :disabled="onlyWay" :aria-label="`Unlink ${signInLabel(s.source)}`" @click="unlinking = s"><Trash2 :size="14" /></button>
      </li>
    </ul>
    <p v-else class="muted">Nothing linked yet.</p>
    <div v-if="provider && !oidcLinked">
      <a class="btn primary" href="/api/v1/auth/oidc/start?link=1"><Link :size="15" /> Link {{ provider }}</a>
    </div>
    <p v-if="provider && !oidcLinked" class="muted small">You sign in at {{ provider }}, then come back here. If that sign-in already has its own account on this server, ask an admin to merge it into yours, under Users on the Admin page.</p>
    <ModalDialog v-model="unlinkOpen" heading="Unlink this sign-in?">
      <p>
        Signing in with <strong>{{ unlinking ? signInLabel(unlinking.source) : "" }}</strong> won't open this account any more. The next time you use it, it asks to link again or makes a separate account.
      </p>
      <template #actions>
        <button class="btn" @click="unlinking = null">Cancel</button>
        <button class="btn danger" @click="unlink">Unlink</button>
      </template>
    </ModalDialog>
  </section>

  <section class="card" aria-labelledby="s-tokens">
    <h2 id="s-tokens" class="display">API tokens</h2>
    <p class="muted small">
      For the command line, scripts and AI agents: they send the token instead of signing in, and act as you. Set it as <code>WATCHWRIGHT_TOKEN</code> for the CLI (or run <code>watchwright login</code>, which makes and saves one), or as the <code>Authorization: Bearer</code> header in an MCP
      client's settings. Deleting things through a token still waits for your approval here.
    </p>
    <ul v-if="tokens && tokens.length" class="tokens">
      <li v-for="t in tokens" :key="t.id">
        <KeyRound :size="15" class="muted" />
        <div class="who">
          <span class="tname">{{ t.name }}</span>
          <span v-tip="t.usedAt ? `Last used ${when(t.usedAt)}` : 'Not used yet'" class="muted small">made {{ day(t.createdAt) }} · {{ t.usedAt ? `used ${day(t.usedAt)}` : "not used yet" }}{{ t.expiresAt ? ` · expires ${day(t.expiresAt)}` : "" }}</span>
        </div>
        <button v-tip="'Remove this token'" type="button" class="ib" :aria-label="`Remove the token ${t.name}`" @click="doomed = t"><Trash2 :size="14" /></button>
      </li>
    </ul>
    <p v-else-if="tokens" class="muted">No tokens yet.</p>
    <form class="add" @submit.prevent="makeToken">
      <div class="fld">
        <label for="s-token-name" class="lbl small">Name</label>
        <TextField id="s-token-name" v-model="tokenName" placeholder="Laptop, Claude Code, nightly script…" />
      </div>
      <div class="fld">
        <label for="s-token-days" class="lbl small">Expiry</label>
        <SelectMenu id="s-token-days" v-model="days" :options="DAY_OPTIONS" />
      </div>
      <button type="submit" class="btn primary" :disabled="tkBusy || !tokenName.trim()">Make token</button>
    </form>

    <ModalDialog v-model="madeOpen" heading="Your new token" width="560px">
      <div class="modal-body">
        <p>Copy it now: it isn't shown again. Anyone with it can do what you can on this server.</p>
        <div class="tokenbox">
          <code class="token">{{ made?.token }}</code>
          <button v-tip="'Copy the token'" type="button" class="ib copy" aria-label="Copy the token" @click="copy(made?.token ?? '')"><Copy :size="15" /></button>
        </div>
        <p class="muted small">For the command line, set these where it runs:</p>
        <div class="tokenbox">
          <code class="token pre">{{ example }}</code>
          <button v-tip="'Copy both lines'" type="button" class="ib copy" aria-label="Copy both lines" @click="copy(example)"><Copy :size="15" /></button>
        </div>
      </div>
      <template #actions>
        <button class="btn primary" @click="made = null">Done</button>
      </template>
    </ModalDialog>
    <ModalDialog v-model="removeOpen" heading="Remove this token?">
      <p>
        Whatever uses <strong>{{ doomed?.name }}</strong> can't reach this server any more.
      </p>
      <template #actions>
        <button class="btn" @click="doomed = null">Cancel</button>
        <button class="btn danger" @click="removeToken">Remove</button>
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
.sub {
  margin: var(--space-2) 0 0;
  font-size: 13px;
}
.pw {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  align-items: end;
  gap: var(--space-3);
}
.pw.first {
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px auto;
  align-items: end;
  gap: var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.tokens {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.tokens li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.who {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.tname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modal-body {
  display: grid;
  gap: var(--space-3);
}
.modal-body p {
  margin: 0;
}
.tokenbox {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.token {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.pre {
  white-space: pre-wrap;
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
.ib.copy:hover {
  color: var(--text);
}
@media (max-width: 720px) {
  .pw,
  .pw.first,
  .add {
    grid-template-columns: 1fr;
  }
  .who {
    flex-direction: column;
    gap: 0;
  }
}
</style>
