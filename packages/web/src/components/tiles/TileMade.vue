<script setup lang="ts">
// What runs made: the latest value of a param or fact (and since when), the latest screenshot
// (with the one before beside it), the latest text or file, and the latest run as a card.
import { computed } from "vue";
import { useTileLinks } from "../../tilelinks";
import { ago, countsText, duration, fileSize, when } from "../../format";
import { runName, type FileItem, type TileData } from "../../dashboard";
import { FileText, ImageOff } from "../../icons";
import { vTip } from "../../tooltip";
import MarkdownView from "../MarkdownView.vue";
import StatusChip from "../StatusChip.vue";

const props = defineProps<
  { kind: "value"; data: TileData["value"] } | { kind: "shot"; data: TileData["shot"] } | { kind: "output"; data: TileData["output"] } | { kind: "latest"; data: TileData["latest"] }
>();

const links = useTileLinks();
const attemptHref = (a: FileItem) => links.attempt(a.runId, a.attemptId) ?? undefined;
const isMarkdown = (f: FileItem) => f.kind === "text" || /markdown/.test(f.contentType ?? "") || /\.md$/i.test(f.name);
const isImage = (f: FileItem) => /^image\//.test(f.contentType ?? "");
const shots = computed(() => (props.kind === "shot" ? [props.data.latest, props.data.previous].filter((x): x is FileItem => x !== null) : []));
const run = computed(() => (props.kind === "latest" ? props.data.run : null));
</script>

<template>
  <div class="tile-made">
    <template v-if="kind === 'value'">
      <p v-if="data.value === null" class="muted small">No run in range has a value for {{ data.name.replace(/^info\./, "") }}.</p>
      <template v-else>
        <p class="big">{{ data.value }}</p>
        <p v-if="data.since" class="muted small">
          since <span v-tip="when(data.since)">{{ ago(data.since) }}</span>
        </p>
      </template>
    </template>

    <template v-else-if="kind === 'shot'">
      <p v-if="!shots.length" class="none muted small"><ImageOff :size="15" /> No screenshot with this name in range.</p>
      <div v-else class="shots" :class="{ two: shots.length > 1 }">
        <figure v-for="(s, i) in shots" :key="s.attemptId + s.name">
          <component :is="attemptHref(s) ? 'a' : 'span'" :href="attemptHref(s)"><img :src="s.url" :alt="`${s.name} from ${s.testId}, ${runName(s)}`" loading="lazy" /></component>
          <figcaption class="muted small">
            {{ shots.length > 1 ? (i === 0 ? "Latest" : "Before") : s.testId }} · <span v-tip="when(s.at)">{{ runName(s) }}, {{ ago(s.at) }}</span>
          </figcaption>
        </figure>
      </div>
    </template>

    <template v-else-if="kind === 'output'">
      <p v-if="!data.latest" class="none muted small"><FileText :size="15" /> No text or file with this name in range.</p>
      <template v-else>
        <p class="muted small head">
          <component :is="attemptHref(data.latest) ? 'a' : 'span'" :href="attemptHref(data.latest)">{{ data.latest.testId }}</component> · <span v-tip="when(data.latest.at)">{{ runName(data.latest) }}, {{ ago(data.latest.at) }}</span>
          <a v-if="data.latest.url" class="open" :href="data.latest.url" target="_blank" rel="noopener">Open{{ data.latest.size ? ` (${fileSize(data.latest.size)})` : "" }}</a>
        </p>
        <div v-if="data.latest.text !== undefined" class="out">
          <MarkdownView v-if="isMarkdown(data.latest)" :source="data.latest.text" :label="data.latest.name" id-prefix="tile-md-" />
          <pre v-else class="mono small">{{ data.latest.text }}</pre>
          <p v-if="data.latest.truncated" class="muted small">Cut short; open the attempt for all of it.</p>
        </div>
        <img v-else-if="isImage(data.latest)" class="out-img" :src="data.latest.url" :alt="data.latest.name" loading="lazy" />
      </template>
    </template>

    <template v-else-if="run">
      <div class="run">
        <p class="rhead">
          <component :is="links.run(run.id) ? 'a' : 'span'" :href="links.run(run.id) ?? undefined" class="rname">{{ runName(run) }}</component>
          <StatusChip :status="run.status" />
        </p>
        <p class="small">{{ countsText({ ...run.counts, running: 0, interrupted: 0, planned: 0 }) }}</p>
        <p class="muted small">
          <span v-tip="when(run.createdAt)">{{ ago(run.createdAt) }}</span> · by {{ run.startedBy }}<template v-if="run.durationMs !== null"> · {{ duration(run.durationMs) }}</template>
        </p>
        <p v-if="Object.keys(run.params).length || Object.keys(run.info).length" class="vals small">
          <code v-for="(v, k) in run.params" :key="`p${k}`">{{ k }}={{ v }}</code>
          <code v-for="(v, k) in run.info" :key="`i${k}`" class="info">{{ k }}: {{ v }}</code>
        </p>
      </div>
    </template>
    <p v-else class="muted small">No run in range yet.</p>
  </div>
</template>

<style scoped>
p {
  margin: 0;
}
.tile-made {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}
.big {
  overflow: hidden;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.none {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.shots {
  display: grid;
  gap: var(--space-2);
}
.shots.two {
  grid-template-columns: 1fr 1fr;
}
figure {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  margin: 0;
}
img {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  object-position: top left;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--raised);
}
.head {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-1);
}
.open {
  margin-left: auto;
}
.out {
  max-height: 280px;
  overflow: auto;
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
}
pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.run {
  display: grid;
  gap: var(--space-1);
}
.rhead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.rname {
  font-weight: 600;
}
.vals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.vals code {
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: var(--raised);
}
</style>
