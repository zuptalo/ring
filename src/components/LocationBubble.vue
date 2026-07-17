<template>
  <!-- A shared location: a real (OSM-tile) mini-map; tapping offers Apple/Google
       Maps to open it in. -->
  <button type="button" class="loc-card" @click.stop="chooseMapApp(loc)">
    <div class="loc-map">
      <osm-mini-map :lat="loc.lat" :lng="loc.lng" />
    </div>
    <div class="loc-meta">
      <span class="loc-title">{{ loc.label || 'Shared location' }}</span>
      <span class="loc-coords">{{ coords }}</span>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import OsmMiniMap from '@/components/OsmMiniMap.vue';
import { chooseMapApp } from '@/utils/maps';
import type { GeoLocation } from '@/db/types';

const props = defineProps<{ loc: GeoLocation }>();
const coords = computed(() => `${props.loc.lat.toFixed(5)}, ${props.loc.lng.toFixed(5)}`);
</script>

<style scoped>
.loc-card {
  display: block;
  width: 240px;
  max-width: 100%;
  border: none;
  border-radius: 12px;
  overflow: hidden;
  padding: 0;
  text-align: start;
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.06);
}
.loc-map {
  position: relative;
  height: 120px;
}
.loc-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
}
.loc-title {
  font-size: 15px;
  font-weight: 600;
}
.loc-coords {
  font-size: 12px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
