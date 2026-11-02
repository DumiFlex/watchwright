<script setup lang="ts">
// Settings > Single sign-on (admins, while login is on): sign in through an OpenID Connect provider
// (VoidAuth, Authentik, Authelia, Pocket ID, Keycloak…) or through a header a reverse proxy sets
// after its own sign-in, with roles from the person's groups (docs/plans/self-hosting.md, 2.6).
import { computed, onMounted, ref } from "vue";
import { getJson, sendJson } from "../api";
import { Plus, Trash2 } from "../icons";
import { loadSession, type Role } from "../session";
import { toast } from "../toasts";
import { vTip } from "../tooltip";
import CodeView from "./CodeView.vue";
import SelectMenu from "./SelectMenu.vue";
import TextField from "./TextField.vue";
import ToggleSwitch from "./ToggleSwitch.vue";

interface Sso {
  oidc: { on: boolean; name: string; issuer: string; clientId: string; hasSecret: boolean; scopes: string; groupsClaim: string };
  header: { on: boolean; user: string; groups: string; from: string[] };
  roles: { group: string; role: Role }[];
  otherRole: Role | "none";
  passwords: boolean;
}

const ROLE_OPTIONS = [
  { value: "viewer" as const, label: "Viewer" },
  { value: "user" as const, label: "User" },
  { value: "admin" as const, label: "Admin" },
];
const OTHER_OPTIONS = [{ value: "none" as const, label: "No access" }, ...ROLE_OPTIONS];

// Filled from the server on mount (`loaded`); these are only placeholders until then.
const s = ref<Sso>({
  oidc: { on: false, name: "", issuer: "", clientId: "", hasSecret: false, scopes: "", groupsClaim: "" },
  header: { on: false, user: "", groups: "", from: [] },
  roles: [],
  otherRole: "viewer",
  passwords: true,
});
const loaded = ref(false);
// The secret is never shown; typing one replaces the saved one.
const secret = ref("");
const from = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const callback = `${location.origin}/api/v1/auth/oidc/callback`;

function take(data: Sso) {
  s.value = data;
  loaded.value = true;
  from.value = data.header.from.join(", ");
  secret.value = "";
}
onMounted(async () => {
  const res = await getJson<Sso>("/api/v1/auth/sso");
  if (res.ok) take(res.data);
});

const addRole = () => s.value.roles.push({ group: "", role: "user" });

async function save() {
  busy.value = true;
  error.value = null;
  const o = s.value.oidc;
  const oidc = { on: o.on, name: o.name, issuer: o.issuer, clientId: o.clientId, scopes: o.scopes, groupsClaim: o.groupsClaim };
  const res = await sendJson<Sso>("/api/v1/auth/sso", {
    oidc: { ...oidc, ...(secret.value ? { clientSecret: secret.value } : {}) },
    header: { ...s.value.header, from: from.value.split(/[\s,]+/).filter(Boolean) },
    roles: s.value.roles.filter((r) => r.group.trim()),
    otherRole: s.value.otherRole,
    passwords: s.value.passwords,
  });
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  take(res.data);
  await loadSession();
  toast("Single sign-on saved.", { tone: "ok" });
}
const anyOn = computed(() => s.value.oidc.on || s.value.header.on);
</script>

<template>
  <section class="card sso" aria-labelledby="s-sso">
    <h2 id="s-sso" class="display">Single sign-on</h2>
    <p class="muted small">Let people sign in with the account they already have, through your sign-in provider or the reverse proxy in front of Watchwright. Accounts are made on first sign-in, with a role from their groups.</p>
    <template v-if="loaded">
      <form class="grid" @submit.prevent="save">
        <div class="block">
          <ToggleSwitch id="sso-oidc" v-model="s.oidc.on">Sign in with an OpenID Connect provider</ToggleSwitch>
          <p class="muted small">VoidAuth, Authentik, Authelia, Pocket ID, Keycloak and others. Make a client for Watchwright there, with this redirect address:</p>
          <CodeView :code="callback" label="Redirect address" />
          <div class="fields">
            <div class="fld">
              <label for="sso-name" class="lbl small">Button name</label>
              <TextField id="sso-name" v-model="s.oidc.name" placeholder="VoidAuth" />
            </div>
            <div class="fld wide">
              <label for="sso-issuer" class="lbl small">Issuer</label>
              <TextField id="sso-issuer" v-model="s.oidc.issuer" placeholder="https://auth.example.com" />
            </div>
            <div class="fld">
              <label for="sso-client" class="lbl small">Client id</label>
              <TextField id="sso-client" v-model="s.oidc.clientId" />
            </div>
            <div class="fld">
              <label for="sso-secret" class="lbl small">Client secret</label>
              <TextField id="sso-secret" v-model="secret" type="password" autocomplete="off" :placeholder="s.oidc.hasSecret ? 'Saved (type to replace)' : 'None (public client)'" />
            </div>
            <div class="fld">
              <label for="sso-scopes" class="lbl small">Scopes</label>
              <TextField id="sso-scopes" v-model="s.oidc.scopes" />
            </div>
            <div class="fld">
              <label for="sso-claim" class="lbl small">Groups claim</label>
              <TextField id="sso-claim" v-model="s.oidc.groupsClaim" placeholder="groups" />
            </div>
          </div>
        </div>

        <div class="block">
          <ToggleSwitch id="sso-header" v-model="s.header.on">Trust a header from the reverse proxy</ToggleSwitch>
          <p class="muted small">For proxies that sign people in themselves (forward auth) and pass the name on. The header counts only from the proxy's address; from anywhere else the request is refused.</p>
          <div class="fields">
            <div class="fld">
              <label for="sso-user" class="lbl small">User header</label>
              <TextField id="sso-user" v-model="s.header.user" placeholder="Remote-User" />
            </div>
            <div class="fld">
              <label for="sso-groups" class="lbl small">Groups header</label>
              <TextField id="sso-groups" v-model="s.header.groups" placeholder="Remote-Groups" />
            </div>
            <div class="fld wide">
              <label for="sso-from" class="lbl small">Proxy address</label>
              <TextField id="sso-from" v-model="from" placeholder="172.18.0.0/16" />
            </div>
          </div>
        </div>

        <div class="block">
          <h3 class="sub">Roles from groups</h3>
          <p class="muted small">Someone in several groups gets the highest role. With groups listed here, the role is set again at every sign-in.</p>
          <ul v-if="s.roles.length" class="roles">
            <li v-for="(r, i) in s.roles" :key="i">
              <TextField :id="`sso-group-${i}`" v-model="r.group" placeholder="Group name" aria-label="Group" />
              <SelectMenu :id="`sso-role-${i}`" v-model="r.role" :options="ROLE_OPTIONS" />
              <button v-tip="'Remove this group'" type="button" class="ib" aria-label="Remove this group" @click="s.roles.splice(i, 1)"><Trash2 :size="14" /></button>
            </li>
          </ul>
          <div>
            <button type="button" class="btn" @click="addRole"><Plus :size="15" /> Add a group</button>
          </div>
          <div class="fld other">
            <label for="sso-other" class="lbl small">Anyone else who signs in</label>
            <SelectMenu id="sso-other" v-model="s.otherRole" :options="OTHER_OPTIONS" />
          </div>
        </div>

        <div class="block">
          <ToggleSwitch id="sso-passwords" v-model="s.passwords" :disabled="!anyOn && s.passwords">Everyone may also sign in with a password</ToggleSwitch>
          <p class="muted small">Off: only admins can, so a provider that's down can't lock them out. Accounts made by single sign-on have no password.</p>
        </div>

        <p v-if="error" class="error small" role="alert">{{ error }}</p>
        <div>
          <button type="submit" class="btn primary" :disabled="busy">{{ busy ? "Checking the provider…" : "Save" }}</button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.sso,
.grid {
  display: grid;
  gap: var(--space-3);
}
.sso > h2:first-child,
.sso p {
  margin: 0;
}
.sso > h2:first-child + p {
  margin-top: calc(-1 * var(--space-2));
}
.block {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
}
.sub {
  margin: 0;
  font-size: 13px;
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2) var(--space-3);
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.wide {
  grid-column: 1 / -1;
}
.other {
  max-width: 260px;
}
.roles {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.roles li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px auto;
  align-items: center;
  gap: var(--space-2);
}
.error {
  color: var(--bad);
}
.ib {
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
.ib:hover {
  background: var(--hover);
  color: var(--bad);
}
@media (max-width: 640px) {
  .fields {
    grid-template-columns: 1fr;
  }
  .roles li {
    grid-template-columns: minmax(0, 1fr) 120px auto;
  }
  .other {
    max-width: none;
  }
}
</style>
