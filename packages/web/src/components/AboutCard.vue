<script setup lang="ts">
// Settings › About: the version, where Watchwright lives, and how to support it.
import { onMounted, ref } from "vue";
import { getJson, type HealthData } from "../api";
import { BookOpen, ExternalLink, MessageSquareWarning, Star } from "../icons";
import { DOCS_URL, REPO_URL, SUPPORT_LINKS } from "../support";

const version = ref<string | null>(null);
onMounted(async () => {
  const res = await getJson<HealthData>("/api/v1/health");
  if (res.ok) version.value = res.data.version;
});
</script>

<template>
  <section class="card about" aria-labelledby="s-about">
    <h2 id="s-about" class="display">About</h2>
    <p class="muted small">
      Watchwright {{ version ? `v${version}` : "" }} is free and open source under the Apache-2.0 license, made by
      <a href="https://github.com/DumiFlex" target="_blank" rel="noopener">DumiFlex</a>.
    </p>
    <ul class="links">
      <li><a :href="DOCS_URL" target="_blank" rel="noopener"><BookOpen :size="15" /> Docs</a></li>
      <li><a :href="REPO_URL" target="_blank" rel="noopener"><Star :size="15" /> Star on GitHub</a></li>
      <li><a :href="`${REPO_URL}/issues`" target="_blank" rel="noopener"><MessageSquareWarning :size="15" /> Report a bug or idea</a></li>
    </ul>
    <h3 class="sub">Support the project</h3>
    <p class="muted small">There is no company behind Watchwright and no paid tier. If it saves you time, a donation helps keep it maintained.</p>
    <ul class="support">
      <li v-for="link in SUPPORT_LINKS" :key="link.id">
        <a class="support-link" :class="`is-${link.id}`" :href="link.href" target="_blank" rel="noopener">
          <span class="support-icon"><component :is="link.icon" :size="16" /></span>
          <span class="support-text">
            <span class="support-label">{{ link.label }}</span>
            <span class="muted small">{{ link.detail }}</span>
          </span>
          <ExternalLink class="support-out" :size="13" />
        </a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.about {
  display: grid;
  gap: var(--space-3);
}
.about > h2:first-child,
.about p {
  margin: 0;
}
.about > h2:first-child + p,
.sub + p {
  margin-top: calc(-1 * var(--space-2));
}
.sub {
  margin: var(--space-2) 0 0;
  font-size: 14px;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}
.links a {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.support {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.support-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 100%;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  text-decoration: none;
}
.support-link:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.support-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--accent-text);
}
.is-github .support-icon {
  color: var(--jewel);
}
.support-text {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.support-label {
  font-weight: 600;
}
.support-out {
  flex: none;
  color: var(--muted);
}
</style>
