<script setup lang="ts">
import { Coffee, Heart, Wallet } from "@lucide/vue";
import { supportLinks } from "../support.js";

const icons = { github: Heart, coffee: Coffee, paypal: Wallet };
</script>

<template>
  <ul class="ww-support">
    <li v-for="link in supportLinks" :key="link.id">
      <a class="ww-support-link" :class="`is-${link.id}`" :href="link.href" target="_blank" rel="noopener">
        <span class="ww-support-icon"><component :is="icons[link.id]" :size="18" aria-hidden="true" /></span>
        <span class="ww-support-text">
          <span class="ww-support-label">{{ link.label }}</span>
          <span class="ww-support-detail">{{ link.detail }}</span>
        </span>
      </a>
    </li>
  </ul>
</template>

<style scoped>
.ww-support {
  display: grid;
  gap: 12px;
  margin: 20px 0 8px;
  padding: 0;
  list-style: none;
}

.ww-support li {
  margin: 0;
}

.vp-doc a.ww-support-link {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: border-color 0.2s, background-color 0.2s;
}

.vp-doc a.ww-support-link:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.vp-doc a.ww-support-link:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.ww-support-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--ww-support-tint);
}

.is-github {
  --ww-support-tint: var(--ww-support-pink);
}

.is-coffee {
  --ww-support-tint: var(--ww-support-amber);
}

.is-paypal {
  --ww-support-tint: var(--vp-c-brand-1);
}

.ww-support-text {
  display: grid;
  gap: 2px;
}

.ww-support-label {
  font-weight: 600;
  line-height: 1.4;
}

.ww-support-detail {
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.45;
}
</style>
