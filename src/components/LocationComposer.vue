<template>
  <ion-modal :is-open="open" @did-present="start" @did-dismiss="onDismiss">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button @click="$emit('close')">Cancel</ion-button></ion-buttons>
        <ion-title>Send location</ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" :disabled="!fix" @click="send">Send</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="map-wrap">
        <osm-mini-map v-if="fix" :lat="fix.lat" :lng="fix.lng" />
        <div v-else class="map-loading"><ion-spinner /></div>
      </div>
      <div class="status">
        <ion-icon :icon="locationOutline" :color="accurate ? 'success' : 'medium'" />
        <span v-if="error">{{ error }}</span>
        <span v-else-if="fix">
          Accurate to about {{ Math.round(fix.accuracy) }} m<template v-if="!accurate"> · improving…</template>
        </span>
        <span v-else>Locating you…</span>
      </div>
      <div v-if="fix" class="coords">{{ fix.lat.toFixed(5) }}, {{ fix.lng.toFixed(5) }}</div>
      <div class="ion-padding">
        <ion-button expand="block" fill="outline" :disabled="!fix" @click="preview">
          <ion-icon slot="start" :icon="mapOutline" />
          Preview in Maps
        </ion-button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonSpinner,
} from '@ionic/vue';
import { locationOutline, mapOutline } from 'ionicons/icons';
import OsmMiniMap from '@/components/OsmMiniMap.vue';
import { chooseMapApp } from '@/utils/maps';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'send', loc: { lat: number; lng: number }): void }>();

interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}
const fix = ref<Fix | null>(null);
const error = ref('');
const accurate = computed(() => !!fix.value && fix.value.accuracy <= 25);
let watchId: number | null = null;

function preview(): void {
  if (fix.value) void chooseMapApp({ lat: fix.value.lat, lng: fix.value.lng });
}

function start(): void {
  fix.value = null;
  error.value = '';
  if (!navigator.geolocation) {
    error.value = 'Location is not available on this device';
    return;
  }
  // Keep the best (most accurate) reading as the GPS converges.
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const next: Fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      if (!fix.value || next.accuracy <= fix.value.accuracy) fix.value = next;
    },
    (err) => {
      if (!fix.value) error.value = err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Could not get your location';
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  );
}

function stop(): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function onDismiss(): void {
  stop();
  emit('close');
}

function send(): void {
  if (!fix.value) return;
  emit('send', { lat: fix.value.lat, lng: fix.value.lng });
  stop();
}
</script>

<style scoped>
.map-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: var(--app-surface);
}
.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 2px;
  font-size: 14px;
  color: var(--app-text);
}
.coords {
  padding: 0 16px;
  font-size: 13px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
