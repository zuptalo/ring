<template>
  <!-- Custom video player (no native controls, which would overlap the viewer's
       action bar): tap to play/pause, a centre play button when paused, and a
       seekable progress bar + time. Never autoplays. -->
  <div class="vid" @click="toggle">
    <video
      ref="el"
      class="vid-el"
      :src="src"
      playsinline
      preload="metadata"
      @timeupdate="onTime"
      @ended="onEnd"
      @loadedmetadata="onMeta"
    />
    <button v-if="!playing" class="vid-play" aria-label="Play" @click.stop="toggle">
      <ion-icon :icon="play" />
    </button>
    <div class="vid-controls" @click.stop>
      <span class="vid-time">{{ fmt(elapsed) }}</span>
      <div ref="bar" class="vid-bar" @click="seek">
        <div class="vid-prog" :style="{ width: progress * 100 + '%' }"></div>
      </div>
      <span class="vid-time">{{ fmt(total) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play } from 'ionicons/icons';

defineProps<{ src: string }>();

const el = ref<HTMLVideoElement>();
const bar = ref<HTMLElement>();
const playing = ref(false);
const elapsed = ref(0);
const total = ref(0);
const progress = ref(0);

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function toggle(): void {
  const v = el.value;
  if (!v) return;
  if (v.paused) {
    void v.play();
    playing.value = true;
  } else {
    v.pause();
    playing.value = false;
  }
}
function onMeta(): void {
  if (el.value && Number.isFinite(el.value.duration)) total.value = el.value.duration;
}
function onTime(): void {
  const v = el.value;
  if (!v) return;
  elapsed.value = v.currentTime;
  progress.value = total.value ? Math.min(1, v.currentTime / total.value) : 0;
}
function onEnd(): void {
  playing.value = false;
  progress.value = 0;
  elapsed.value = 0;
  if (el.value) el.value.currentTime = 0;
}
function seek(ev: MouseEvent): void {
  const b = bar.value;
  const v = el.value;
  if (!b || !v || !total.value) return;
  const rect = b.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  v.currentTime = ratio * total.value;
  onTime();
}
// Pause when unmounted / swiped away (the parent re-keys slides).
onBeforeUnmount(() => el.value?.pause());
</script>

<style scoped>
.vid {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.vid-el {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.vid-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.vid-controls {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
}
.vid-time {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: center;
}
.vid-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
  cursor: pointer;
}
.vid-prog {
  height: 100%;
  border-radius: 2px;
  background: var(--ion-color-primary);
}
</style>
