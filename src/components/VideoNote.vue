<template>
  <!-- Round video-note bubble: tap to play (with sound); a ring shows progress and
       it shows the first-frame thumbnail until played. The action menu opens from the
       footer below (handled by the parent bubble). -->
  <div class="vnp" @click.stop="onClick">
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
      <ion-icon :icon="playing && !muted ? volumeHigh : volumeMute" />
      {{ fmt(playing ? Math.max(0, total - elapsed) : total) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play, volumeHigh, volumeMute } from 'ionicons/icons';
import { getSetting, setSetting } from '@/db/queries';

const props = defineProps<{ src: string; mid?: string; durationSec?: number; poster?: string }>();

const CIRC = 2 * Math.PI * 48;
const el = ref<HTMLVideoElement>();
const playing = ref(false);
const muted = ref(false);
const elapsed = ref(0);
const total = ref(props.durationSec ?? 0);
const progress = computed(() => (total.value ? Math.min(1, elapsed.value / total.value) : 0));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Auto-play sequence: when the note first comes into view it plays 3 times — once
// with audio, then twice muted — then stops; after that, playback is manual (tap).
const AUTO_CYCLES = 3;
let started = false; // the auto sequence has begun for this note (only once)
let autoActive = false; // currently running the auto sequence
let autoCount = 0; // auto cycles completed

function playEl(wantMuted: boolean): void {
  const v = el.value;
  if (!v) return;
  v.muted = wantMuted;
  muted.value = wantMuted;
  playing.value = true;
  void v.play().catch(() => {
    // Autoplay WITH audio is blocked without a user gesture on some platforms; retry
    // muted so the note still plays (the user can tap for sound).
    if (!v.muted) {
      v.muted = true;
      muted.value = true;
      void v.play().catch(() => (playing.value = false));
    } else {
      playing.value = false;
    }
  });
}

// Remember which notes have used up their 3 auto-plays, so they only show the
// thumbnail on later views (no more autoplay), persisted across remounts/sessions.
const AUTOPLAYED_KEY = 'vnAutoplayed';
async function markAutoplayed(): Promise<void> {
  if (!props.mid) return;
  try {
    const done = await getSetting<Record<string, boolean>>(AUTOPLAYED_KEY, {});
    done[props.mid] = true;
    await setSetting(AUTOPLAYED_KEY, done);
  } catch {
    /* best-effort */
  }
}

function startAuto(): void {
  if (started) return;
  started = true;
  autoActive = true;
  autoCount = 0;
  playEl(true); // always start muted — tap for sound
}

// A tap plays/pauses with audio; any manual interaction ends the auto sequence.
function onClick(): void {
  const v = el.value;
  if (!v) return;
  autoActive = false;
  started = true;
  if (v.paused) playEl(false);
  else {
    v.pause();
    playing.value = false;
  }
}
function onMeta(): void {
  if (el.value && Number.isFinite(el.value.duration) && el.value.duration > 0) total.value = el.value.duration;
}
function onTime(): void {
  if (el.value) elapsed.value = el.value.currentTime;
}
function onEnd(): void {
  elapsed.value = 0;
  if (el.value) el.value.currentTime = 0;
  if (autoActive) {
    autoCount += 1;
    if (autoCount >= AUTO_CYCLES) {
      autoActive = false;
      playing.value = false; // done → show the thumbnail; further plays are manual
      void markAutoplayed(); // and never autoplay this note again
    } else {
      playEl(true); // all auto cycles are muted
    }
  } else {
    playing.value = false;
  }
}

// Kick off the auto sequence the first time the note scrolls into view — unless this
// note has already used up its 3 auto-plays before, in which case just show the
// thumbnail and don't autoplay at all.
let io: IntersectionObserver | undefined;
onMounted(async () => {
  const v = el.value;
  if (!v) return;
  try {
    const done = await getSetting<Record<string, boolean>>(AUTOPLAYED_KEY, {});
    if (props.mid && done[props.mid]) {
      started = true; // already auto-played 3× → thumbnail only
      return;
    }
  } catch {
    /* fall through to normal autoplay */
  }
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting && !started) startAuto();
    },
    { threshold: 0.6 },
  );
  io.observe(v);
});
onBeforeUnmount(() => {
  io?.disconnect();
  el.value?.pause();
});
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
