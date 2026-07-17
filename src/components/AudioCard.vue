<template>
  <div class="audio-card">
    <button type="button" class="audio-cover" :aria-label="playing ? 'Pause' : 'Play'" @click.stop="$emit('toggle')">
      <img v-if="coverUrl" :src="coverUrl" alt="" />
      <ion-icon v-else class="audio-note" :icon="musicalNotes" />
      <!-- Send in flight: the play scrim shows the cloud waterline instead of the glyph;
           same overlay box, so nothing about the card moves when the upload ends. -->
      <span v-if="uploadProgress !== undefined" class="audio-play"><cloud-fill :progress="uploadProgress" /></span>
      <span v-else class="audio-play"><ion-icon :icon="playing ? pause : play" /></span>
    </button>
    <div class="audio-meta">
      <span class="audio-title">{{ title }}</span>
      <span class="audio-artist">{{ artist || 'Unknown artist' }}</span>
      <div class="audio-bar" @click.stop="onSeek">
        <span class="audio-fill" :style="{ width: pct + '%' }" />
      </div>
      <div class="audio-foot">
        <span class="audio-time">{{ fmt(active ? elapsed : durationSec) }}<template v-if="active"> / {{ fmt(durationSec) }}</template></span>
        <speed-pill v-if="active" :rate="rate" @cycle="$emit('cycle-speed')" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play, pause, musicalNotes } from 'ionicons/icons';
import SpeedPill from '@/components/SpeedPill.vue';
import CloudFill from '@/components/CloudFill.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    artist?: string;
    durationSec?: number;
    coverUrl?: string;
    active?: boolean; // this card is the one loaded in the shared player
    playing?: boolean;
    progress?: number; // 0..1 (only meaningful when active)
    rate?: number; // playback speed of the shared player (only meaningful when active)
    uploadProgress?: number; // send in flight (sender side): 0..1, undefined = not uploading
  }>(),
  { progress: 0, rate: 1 },
);
const emit = defineEmits<{ (e: 'toggle'): void; (e: 'seek', frac: number): void; (e: 'cycle-speed'): void }>();

const pct = computed(() => Math.round((props.active ? props.progress : 0) * 100));
const elapsed = computed(() => (props.durationSec ?? 0) * (props.progress ?? 0));
const fmt = (s?: number) => {
  const t = Math.max(0, Math.floor(s ?? 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
function onSeek(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  emit('seek', Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
}
</script>

<style scoped>
.audio-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 250px;
  max-width: 100%;
}
.audio-cover {
  position: relative;
  flex: none;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 8px;
  overflow: hidden;
  padding: 0;
  cursor: pointer;
  background: rgba(var(--ion-color-primary-rgb), 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
}
.audio-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.audio-note {
  font-size: 26px;
  color: var(--ion-color-primary);
}
.audio-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 24px;
}
.audio-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.audio-title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-artist {
  font-size: 13px;
  color: var(--app-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-bar {
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.14);
  cursor: pointer;
  margin-top: 3px;
}
.audio-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--ion-color-primary);
}
.audio-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.audio-time {
  font-size: 11px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
