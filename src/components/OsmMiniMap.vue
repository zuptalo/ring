<template>
  <!-- A small, non-interactive map built from raster OpenStreetMap tiles centred
       on the point (no map library, no API key). A pin marks the exact spot. -->
  <div class="osm">
    <div class="osm-tiles">
      <img
        v-for="t in tiles"
        :key="t.key"
        :src="t.url"
        :style="t.style"
        class="osm-tile"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        alt=""
      />
    </div>
    <ion-icon class="osm-pin" :icon="location" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { location } from 'ionicons/icons';

const props = withDefaults(defineProps<{ lat: number; lng: number; zoom?: number }>(), { zoom: 16 });

const TILE = 256;
const tiles = computed(() => {
  const z = props.zoom;
  const n = 2 ** z;
  const xf = ((props.lng + 180) / 360) * n;
  const yf = ((1 - Math.asinh(Math.tan((props.lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const cx = Math.floor(xf);
  const cy = Math.floor(yf);
  const ox = (xf - cx) * TILE; // pixel of the point inside the centre tile
  const oy = (yf - cy) * TILE;
  const out: Array<{ key: string; url: string; style: Record<string, string> }> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= n) continue;
      const x = (((cx + dx) % n) + n) % n;
      out.push({
        key: `${dx}_${dy}`,
        url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        style: {
          left: `calc(50% - ${ox}px + ${dx * TILE}px)`,
          top: `calc(50% - ${oy}px + ${dy * TILE}px)`,
        },
      });
    }
  }
  return out;
});
</script>

<style scoped>
.osm {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #e8eaed;
}
.osm-tiles {
  position: absolute;
  inset: 0;
}
.osm-tile {
  position: absolute;
  width: 256px;
  height: 256px;
  max-width: none;
}
.osm-pin {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -100%);
  font-size: 34px;
  color: var(--ion-color-primary);
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.4));
  pointer-events: none;
}
</style>
