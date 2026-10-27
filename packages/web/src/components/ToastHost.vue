<script setup lang="ts">
// Shows the messages from toast() (src/toasts.ts) in the bottom right corner, or along the
// bottom at phone width. Mounted once, in App.vue.
import { X } from "../icons";
import { computed, onMounted, ref, watch } from "vue";
import { openModals } from "../popup";
import { dismissToast, holdToasts, toasts, type Toast } from "../toasts";

// The host is a manual popover so it sits in the top layer. A modal dialog makes the rest
// of the page inert, popovers included, so while one is open the host moves inside it.
// Moving it, or a new message, shows it again on top (the newest top-layer element wins).
const host = ref<HTMLElement | null>(null);
function raise() {
  const el = host.value;
  if (!el?.showPopover) return;
  if (el.matches(":popover-open")) el.hidePopover();
  el.showPopover();
}
const target = computed(() => openModals.at(-1) ?? "body");
onMounted(raise);
watch(target, raise, { flush: "post" });
watch(
  () => toasts.length,
  (n, old) => {
    if (n > old) raise();
  },
);

function act(t: Toast) {
  t.action?.run();
  dismissToast(t.id);
}
</script>

<template>
  <Teleport :to="target">
    <div ref="host" popover="manual" class="host" role="region" aria-label="Notifications" @pointerenter="holdToasts(true)" @pointerleave="holdToasts(false)" @focusin="holdToasts(true)" @focusout="holdToasts(false)">
      <TransitionGroup name="toast" tag="ol" aria-live="polite">
        <li v-for="t in toasts" :key="t.id" class="toast" :class="t.tone" :role="t.tone === 'bad' ? 'alert' : 'status'">
          <span class="mark" aria-hidden="true" />
          <span class="text">{{ t.text }}</span>
          <button v-if="t.action" type="button" class="action" @click="act(t)">{{ t.action.label }}</button>
          <button type="button" class="close" aria-label="Close" @click="dismissToast(t.id)">
            <X :size="13" />
          </button>
        </li>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.host {
  position: fixed;
  z-index: 90;
  inset: auto var(--space-4) var(--space-4) auto;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  overflow: visible;
  width: min(380px, calc(100vw - 2 * var(--space-4)));
  pointer-events: none;
}
ol {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px 8px 10px 12px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 12px 32px rgb(0 0 0 / 22%);
  font-size: 14px;
  pointer-events: auto;
}
.mark {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.ok .mark {
  background: var(--ok);
}
.bad .mark {
  background: var(--bad);
}
.warn .mark {
  background: var(--warn);
}
.bad {
  border-color: var(--bad);
}
.text {
  flex: 1;
  min-width: 0;
}
.action {
  flex: none;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.action:hover {
  background: var(--hover);
}
.close {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.close:hover {
  background: var(--hover);
  color: var(--text);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s,
    transform 0.18s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
@media (max-width: 480px) {
  .host {
    inset: auto var(--space-2) var(--space-2) var(--space-2);
    width: auto;
  }
}
</style>
