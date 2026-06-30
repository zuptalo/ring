<template>
  <!-- Inline Wall video player (NOT the chat MediaViewer): autoplays while visible, with a
       bottom bar — play/pause · mute · time + drag-scrubber · native fullscreen. Tapping the
       frame toggles play/pause. Full-screen uses the OS player (rotatable) on iOS. -->
  <div class="wv" @click="toggle">
    <video
      ref="el"
      v-autoplay-visible
      class="wv-video"
      :src="src"
      :poster="poster"
      muted
      playsinline
      @ended="onEnded"
      @play="onPlay"
      @pause="playing = false"
      @timeupdate="onTime"
      @loadedmetadata="onMeta"
    />
    <div class="wv-bar" @click.stop>
      <button class="wv-btn wv-play" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
        <ion-icon :icon="playing ? pauseIcon : playIcon" />
      </button>
      <button class="wv-btn vol-toggle" :aria-label="autoplayMuted ? 'Unmute' : 'Mute'" @click="setAutoplayMuted(!autoplayMuted)">
        <ion-icon :icon="autoplayMuted ? volumeMuteOutline : volumeHighOutline" />
      </button>
      <span class="wv-time">{{ fmt(cur) }}</span>
      <div
        class="wv-track"
        @click.stop
        @pointerdown="scrub.onPointerDown"
        @pointermove="scrub.onPointerMove"
        @pointerup="scrub.onPointerUp"
        @pointercancel="scrub.onPointerUp"
      >
        <div class="wv-rail"><div class="wv-prog" :style="{ width: pct }"></div></div>
      </div>
      <span class="wv-time">{{ fmt(dur) }}</span>
      <button class="wv-btn" aria-label="Full screen" @click="fullscreen">
        <ion-icon :icon="expandOutline" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play as playIcon, pause as pauseIcon, volumeHighOutline, volumeMuteOutline, expandOutline } from 'ionicons/icons';
import { vAutoplayVisible, autoplayMuted, setAutoplayMuted } from '@/directives/autoplay-visible';
import { useScrub } from '@/composables/useScrub';

defineProps<{ src?: string; poster?: string }>();

const el = ref<HTMLVideoElement>();
const playing = ref(false);
const cur = ref(0);
const dur = ref(0);
const pct = computed(() => (dur.value ? Math.min(100, (cur.value / dur.value) * 100) : 0) + '%');
const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function onPlay(): void {
  playing.value = true;
}
function onTime(): void {
  const v = el.value;
  if (!v) return;
  cur.value = v.currentTime;
  if (Number.isFinite(v.duration)) dur.value = v.duration;
}
function onMeta(): void {
  const v = el.value;
  if (v && Number.isFinite(v.duration)) dur.value = v.duration;
}
function toggle(): void {
  const v = el.value;
  if (!v) return;
  if (v.paused) void v.play().catch(() => {});
  else v.pause();
}
// Manual loop instead of the native `loop` attribute: a fresh play() each cycle re-establishes
// audio output, which iOS Safari otherwise drops on the 2nd loop of a once-muted clip.
function onEnded(): void {
  const v = el.value;
  if (!v) return;
  v.currentTime = 0;
  void v.play().catch(() => {});
}
const scrub = useScrub((ratio) => {
  const v = el.value;
  if (v && dur.value) v.currentTime = Math.min(1, Math.max(0, ratio)) * dur.value;
});
// Native fullscreen → the OS video player, which rotates to landscape and plays audio reliably.
function fullscreen(): void {
  const v = el.value as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | undefined;
  if (!v) return;
  v.muted = autoplayMuted.value;
  if (typeof v.webkitEnterFullscreen === 'function') v.webkitEnterFullscreen();
  else if (v.requestFullscreen) void v.requestFullscreen().catch(() => {});
}
</script>

<style scoped>
.wv {
  position: relative;
  width: 100%;
  height: 100%;
}
.wv-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
/* Bottom control bar, promoted to its own layer (translateZ) so it paints ABOVE the
   playing <video> on iOS. */
.wv-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
  z-index: 20;
  transform: translateZ(0);
  -webkit-transform: translateZ(0);
}
.wv-btn {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border: none;
  padding: 0;
  background: transparent;
  color: #fff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wv-time {
  flex: 0 0 auto;
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
/* Tall hitbox around a thin rail so a finger can grab it; touch-action:none lets the drag scrub. */
.wv-track {
  flex: 1 1 auto;
  height: 24px;
  display: flex;
  align-items: center;
  touch-action: none;
  cursor: pointer;
}
.wv-rail {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.35);
  overflow: hidden;
}
.wv-prog {
  height: 100%;
  background: #fff;
}
</style>
