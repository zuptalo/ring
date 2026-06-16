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
    </div>

    <button class="vn-flip" aria-label="Flip camera" @click="flip"><ion-icon :icon="cameraReverseOutline" /></button>

    <div class="vn-bar">
      <button class="vn-btn" aria-label="Delete" @click="cancel"><ion-icon :icon="trashOutline" /></button>
      <span class="vn-recdot"></span>
      <button class="vn-btn send" aria-label="Send" @click="stopAndSend"><ion-icon :icon="sendOutline" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { IonIcon } from '@ionic/vue';
import { close, cameraReverseOutline, trashOutline, sendOutline } from 'ionicons/icons';

const MAX = 60; // seconds
const CIRC = 2 * Math.PI * 48;

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'send', blob: Blob, dur: number, poster?: string): void; (e: 'cancel'): void }>();

const preview = ref<HTMLVideoElement>();
const elapsed = ref(0);
const facing = ref<'user' | 'environment'>('user');
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let startMs = 0;
let timer: number | undefined;

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
    const types = ['video/webm', 'video/mp4'];
    const mt = types.find((t) => MediaRecorder.isTypeSupported?.(t));
    recorder = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start();
    startMs = Date.now();
    elapsed.value = 0;
    timer = window.setInterval(() => {
      elapsed.value = (Date.now() - startMs) / 1000;
      if (elapsed.value >= MAX) void stopAndSend();
    }, 100);
  } catch {
    emit('cancel'); // no camera/mic access
  }
}

function teardown(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch {
    /* ignore */
  }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
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
  const dur = Math.max(1, Math.round(elapsed.value));
  const poster = capturePoster(); // capture while the preview stream is still live
  const rec = recorder;
  const mime = rec.mimeType || 'video/webm';
  if (timer) clearInterval(timer);
  timer = undefined;
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
.vn-recdot {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: #ef4444;
}
</style>
