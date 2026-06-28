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

    <speed-pill :rate="rate" @cycle="cycleRate" />

    <div v-if="avatar" class="vp-avatar">
      <img :src="avatar" alt="" />
      <span class="vp-mic"><ion-icon :icon="mic" /></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { play, pause, mic } from 'ionicons/icons';
import SpeedPill from '@/components/SpeedPill.vue';
import {
  audioCurId, audioPlaying, audioProgress, audioRate,
  playAudio, seekAudioFrac, cycleAudioRate,
} from '@/composables/useAudioPlayer';

const props = defineProps<{
  mid: string; // message id — this voice message's id in the global player
  chatId?: string; // owning chat — lets the hovering controller hide while we're in it
  sender: string; // who it's from (shown in the hovering controller)
  src: string;
  outgoing: boolean;
  avatar?: string;
  durationSec?: number;
}>();

const BAR_COUNT = 44;
// Flat placeholder until decoded (and the fallback if decoding isn't supported).
const bars = ref<number[]>(Array.from({ length: BAR_COUNT }, () => 0.25));
const total = ref(props.durationSec ?? 0);

// Playback runs through the global single-source player; this view just reflects it
// when this voice message is the active one (so audio persists across navigation and
// only one source ever plays — spec 1007).
const isActive = computed(() => audioCurId.value === props.mid);
const playing = computed(() => isActive.value && audioPlaying.value);
const progress = computed(() => (isActive.value ? audioProgress.value : 0)); // 0..1
const elapsed = computed(() => progress.value * total.value);
const rate = computed(() => audioRate.value);

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

// Play this voice message (or toggle it if it's already the active one) through the
// global player, which replaces any other audio and keeps playing across navigation.
function toggle(): void {
  playAudio({ id: props.mid, url: props.src, title: 'Voice message', subtitle: props.sender, isVoice: true, chatId: props.chatId });
}
function cycleRate(): void {
  cycleAudioRate();
}

const waveEl = ref<HTMLElement>();
function seek(ev: MouseEvent): void {
  const el = waveEl.value;
  if (!el || !total.value || !isActive.value) return;
  const rect = el.getBoundingClientRect();
  seekAudioFrac(Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)));
}

onMounted(() => {
  void decodeWaveform();
});
</script>

<style scoped>
.vp {
  display: flex;
  align-items: center;
  gap: 10px;
  /* Shrink to fit the bubble on narrow phones (Galaxy S25 ~360px): a hard min-width
     plus the fixed-width play/time/avatar children used to overflow the bubble and
     spill outside the chat frame. max-width:100% caps it; the flexible waveform
     (.vp-wave, min-width:0) absorbs the slack. */
  min-width: 0;
  max-width: 100%;
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
  /* min-width:0 (not 100px) so the waveform can shrink below its content on a narrow
     bubble instead of forcing the whole row wider than the chat frame. */
  min-width: 0;
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
