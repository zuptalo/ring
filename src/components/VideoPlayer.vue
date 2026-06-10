<template>
  <!-- Custom video player. Standalone it draws its own scrubber; `embedded` (in the
       media viewer) hides that row so the viewer can host the scrubber ABOVE its action
       bar, and a tap on the video toggles the viewer chrome instead of play/pause. -->
  <div class="vid" @click="onSurfaceClick">
    <video
      ref="el"
      class="vid-el"
      :src="src"
      playsinline
      preload="metadata"
      @timeupdate="onTime"
      @ended="onEnd"
      @loadedmetadata="onMeta"
      @play="playing = true"
      @pause="playing = false"
    />
    <button
      v-if="!playing && !(embedded && chromeHidden)"
      class="vid-play"
      aria-label="Play"
      @click.stop="toggle"
    >
      <ion-icon :icon="play" />
    </button>
    <div v-if="!embedded" class="vid-controls" @click.stop>
      <span class="vid-time">{{ fmt(elapsed) }}</span>
      <div ref="bar" class="vid-bar" @click="onBarClick">
        <div class="vid-prog" :style="{ width: progress * 100 + '%' }"></div>
      </div>
      <span class="vid-time">{{ fmt(total) }}</span>
      <speed-pill :rate="rate" @cycle="cycleRate" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play } from 'ionicons/icons';
import SpeedPill from '@/components/SpeedPill.vue';
import { nextRate, playWhenReady } from '@/utils/playback';

const props = defineProps<{ src: string; embedded?: boolean; chromeHidden?: boolean }>();
const emit = defineEmits<{ (e: 'tap'): void }>();

const el = ref<HTMLVideoElement>();
const bar = ref<HTMLElement>();
const playing = ref(false);
const elapsed = ref(0);
const total = ref(0);
const progress = ref(0);
const rate = ref(1);
const pipActive = ref(false);

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function toggle(): void {
  const v = el.value;
  if (!v) return;
  if (v.paused) void playWhenReady(v); // @play/@pause sync `playing`
  else v.pause();
}
// A tap on the video surface: in the viewer that toggles the chrome (immersive view);
// standalone it plays/pauses.
function onSurfaceClick(): void {
  if (props.embedded) emit('tap');
  else toggle();
}
function cycleRate(): void {
  rate.value = nextRate(rate.value);
  if (el.value) el.value.playbackRate = rate.value;
}
function seekTo(ratio: number): void {
  const v = el.value;
  if (!v || !total.value) return;
  v.currentTime = Math.min(1, Math.max(0, ratio)) * total.value;
  onTime();
}
function onBarClick(ev: MouseEvent): void {
  const b = bar.value;
  if (!b) return;
  const rect = b.getBoundingClientRect();
  seekTo((ev.clientX - rect.left) / rect.width);
}

/* ---- Picture-in-Picture (native), for the same float-while-you-browse behavior as
   calls. Standard API on Chromium/desktop; webkitSetPresentationMode on iOS Safari. */
interface WebkitVideo {
  webkitSetPresentationMode?: (m: 'inline' | 'picture-in-picture') => void;
  webkitPresentationMode?: string;
}
const pipSupported = computed(() => {
  const v = el.value as (HTMLVideoElement & WebkitVideo) | undefined;
  if (!v) return false;
  return (
    (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true ||
    typeof v.webkitSetPresentationMode === 'function'
  );
});
async function togglePip(): Promise<void> {
  const v = el.value as (HTMLVideoElement & WebkitVideo) | undefined;
  if (!v) return;
  try {
    const inPip = document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture';
    if (inPip) {
      if (document.exitPictureInPicture) await document.exitPictureInPicture();
      else v.webkitSetPresentationMode?.('inline');
    } else if (v.requestPictureInPicture) {
      await v.requestPictureInPicture();
    } else {
      v.webkitSetPresentationMode?.('picture-in-picture');
    }
  } catch {
    /* unsupported or rejected (needs a user gesture / element not ready) */
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

const onEnterPip = (): void => {
  pipActive.value = true;
};
const onLeavePip = (): void => {
  pipActive.value = false;
};
onMounted(() => {
  el.value?.addEventListener('enterpictureinpicture', onEnterPip);
  el.value?.addEventListener('leavepictureinpicture', onLeavePip);
});
// Pause when unmounted / swiped away (the parent re-keys slides).
onBeforeUnmount(() => {
  el.value?.removeEventListener('enterpictureinpicture', onEnterPip);
  el.value?.removeEventListener('leavepictureinpicture', onLeavePip);
  el.value?.pause();
});

// Surface state + controls so the media viewer can host the scrubber/PiP in its chrome.
defineExpose({ playing, elapsed, total, progress, rate, pipActive, toggle, seekTo, cycleRate, togglePip, pipSupported });
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
  bottom: max(12px, env(safe-area-inset-bottom));
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
