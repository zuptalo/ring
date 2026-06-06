<template>
  <!-- Round video-note bubble: tap to play (with sound), long-press for actions;
       a ring shows progress; shows the first-frame thumbnail until played. -->
  <div
    class="vnp"
    @pointerdown="lpDown"
    @pointerup="lpUp"
    @pointerleave="lpUp"
    @click.stop="onClick"
  >
    <video
      ref="el"
      class="vnp-video"
      :src="src"
      :poster="poster"
      playsinline
      preload="metadata"
      @loadedmetadata="onMeta"
      @timeupdate="onTime"
      @ended="onEnd"
    ></video>
    <svg class="vnp-ring" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="48" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - progress)" />
    </svg>
    <div v-if="!playing" class="vnp-play"><ion-icon :icon="play" /></div>
    <div class="vnp-badge">
      <ion-icon :icon="playing ? volumeHigh : volumeMute" />
      {{ fmt(playing ? Math.max(0, total - elapsed) : total) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play, volumeHigh, volumeMute } from 'ionicons/icons';

const props = defineProps<{ src: string; durationSec?: number; poster?: string }>();
const emit = defineEmits<{ (e: 'menu', ev: PointerEvent): void }>();

const CIRC = 2 * Math.PI * 48;
const el = ref<HTMLVideoElement>();
const playing = ref(false);
const elapsed = ref(0);
const total = ref(props.durationSec ?? 0);
const progress = computed(() => (total.value ? Math.min(1, elapsed.value / total.value) : 0));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function toggle(): void {
  const v = el.value;
  if (!v) return;
  if (v.paused) {
    v.muted = false;
    void v.play();
    playing.value = true;
  } else {
    v.pause();
    playing.value = false;
  }
}

// Long-press opens the message actions (react / reply / forward / …).
let lpTimer: number | undefined;
let lp = false;
function lpDown(e: PointerEvent): void {
  lp = false;
  lpTimer = window.setTimeout(() => {
    lp = true;
    emit('menu', e);
  }, 500);
}
function lpUp(): void {
  if (lpTimer) clearTimeout(lpTimer);
  lpTimer = undefined;
}
function onClick(): void {
  if (lp) {
    lp = false;
    return;
  }
  toggle();
}
function onMeta(): void {
  if (el.value && Number.isFinite(el.value.duration) && el.value.duration > 0) total.value = el.value.duration;
}
function onTime(): void {
  if (el.value) elapsed.value = el.value.currentTime;
}
function onEnd(): void {
  playing.value = false;
  elapsed.value = 0;
  if (el.value) el.value.currentTime = 0;
}
onBeforeUnmount(() => el.value?.pause());
</script>

<style scoped>
.vnp {
  position: relative;
  width: 200px;
  height: 200px;
  cursor: pointer;
}
.vnp-video {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: #000;
}
.vnp-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  pointer-events: none;
}
.vnp-ring circle {
  fill: none;
  stroke: var(--ion-color-primary);
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.2s linear;
}
.vnp-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.vnp-badge {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
}
.vnp-badge ion-icon {
  font-size: 13px;
}
</style>
