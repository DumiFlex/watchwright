<script setup lang="ts">
// The frame of the Account, Settings and Admin pages: the heading, a list of the page's sections
// (down the side on wide screens, above the cards on narrow ones) and the cards. The one marked is
// the last whose heading has passed the top bar (the last one at the bottom of the page, which may
// never get that far). `?section=` opens on a section; one that lives on another page now (an old
// `#/settings?section=` link) opens there.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { movedTo, type SectionDef, type SettingsPage } from "../settingspages";
import { session } from "../session";
import { sectionAt } from "../toc";

const props = defineProps<{
  page: SettingsPage;
  heading: string;
  sections: SectionDef[];
  section?: string | undefined;
}>();

const TOP_BAR = 56;
// The list in blocks: a section that starts a group starts a block, under its heading. Each block
// draws its own rail, so a heading sits apart from the links and the rail breaks between groups.
const blocks = computed(() => {
  const out: { group: string | undefined; sections: SectionDef[] }[] = [];
  for (const sec of props.sections) {
    const last = out[out.length - 1];
    if (!last || sec.group) out.push({ group: sec.group, sections: [sec] });
    else last.sections.push(sec);
  }
  return out;
});
const current = ref(props.sections[0]?.id ?? "");
const cardOf = (id: string) => document.getElementById(`s-${id}`)?.closest("section") ?? null;

function goTo(id: string) {
  const card = cardOf(id);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  current.value = id;
}
let frame = 0;
function markCurrent() {
  frame = 0;
  if (!props.sections.length) return;
  const root = document.scrollingElement;
  const atBottom = !!root && root.scrollTop + window.innerHeight >= root.scrollHeight - 2;
  const tops = props.sections.map((s) => cardOf(s.id)?.getBoundingClientRect().top ?? null);
  current.value = props.sections[sectionAt(tops, TOP_BAR + 24, atBottom)]!.id;
}
const onScroll = () => {
  if (!frame) frame = requestAnimationFrame(markCurrent);
};

async function open(section: string | undefined) {
  if (!section) return;
  // Where a section lives depends on who is signed in, so wait until that is known.
  if (!session.loaded)
    await new Promise<void>((done) => {
      const stop = watch(
        () => session.loaded,
        (ok) => {
          if (ok) {
            stop();
            done();
          }
        },
      );
    });
  const moved = movedTo(props.page, section);
  if (moved) return void location.replace(`#/${moved}?section=${section}`);
  void nextTick(() => setTimeout(() => goTo(section), 300));
}
watch(toRef(props, "section"), (s) => void open(s));
// The list can change after the page opens (who is signed in loads, a role changes).
watch(
  () => props.sections.map((s) => s.id).join(),
  () => void nextTick(markCurrent),
);
onMounted(() => {
  void open(props.section);
  window.addEventListener("scroll", onScroll, { passive: true });
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  if (frame) cancelAnimationFrame(frame);
});
</script>

<template>
  <main class="page narrow">
    <div class="page-head">
      <div>
        <h1 class="display">{{ heading }}</h1>
        <p class="muted"><slot name="intro" /></p>
      </div>
    </div>

    <div class="layout">
      <nav class="toc" :aria-label="`${heading} sections`">
        <div v-for="(b, bi) in blocks" :key="b.sections[0]!.id" class="block">
          <p v-if="b.group" :id="`toc-g-${bi}`" class="group label">{{ b.group }}</p>
          <ul :aria-labelledby="b.group ? `toc-g-${bi}` : undefined">
            <li v-for="sec in b.sections" :key="sec.id">
              <button type="button" :class="{ on: current === sec.id }" :aria-current="current === sec.id ? 'true' : undefined" @click="goTo(sec.id)">
                {{ sec.label }}
              </button>
            </li>
          </ul>
        </div>
      </nav>
      <div class="sections">
        <slot />
      </div>
    </div>
  </main>
</template>

<style scoped>
.narrow {
  max-width: 1080px;
}
.layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
.sections {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}
.sections > :deep(section) {
  scroll-margin-top: calc(56px + var(--space-4));
}
.toc {
  position: sticky;
  top: calc(56px + var(--space-4));
  display: grid;
  gap: var(--space-4);
}
.toc ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* The group's heading stands off the rail, flush with its left edge, and in the text color so it
   doesn't read as one more link. */
.toc .group {
  margin-bottom: var(--space-2);
  color: var(--text);
}
.toc button {
  display: block;
  width: 100%;
  padding: 6px var(--space-3);
  border: 0;
  border-left: 2px solid var(--line);
  border-radius: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.toc button:hover {
  color: var(--text);
  background: var(--hover);
}
.toc button.on {
  border-left-color: var(--accent);
  color: var(--text);
  font-weight: 600;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .toc {
    position: static;
  }
  .toc {
    gap: var(--space-3);
  }
  .toc ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .toc .group {
    margin-bottom: var(--space-1);
  }
  .toc button {
    width: auto;
    padding: 4px 10px;
    border: var(--border-width) solid var(--line);
    border-radius: var(--radius-chip);
    font-size: 13px;
  }
  .toc button.on {
    border-color: var(--line);
    font-weight: 400;
  }
}
</style>
