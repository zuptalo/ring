<template>
  <!-- Full-screen circular video-note recorder (WhatsApp-style). Starts recording
       as soon as it opens; the ring fills toward the max length. -->
  <div v-if="open" class="vn-overlay">
    <button class="vn-close" aria-label="Cancel" @click="cancel"><ion-icon :icon="close" /></button>
    <div class="vn-timer">{{ fmt(elapsed) }}</div>

    <div class="vn-stage">
      <svg class="vn-ring" viewBox="0 0 100 100">
        <circle class="vn-ring-bg" cx="50" cy="50" r="48" />
        <circle
          class="vn-ring-fg"
          cx="50"
          cy="50"
          r="48"
          :stroke-dasharray="CIRC"
          :stroke-dashoffset="CIRC * (1 - progress)"
        />
      </svg>
      <video ref="preview" class="vn-video" :class="{ mirror: facing === 'user' }" autoplay muted playsinline></video>
      <!-- Black overlay that fades to reveal the footage during the 3s countdown. -->
      <div class="vn-fade" :class="{ go: fading }"></div>
      <div v-if="countdown" class="vn-count">{{ countdown }}</div>
    </div>

    <button class="vn-flip" aria-label="Flip camera" @click="flip"><ion-icon :icon="cameraReverseOutline" /></button>

    <div class="vn-bar">
      <button class="vn-btn" aria-label="Delete" @click="cancel"><ion-icon :icon="trashOutline" /></button>
      <!-- Pause/resume the take. The recording cue (red square) is folded INTO this control:
           it's the red live indicator while recording (tap to pause) and a resume ▶ when paused. -->
      <button
        class="vn-pause"
        :class="{ paused }"
        :aria-label="paused ? 'Resume recording' : 'Pause recording'"
        @click="togglePause"
      >
        <ion-icon v-if="paused" :icon="play" />
        <span v-else class="vn-pause-rec"></span>
      </button>
      <button class="vn-btn send" aria-label="Send" @click="stopAndSend"><ion-icon :icon="sendOutline" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { IonIcon } from '@ionic/vue';
import { close, cameraReverseOutline, trashOutline, sendOutline, play } from 'ionicons/icons';
import { recordedMs } from '@/utils/rec-clock';

const MAX = 60; // seconds
const CIRC = 2 * Math.PI * 48;

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'send', blob: Blob, dur: number, poster?: string): void; (e: 'cancel'): void }>();

const preview = ref<HTMLVideoElement>();
const elapsed = ref(0);
const facing = ref<'user' | 'environment'>('user');
const countdown = ref<number | null>(null); // 3..1 before recording starts (null = recording)
const fading = ref(false); // drives the black→footage fade during the countdown
const paused = ref(false); // recording paused (tap the control to resume the same take)
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
// Recorded-time accounting (mirrors the voice recorder): `accumMs` banks time from
// completed segments, `segStartMs` marks the current segment's start. Elapsed/duration
// are derived via recordedMs() so a paused gap is never counted (replaces a raw startMs).
let accumMs = 0;
let segStartMs = 0;
let timer: number | undefined;
let countTimer: number | undefined;

const progress = computed(() => Math.min(1, elapsed.value / MAX));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

watch(
  () => props.open,
  (o) => {
    if (o) void start();
    else teardown();
  },
);

async function start(): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing.value }, audio: true });
    if (preview.value) preview.value.srcObject = stream;
    // 3-2-1 countdown with the preview fading up from black, THEN begin recording.
    countdown.value = 3;
    fading.value = false;
    requestAnimationFrame(() => (fading.value = true)); // trigger the CSS fade-out
    countTimer = window.setInterval(() => {
      const next = (countdown.value ?? 1) - 1;
      if (next <= 0) {
        if (countTimer) clearInterval(countTimer);
        countTimer = undefined;
        countdown.value = null;
        beginRecording();
      } else {
        countdown.value = next;
      }
    }, 1000);
  } catch {
    emit('cancel'); // no camera/mic access
  }
}

function beginRecording(): void {
  if (!stream) return;
  const types = ['video/webm', 'video/mp4'];
  const mt = types.find((t) => MediaRecorder.isTypeSupported?.(t));
  recorder = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  accumMs = 0;
  segStartMs = Date.now();
  paused.value = false;
  elapsed.value = 0;
  timer = window.setInterval(() => {
    // Drive the timer (and thus the progress ring) from RECORDED time, so it freezes while
    // paused and the max-length auto-finalize never fires on a paused recording.
    elapsed.value = recordedMs({ accumMs, segStartMs, paused: paused.value }, Date.now()) / 1000;
    if (elapsed.value >= MAX) void stopAndSend();
  }, 100);
}

// Pause/resume the SAME take: bank the current segment and pause, or start a fresh segment
// and resume. No-op during the 3-2-1 countdown (no recorder yet) or once stopped.
function togglePause(): void {
  if (!recorder || recorder.state === 'inactive') return;
  if (paused.value) {
    segStartMs = Date.now();
    recorder.resume();
    paused.value = false;
  } else {
    accumMs += Date.now() - segStartMs;
    recorder.pause();
    paused.value = true;
  }
}

function teardown(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (countTimer) clearInterval(countTimer);
  countTimer = undefined;
  countdown.value = null;
  fading.value = false;
  try {
    if (recorder && recorder.state !== 'inactive') {
      // Resume a paused recorder before stopping so it finalizes and releases cleanly.
      if (recorder.state === 'paused') recorder.resume();
      recorder.stop();
    }
  } catch {
    /* ignore */
  }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  paused.value = false;
  accumMs = 0;
  segStartMs = 0;
}

// Grab a still from the live preview as a thumbnail — reliable (we always have real
// frames here), unlike decoding the recorded blob, which can fail on some devices.
// drawImage reads the raw frame (the CSS mirror doesn't apply), so it matches the
// recorded, un-mirrored video.
function capturePoster(): string | undefined {
  const v = preview.value;
  if (!v || !v.videoWidth) return undefined;
  try {
    const maxEdge = 320;
    const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * scale));
    const cx = c.getContext('2d');
    if (!cx) return undefined;
    cx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  } catch {
    return undefined;
  }
}

async function stopAndSend(): Promise<void> {
  if (!recorder) return;
  // Duration is the RECORDED time (excludes paused gaps), computed before we resume below.
  const dur = Math.max(1, Math.round(recordedMs({ accumMs, segStartMs, paused: paused.value }, Date.now()) / 1000));
  const poster = capturePoster(); // capture while the preview stream is still live
  const rec = recorder;
  const mime = rec.mimeType || 'video/webm';
  if (timer) clearInterval(timer);
  timer = undefined;
  // Some browsers won't fire dataavailable/onstop cleanly while paused — resume first.
  if (paused.value) {
    try {
      rec.resume();
    } catch {
      /* ignore */
    }
    paused.value = false;
  }
  const blob: Blob = await new Promise((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: mime }));
    rec.stop();
  });
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  emit('send', blob, dur, poster);
}

function cancel(): void {
  teardown();
  emit('cancel');
}

async function flip(): Promise<void> {
  facing.value = facing.value === 'user' ? 'environment' : 'user';
  teardown(); // restart with the other camera (current take is discarded)
  await start();
}

onBeforeUnmount(teardown);
</script>

<style scoped>
.vn-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #1b1b1b;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.vn-close {
  position: absolute;
  top: max(env(safe-area-inset-top), 16px);
  left: 16px;
  background: none;
  border: none;
  color: #fff;
  font-size: 28px;
  cursor: pointer;
}
.vn-timer {
  margin-top: max(env(safe-area-inset-top), 16px);
  background: #ef4444;
  color: #fff;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 4px 12px;
  border-radius: 8px;
}
.vn-stage {
  position: relative;
  margin: auto;
  width: 76vw;
  max-width: 320px;
  aspect-ratio: 1;
}
.vn-ring {
  position: absolute;
  inset: -6px;
  width: calc(100% + 12px);
  height: calc(100% + 12px);
  transform: rotate(-90deg);
}
.vn-ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 2;
}
.vn-ring-fg {
  fill: none;
  stroke: #fff;
  stroke-width: 2.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear;
}
.vn-video {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: #000;
}
/* Mirror the front (selfie) camera preview so it behaves like a mirror. */
.vn-video.mirror {
  transform: scaleX(-1);
}
/* Countdown: a black disc over the preview that fades out over the 3s, revealing the
   footage, with the count drawn on top. */
.vn-fade {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #000;
  opacity: 1;
  pointer-events: none;
  transition: opacity 3s linear;
}
.vn-fade.go {
  opacity: 0;
}
.vn-count {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-size: 76px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}
.vn-flip {
  position: absolute;
  left: 20px;
  bottom: 120px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: 22px;
  cursor: pointer;
}
.vn-bar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px max(env(safe-area-inset-bottom), 24px);
}
.vn-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 24px;
  cursor: pointer;
}
.vn-btn.send {
  background: var(--ion-color-primary);
}
/* Pause/resume control. Same circular footprint as the delete/send buttons; the red
   recording indicator is folded in (the inner square) and swaps to a resume glyph when
   paused, so one element both shows state and is the tap target. */
.vn-pause {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.vn-pause.paused {
  background: rgba(255, 255, 255, 0.18);
}
.vn-pause ion-icon {
  font-size: 26px;
}
/* The live red square (the former recording dot), pulsing while actively recording. */
.vn-pause-rec {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: #ef4444;
  animation: vn-pulse 1.2s ease-in-out infinite;
}
@keyframes vn-pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
