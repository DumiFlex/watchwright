<script setup lang="ts">
// Who sees a pack (admins, while login is on; docs/plans/pack-access.md): everyone signed in, or
// only chosen people and groups. Admins always see every pack. Everyone else doesn't see the pack
// or anything in it: not in lists, not by link, not in the live view.
import { computed, ref, watch } from "vue";
import { getJson, sendJson, type PackAccess, type UserInfo } from "../api";
import { ago } from "../format";
import { toast } from "../toasts";
import GroupsField from "./GroupsField.vue";
import ModalDialog from "./ModalDialog.vue";
import MultiSelect from "./MultiSelect.vue";
import RadioGroup from "./RadioGroup.vue";

const props = defineProps<{ packId: string; packName: string }>();
const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ saved: [access: PackAccess] }>();

const MODES = [
  { value: "everyone" as const, label: "Everyone signed in", note: "Every viewer, user and admin on this server." },
  { value: "chosen" as const, label: "Only chosen people and groups", note: "And the admins, who see every pack." },
];

const mode = ref<"everyone" | "chosen">("everyone");
const people = ref<string[]>([]);
const groups = ref<string[]>([]);
const current = ref<PackAccess | null>(null);
const users = ref<UserInfo[]>([]);
const others = ref<Record<string, PackAccess>>({});
const busy = ref(false);
const error = ref<string | null>(null);

watch(open, async (o) => {
  if (!o) return;
  error.value = null;
  const [a, u, all] = await Promise.all([getJson<PackAccess>(`/api/v1/packs/${props.packId}/access`), getJson<UserInfo[]>("/api/v1/auth/users"), getJson<Record<string, PackAccess>>("/api/v1/packs/access")]);
  if (!a.ok) return void (error.value = a.error.message);
  current.value = a.data;
  mode.value = a.data.mode;
  people.value = a.data.mode === "chosen" ? [...a.data.people] : [];
  groups.value = a.data.mode === "chosen" ? [...a.data.groups] : [];
  users.value = u.ok ? u.data : [];
  others.value = all.ok ? all.data : {};
});

// Admins see the pack anyway, so the list offers the others; a chosen person who is gone shows by id.
const personOptions = computed(() => {
  const opts = users.value.filter((u) => u.role !== "admin").map((u) => ({ value: u.id, label: u.displayName ?? u.name, note: `${u.role}${u.displayName ? ` · ${u.name}` : ""}${u.disabled ? " · can't sign in" : ""}` }));
  for (const id of people.value) if (!opts.some((o) => o.value === id)) opts.push({ value: id, label: "Removed user", note: id });
  return opts;
});
const knownGroups = computed(() => [
  ...users.value.flatMap((u) => [...u.groups, ...u.ssoGroups]),
  ...Object.values(others.value).flatMap((a) => (a.mode === "chosen" ? a.groups : [])),
]);
/** Who gets in through the groups picked, by name, for the line under the picker. */
const viaGroups = computed(() => {
  const want = new Set(groups.value.map((g) => g.toLowerCase()));
  return users.value.filter((u) => u.role !== "admin" && [...u.groups, ...u.ssoGroups].some((g) => want.has(g.toLowerCase()))).map((u) => u.displayName ?? u.name);
});
const nobody = computed(() => mode.value === "chosen" && people.value.length === 0 && groups.value.length === 0);

async function save() {
  busy.value = true;
  error.value = null;
  const body = mode.value === "everyone" ? { mode: "everyone" } : { mode: "chosen", people: people.value, groups: groups.value };
  const res = await sendJson<PackAccess>(`/api/v1/packs/${props.packId}/access`, body);
  busy.value = false;
  if (!res.ok) return void (error.value = res.error.message);
  toast(res.data.mode === "everyone" ? `Everyone signed in sees "${props.packName}".` : `Only the people you chose and the admins see "${props.packName}".`, { tone: "ok" });
  emit("saved", res.data);
  open.value = false;
}
</script>

<template>
  <ModalDialog v-model="open" :heading="`Who sees ${packName}`" width="540px">
    <form id="pack-access-form" class="pa" @submit.prevent="save">
      <p class="muted small">People who can't see a pack don't see its runs, results, files, dashboard, schedules or live view either. What they may do in a pack they see still follows their role.</p>
      <RadioGroup v-model="mode" :options="MODES" label="Who sees this pack" />
      <template v-if="mode === 'chosen'">
        <div class="fld">
          <label for="pa-people" class="lbl small">People</label>
          <MultiSelect id="pa-people" v-model="people" :options="personOptions" placeholder="Pick people" empty-label="Nobody picked" />
        </div>
        <div class="fld">
          <label for="pa-groups" class="lbl small">Groups</label>
          <GroupsField id="pa-groups" v-model="groups" :known="knownGroups" />
          <p class="muted small">
            {{ groups.length === 0 ? "Groups come from the sign-in provider, or an admin sets them under Users on the Admin page." : viaGroups.length ? `In these groups now: ${viaGroups.join(", ")}.` : "Nobody is in these groups yet." }}
          </p>
        </div>
        <p v-if="nobody" class="note small">With nobody picked, only the admins see this pack.</p>
      </template>
      <p v-if="current?.mode === 'chosen'" class="muted small">Last changed by {{ current.updatedBy || "an admin" }} {{ ago(current.updatedAt) }}.</p>
      <p v-if="error" class="error small" role="alert">{{ error }}</p>
    </form>
    <template #actions>
      <button type="button" class="btn" @click="open = false">Cancel</button>
      <button type="submit" form="pack-access-form" class="btn primary" :disabled="busy">Save</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.pa {
  display: grid;
  gap: var(--space-3);
}
.pa p {
  margin: 0;
}
.fld {
  display: grid;
  gap: var(--space-1);
}
.note {
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--warn);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warn) 10%, var(--surface));
}
.error {
  color: var(--bad);
}
</style>
