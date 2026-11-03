<script setup lang="ts">
// The sign-in page, shown instead of every other page while the server has login on and nobody is
// signed in. With the setup link the server prints on its first start (`#/setup?code=…`) it
// creates the first admin instead, and with an invitation link (`#/invite?code=…`) the invited
// person's own account (docs/plans/self-hosting.md, section 2.2). Back from single sign-on with a
// name an account here already has (`#/signin?link=1`), it offers to link the two with that
// account's password, or to make a separate account (docs/research/sso-account-linking.md).
import { computed, onMounted, ref } from "vue";
import { KeyRound, Link, LogIn, UserRound } from "../icons";
import { acceptInvite, cancelLink, inviteFor, linkAndSignIn, pendingLink, separateAccount, session, setUp, signIn, type PendingLink, type Role } from "../session";
import BrandMark from "../components/BrandMark.vue";
import TextField from "../components/TextField.vue";

const props = defineProps<{ setupCode: string | null; inviteCode: string | null; error?: string | null; link?: boolean }>();

// What the form does: sign in, make the first admin, make an invited account, or link single sign-on to an account.
const invite = ref<{ role: Role; expiresAt: string } | null>(null);
const inviteError = ref<string | null>(null);
const linking = ref<PendingLink | null>(null);
const mode = computed<"setup" | "invite" | "signin" | "link">(() => (session.setupNeeded ? "setup" : invite.value ? "invite" : linking.value ? "link" : "signin"));
/** Making a new account (choose a password twice) rather than signing in. */
const setup = computed(() => mode.value === "setup" || mode.value === "invite");
const ROLE_WORDS: Record<Role, string> = { viewer: "a viewer: you'll see runs, results and packs", user: "a user: you'll start runs, record, review and edit packs", admin: "an admin: you'll also manage users and settings" };
const name = ref("");
const password = ref("");
const again = ref("");
const busy = ref(false);
const error = ref<string | null>(props.error || null);
// With single sign-on and passwords off for everyone but admins, the form waits behind a link.
const sso = computed(() => (mode.value === "signin" ? session.signin.oidc : null));
const linkShown = computed(() => mode.value === "link");
const formShown = ref(session.signin.passwords || !session.signin.oidc);
const nameField = ref<InstanceType<typeof TextField> | null>(null);
onMounted(async () => {
  nameField.value?.focus();
  if (props.link && !session.setupNeeded) {
    const found = await pendingLink();
    if (typeof found === "string") error.value = found;
    else {
      linking.value = found;
      name.value = found.account;
    }
  }
  if (props.inviteCode && !session.setupNeeded) {
    const found = await inviteFor(props.inviteCode);
    if (typeof found === "string") inviteError.value = found;
    else invite.value = found;
  }
});

const MIN = 10;
const short = computed(() => setup.value && password.value !== "" && password.value.length < MIN);
const differs = computed(() => setup.value && again.value !== "" && again.value !== password.value);
const codeOk = computed(() => (mode.value === "setup" ? !!props.setupCode : mode.value === "invite" ? !!props.inviteCode : true));
const ready = computed(() => name.value.trim() !== "" && password.value !== "" && codeOk.value && (!setup.value || (password.value.length >= MIN && again.value === password.value)));

async function submit() {
  if (!ready.value || busy.value) return;
  busy.value = true;
  error.value = null;
  const n = name.value.trim();
  const err =
    mode.value === "setup"
      ? await setUp(props.setupCode ?? "", n, password.value)
      : mode.value === "invite"
        ? await acceptInvite(props.inviteCode ?? "", n, password.value)
        : mode.value === "link"
          ? await linkAndSignIn(n, password.value)
          : await signIn(n, password.value);
  busy.value = false;
  if (err) {
    error.value = err;
    return;
  }
  if (location.hash.startsWith("#/setup") || location.hash.startsWith("#/invite") || location.hash.startsWith("#/signin")) location.hash = "#/";
}

async function separate() {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  const err = await separateAccount();
  busy.value = false;
  if (err) error.value = err;
  else location.hash = "#/";
}

async function cancel() {
  await cancelLink();
  linking.value = null;
  name.value = password.value = "";
  error.value = null;
  location.hash = "#/signin";
}
</script>

<template>
  <main class="signin">
    <form class="card box" @submit.prevent="submit">
      <div class="brand">
        <BrandMark :size="36" />
        <span class="wordmark">Watchwright</span>
      </div>
      <template v-if="mode === 'invite' && invite">
        <h1 class="display">Make your account</h1>
        <p class="muted small">You're invited as {{ ROLE_WORDS[invite.role] }}. Choose the name you'll sign in with and a password.</p>
      </template>
      <template v-else-if="mode === 'setup'">
        <h1 class="display">Create the first admin</h1>
        <p v-if="setupCode" class="muted small">This server has login on and no users yet. The admin you make here can add other people and change the server's settings.</p>
        <p v-else class="warn small" role="alert">Open the setup link the server printed when it started: it carries a one-time code. Or run <code>watchwright users add &lt;name&gt; --role admin</code> on the server.</p>
      </template>
      <template v-else-if="mode === 'link' && linking">
        <h1 class="display">Link your account</h1>
        <p class="muted small">
          You signed in with {{ linking.provider }} as <strong>{{ linking.name }}</strong>, and this server already has an account named <strong>{{ linking.account }}</strong>. If it's yours, enter its password once to link them. After that, Sign in with {{ linking.provider }} takes you straight to it.
        </p>
      </template>
      <template v-else>
        <h1 class="display">Sign in</h1>
        <p v-if="inviteError" class="warn small" role="alert">{{ inviteError }} If you have an account already, sign in.</p>
      </template>
      <template v-if="sso">
        <a class="btn primary go" href="/api/v1/auth/oidc/start"><LogIn :size="15" /> Sign in with {{ sso }}</a>
        <p v-if="error" class="error small" role="alert">{{ error }}</p>
        <div v-if="formShown" class="or small muted"><span>or with a password</span></div>
        <div v-else>
          <button type="button" class="linkish small" @click="formShown = true"><KeyRound :size="13" /> Admin? Sign in with a password</button>
        </div>
      </template>
      <template v-if="!sso || formShown">
        <div class="fld">
          <label for="si-name" class="lbl small">Name</label>
          <TextField id="si-name" ref="nameField" v-model="name" autocomplete="username" />
        </div>
        <div class="fld">
          <label for="si-password" class="lbl small">Password</label>
          <TextField id="si-password" v-model="password" type="password" :autocomplete="setup ? 'new-password' : 'current-password'" :invalid="short" />
          <p v-if="short" class="muted small">At least {{ MIN }} characters.</p>
        </div>
        <div v-if="setup" class="fld">
          <label for="si-again" class="lbl small">Same password again</label>
          <TextField id="si-again" v-model="again" type="password" autocomplete="new-password" :invalid="differs" />
          <p v-if="differs" class="muted small">The two passwords aren't the same.</p>
        </div>
        <p v-if="error && !sso" class="error small" role="alert">{{ error }}</p>
        <button type="submit" :class="['btn', 'go', sso ? '' : 'primary']" :disabled="!ready || busy">
          <template v-if="linkShown"><Link :size="15" /> Link and sign in</template>
          <template v-else><LogIn :size="15" /> {{ mode === "setup" ? "Create admin and sign in" : mode === "invite" ? "Make account and sign in" : "Sign in" }}</template>
        </button>
      </template>
      <template v-if="linkShown && linking">
        <div class="or small muted"><span>not your account?</span></div>
        <button type="button" class="btn go" :disabled="busy" @click="separate"><UserRound :size="15" /> Make a separate account</button>
        <p class="muted small">It gets its own name, such as {{ linking.account }}-2, and nothing of {{ linking.account }}'s. <button type="button" class="linkish small" @click="cancel">Cancel</button></p>
      </template>
      <p v-if="!setup && !linkShown && (!sso || formShown)" class="muted small">Forgot your password? An admin can set a new one on the Admin page, or on the server with <code>watchwright users reset-password &lt;name&gt;</code>.</p>
    </form>
  </main>
</template>

<style scoped>
.signin {
  display: grid;
  place-items: start center;
  min-height: 100vh;
  padding: 12vh var(--space-4) var(--space-6);
}
.box {
  display: grid;
  gap: var(--space-3);
  width: 100%;
  max-width: 380px;
}
.box h1,
.box p {
  margin: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.wordmark {
  font-family: var(--font-display);
  font-weight: var(--display-weight);
  font-size: 20px;
  font-stretch: var(--display-stretch);
  letter-spacing: var(--wordmark-tracking);
  text-transform: var(--wordmark-case);
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.go {
  justify-content: center;
  margin-top: var(--space-1);
}
.error {
  color: var(--bad);
}
.or {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.or::before,
.or::after {
  content: "";
  flex: 1;
  border-top: var(--border-width) solid var(--line);
}
.linkish {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
}
.linkish:hover {
  color: var(--text);
}
.warn {
  color: var(--warn);
}
</style>
