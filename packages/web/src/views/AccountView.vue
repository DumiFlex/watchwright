<script setup lang="ts">
// Your account, while login is on: who you are, your password and your API tokens. Your
// preferences are on Settings; the server's settings on Admin. See docs/research/settings-pages.md.
import { computed } from "vue";
import { sectionsOn } from "../settingspages";
import AccountSettings from "../components/AccountSettings.vue";
import SettingsLayout from "../components/SettingsLayout.vue";

defineProps<{ section?: string | undefined }>();
const sections = computed(() => sectionsOn("account"));
</script>

<template>
  <SettingsLayout page="account" heading="Your account" :sections="sections" :section="section">
    <template #intro>Who you are on this server, your password, and the tokens your scripts and agents sign in with. Your preferences are in <a href="#/settings">Settings</a>.</template>
    <AccountSettings />
  </SettingsLayout>
</template>
