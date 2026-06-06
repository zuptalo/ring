<template>
  <!-- Voice message player: play/pause + a real waveform (decoded from the audio)
       that fills as it plays and is seekable, with elapsed/total time and the
       sender's avatar + mic badge. -->
  <div class="vp" :class="{ out: outgoing }">
    <button type="button" class="vp-play" :aria-label="playing ? 'Pause' : 'Play'" @click.stop="toggle">
      <ion-icon :icon="playing ? pause : play" />
    </button>

    <div ref="waveEl" class="vp-wave" @click.stop="seek">
      <span
        v-for="(h, i) in bars"
        :key="i"
        class="vp-bar"
        :class="{ played: (i + 0.5) / bars.length <= progress }"
        :style="{ height: barHeight(h) }"
      />
    </div>

    <span class="vp-time">{{ timeLabel }}</span>

    <div v-if="avatar" class="vp-avatar">
      <img :src="avatar" alt="" />
      <span class="vp-mic"><ion-icon :icon="mic" /></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play, pause, mic } from 'ionicons/icons';

const props = defineProps<{
  src: string;
  outgoing: boolean;
  avatar?: string;
  durationSec?: number;
}>();

const BAR_COUNT = 44;
// Flat placeholder until decoded (and the fallback if decoding isn't supported).
const bars = ref<number[]>(Array.from({ length: BAR_COUNT }, () => 0.25));
const playing = ref(false);
const progress = ref(0); // 0..1
const total = ref(props.durationSec ?? 0);
const elapsed = ref(0);

const audio = new Audio(props.src);
audio.preload = 'metadata';

const barHeight = (h: number) => `${Math.round(3 + h * 17)}px`;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const timeLabel = computed(() => fmt(playing.value || elapsed.value ? elapsed.value : total.value));

// One shared AudioContext for decoding all voice messages.
let sharedCtx: AudioContext | null = null;
function ctx(): AudioContext {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return (sharedCtx ??= new AC());
}

async function decodeWaveform(): Promise<void> {
  try {
    const buf = await (await fetch(props.src)).arrayBuffer();
    const audioBuf = await ctx().decodeAudioData(buf);
    if (audioBuf.duration) total.value = audioBuf.duration;
    const data = audioBuf.getChannelData(0);
    const bucket = Math.floor(data.length / BAR_COUNT) || 1;
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < BAR_COUNT; i++) {
      let peak = 0;
      const start = i * bucket;
      for (let j = 0; j < bucket; j++) peak = Math.max(peak, Math.abs(data[start + j] || 0));
      peaks.push(peak);
      max = Math.max(max, peak);
    }
    // Normalize so the loudest bar is full height; keep a floor so silence still
    // shows a sliver.
    bars.value = peaks.map((p) => (max > 0 ? Math.max(0.08, p / max) : 0.25));
  } catch {
    /* decoding unsupported for this codec → keep the flat placeholder */
  }
}

function onTime(): void {
  elapsed.value = audio.currentTime;
  progress.value = total.value ? Math.min(1, audio.currentTime / total.value) : 0;
}
function onEnded(): void {
  playing.value = false;
  progress.value = 0;
  elapsed.value = 0;
  audio.currentTime = 0;
}

function toggle(): void {
  if (playing.value) {
    audio.pause();
    playing.value = false;
  } else {
    void audio.play();
    playing.value = true;
  }
}

const waveEl = ref<HTMLElement>();
function seek(ev: MouseEvent): void {
  const el = waveEl.value;
  if (!el || !total.value) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * total.value;
  onTime();
}

onMounted(() => {
  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) total.value = audio.duration;
  });
  void decodeWaveform();
});
onBeforeUnmount(() => {
  audio.pause();
  audio.removeEventListener('timeupdate', onTime);
  audio.removeEventListener('ended', onEnded);
});
</script>

<style scoped>
.vp {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
  padding: 2px 0;
}
.vp-play {
  flex: none;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
}
.vp-wave {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  cursor: pointer;
  min-width: 100px;
}
.vp-bar {
  flex: 1;
  min-width: 2px;
  border-radius: 1px;
  background: var(--app-text-muted, #8e8e93);
  opacity: 0.45;
}
.vp-bar.played {
  background: var(--ion-color-primary);
  opacity: 1;
}
.vp-time {
  flex: none;
  font-size: 12px;
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
}
.vp-avatar {
  position: relative;
  flex: none;
  width: 34px;
  height: 34px;
}
.vp-avatar img {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
}
.vp-mic {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--ion-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
}
</style>
