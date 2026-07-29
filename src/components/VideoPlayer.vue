<template>
  <!-- Custom video player. Standalone it draws its own scrubber; `embedded` (in the
       media viewer) hides that row so the viewer can host the scrubber ABOVE its action
       bar, and a tap on the video toggles the viewer chrome instead of play/pause.
       spec 1018 US1 invariant: this plays the bytes as-is and applies NO rotation of its
       own (no CSS transform / image-orientation). Orientation is baked upright by the
       sender's transcode (media-video-webcodecs/ffmpeg), so adding rotation here would
       double-correct. Keep it transform-free. -->
  <div class="vid" @click="onSurfaceClick">
    <video
      ref="el"
      class="vid-el"
      :src="src"
      :poster="poster"
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
      <!-- Tap to jump, drag to scrub (useScrub). The track is a tall hitbox
           around the thin visible rail so a finger can actually grab it. -->
      <div
        class="vid-bar"
        @pointerdown="scrub.onPointerDown"
        @pointermove="scrub.onPointerMove"
        @pointerup="scrub.onPointerUp"
        @pointercancel="scrub.onPointerUp"
      >
        <div class="vid-rail">
          <div class="vid-prog" :style="{ width: progress * 100 + '%' }"></div>
        </div>
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
import { nextRate, playWhenReady, type PlaybackRate } from '@/utils/playback';
import { cycleRateFor, rateFor, touchRate } from '@/composables/usePlaybackRates';
import { useScrub } from '@/composables/useScrub';

const props = defineProps<{ src: string; id?: string; poster?: string; embedded?: boolean; chromeHidden?: boolean; startAt?: number }>();
const emit = defineEmits<{ (e: 'tap'): void; (e: 'time', seconds: number): void }>();

const el = ref<HTMLVideoElement>();
const playing = ref(false);
const elapsed = ref(0);
const total = ref(0);
const progress = ref(0);
// (spec 2059) This clip's OWN speed, kept outside the component. The rate used to live in
// a local ref, so the media viewer tearing this player down on swipe silently threw the
// chosen speed away — you came back to 1x with no idea why.
const rate = computed(() => (props.id ? rateFor(props.id) : localRate.value));
// A player with no id (should not happen in the viewer, but the prop is optional) keeps the
// old component-local behaviour rather than sharing one anonymous entry with every other.
const localRate = ref<PlaybackRate>(1);
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
  const next = props.id ? cycleRateFor(props.id) : nextRate(localRate.value);
  if (!props.id) localRate.value = next;
  if (el.value) el.value.playbackRate = next;
}
function seekTo(ratio: number): void {
  const v = el.value;
  if (!v || !total.value) return;
  v.currentTime = Math.min(1, Math.max(0, ratio)) * total.value;
  onTime();
}
const scrub = useScrub(seekTo);

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
  const v = el.value;
  if (!v) return;
  if (Number.isFinite(v.duration)) total.value = v.duration;
  // Resume where we left off when this player remounts after being slid past
  // (spec 1007 FR-005). Only seek into a valid range.
  if (props.startAt && props.startAt > 0 && props.startAt < (total.value || Infinity)) {
    v.currentTime = props.startAt;
    onTime();
  }
  // (spec 2059) Restore the remembered SPEED too, not just the position. playbackRate used to
  // be written only when the pill was tapped, so a player rebuilt after a swipe would show
  // "1.5x" while actually playing at 1x — the pill right, the playback wrong.
  v.playbackRate = rate.value;
  if (props.id) touchRate(props.id);
}
function onTime(): void {
  const v = el.value;
  if (!v) return;
  elapsed.value = v.currentTime;
  progress.value = total.value ? Math.min(1, v.currentTime / total.value) : 0;
  emit('time', v.currentTime); // let the viewer remember the position across slides
}
function onEnd(): void {
  playing.value = false;
  progress.value = 0;
  elapsed.value = 0;
  if (el.value) el.value.currentTime = 0;
  emit('time', 0);
}
// Pause and silence this player (used when the viewer slides away from it so no
// off-screen video keeps playing audio in the background — FR-004).
function pauseSilent(): void {
  el.value?.pause();
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
defineExpose({ playing, elapsed, total, progress, rate, pipActive, toggle, pauseSilent, seekTo, cycleRate, togglePip, pipSupported });
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
  /* Fill the frame (letterboxed) so the poster matches photo presentation instead of sizing to the
     poster's intrinsic pixels — otherwise a small poster tier floats tiny in a large blank area. */
  width: 100%;
  height: 100%;
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
  /* Tall transparent hitbox so the thin rail is grabbable; touch-action:none
     keeps the browser from claiming the drag for scrolling (see useScrub). */
  height: 24px;
  display: flex;
  align-items: center;
  touch-action: none;
  cursor: pointer;
}
.vid-rail {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
}
.vid-prog {
  height: 100%;
  border-radius: 2px;
  background: var(--ion-color-primary);
}
</style>
