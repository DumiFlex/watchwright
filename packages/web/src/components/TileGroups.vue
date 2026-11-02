<script setup lang="ts">
// A dashboard's groups of tiles: each group's title over a grid of four columns, two on a narrow
// screen and one on a phone. Used by a pack's page, the public status page and shared runs.
import type { TileGroupResult } from "../dashboard";
import DashboardTile from "./tiles/DashboardTile.vue";

defineProps<{
  groups: readonly TileGroupResult[];
  packId: string;
  /** The pack's latest run ids, newest first (for the links tile). */
  latestRuns?: readonly string[];
  /** Two columns at most (a narrow place, like a shared run's header). */
  narrow?: boolean;
}>();
</script>

<template>
  <div class="tile-groups">
    <div v-for="(g, gi) in groups" :key="gi" class="tg-group">
      <h3 v-if="g.title" class="gtitle">{{ g.title }}</h3>
      <div class="tg-grid" :class="{ narrow }">
        <DashboardTile v-for="(t, ti) in g.tiles" :key="`${gi}-${ti}-${t.tile.type}`" :result="t" :pack-id="packId" :latest-runs="latestRuns ?? []" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tile-groups {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.tg-group {
  display: grid;
  gap: var(--space-2);
}
.gtitle {
  margin: var(--space-2) 0 0;
  font-size: 14px;
  font-weight: 600;
}
.tg-grid {
  --cols: 4;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}
.tg-grid.narrow {
  --cols: 2;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (max-width: 1000px) {
  .tg-grid {
    --cols: 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .tg-grid,
  .tg-grid.narrow {
    --cols: 1;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
