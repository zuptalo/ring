<template>
  <!-- Full-screen circular video-note recorder (WhatsApp-style). Starts recording as soon
       as it opens; the ring fills toward the max length. Tapping Stop ENDS the take and
       drops into a review state where you can watch it back, then Send or Retake — it is
       never sent without you tapping Send, and it never auto-sends at the max length. -->
  <div v-if="open" class="vn-overlay">
    <button class="vn-close" aria-label="Cancel" @click="cancel"><ion-icon :icon="close" /></button>
    <div class="vn-timer" :class="{ review: phase === 'review' }">{{ fmt(elapsed) }}</div>

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
      <!-- One element shows the LIVE camera while recording (muted, mirrored selfie) and the
           RECORDED clip while reviewing (with sound, un-mirrored — as the recipient sees it). -->
      <video
        ref="preview"
        class="vn-video"
        :class="{ mirror: facing === 'user' && phase !== 'review', hidden: phase !== 'review' && !ready }"
        :muted="phase !== 'review'"
        autoplay
        playsinline
        @timeupdate="onReviewTime"
        @ended="onReviewEnd"
        @play="reviewPlaying = true"
        @pause="reviewPlaying = false"
      ></video>
      <!-- Black overlay that fades to reveal the footage during the 3s countdown. -->
      <div class="vn-fade" :class="{ go: fading }"></div>
      <div v-if="countdown" class="vn-count">{{ countdown }}</div>
    </div>

    <button v-if="phase !== 'review'" class="vn-flip" aria-label="Flip camera" @click="flip">
      <ion-icon :icon="cameraReverseOutline" />
    </button>

    <div class="vn-bar">
      <!-- Review: Retake (discard + record again) · Play/Pause (watch it back) · Send. -->
      <template v-if="phase === 'review'">
        <button class="vn-btn" aria-label="Retake" @click="retake"><ion-icon :icon="refreshOutline" /></button>
        <button class="vn-btn" :aria-label="reviewPlaying ? 'Pause preview' : 'Play preview'" @click="toggleReview">
          <ion-icon :icon="reviewPlaying ? pause : play" />
        </button>
        <button class="vn-btn send" aria-label="Send" @click="send"><ion-icon :icon="sendOutline" /></button>
      </template>
      <!-- Recording/countdown: Cancel · Stop (red square) · spacer (keeps Stop centred). -->
      <template v-else>
        <button class="vn-btn" aria-label="Cancel" @click="cancel"><ion-icon :icon="trashOutline" /></button>
        <button class="vn-stop" aria-label="Stop recording" :disabled="phase !== 'recording'" @click="stopToReview">
          <span class="vn-stop-sq"></span>
        </button>
        <span class="vn-btn-spacer" aria-hidden="true"></span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { IonIcon } from '@ionic/vue';
import { close, cameraReverseOutline, trashOutline, sendOutline, play, pause, refreshOutline } from 'ionicons/icons';

const MAX = 60; // seconds
const CIRC = 2 * Math.PI * 48;

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'send', blob: Blob, dur: number, poster?: string): void; (e: 'cancel'): void }>();

type Phase = 'countdown' | 'recording' | 'review';
const phase = ref<Phase>('countdown');
const preview = ref<HTMLVideoElement>();
const elapsed = ref(0); // seconds: recording time while recording, the clip length while reviewing
const facing = ref<'user' | 'environment'>('user');
const countdown = ref<number | null>(null); // 3..1 before recording starts (null otherwise)
const fading = ref(false); // drives the black→footage fade during the countdown
const ready = ref(false); // first camera frame painted → safe to reveal the framed preview
const reviewPlaying = ref(false); // the recorded clip is currently playing back
const playPos = ref(0); // playback position (s) during review, for the ring
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let startMs = 0; // recording start (single continuous take — no pause)
let timer: number | undefined;
let countTimer: number | undefined;
// Review state: the finalized clip + its object URL (revoked on send/retake/teardown).
let reviewBlob: Blob | null = null;
let reviewUrl: string | null = null;
let reviewDur = 0;
let reviewPoster: string | undefined;

const progress = computed(() => {
  if (phase.value === 'review') return reviewDur ? Math.min(1, playPos.value / reviewDur) : 0;
  return Math.min(1, elapsed.value / MAX);
});
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

watch(
  () => props.open,
  (o) => {
    if (o) void start();
    else teardown();
  },
);

// Resolve once the <video> has an actual frame to show (or a short timeout), so the black
// cover can stay opaque over the brief scaled-down whole-frame render the camera paints
// before object-fit settles. Without this the countdown's fade-out races the camera and the
// glitch leaks through.
function firstFrame(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (v.readyState >= 2 && v.videoWidth > 0) {
      resolve();
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      v.removeEventListener('loadeddata', finish);
      v.removeEventListener('playing', finish);
      clearTimeout(to);
      resolve();
    };
    v.addEventListener('loadeddata', finish);
    v.addEventListener('playing', finish);
    const to = window.setTimeout(finish, 1500); // never hang if no frame event fires
  });
}

async function start(): Promise<void> {
  try {
    phase.value = 'countdown';
    ready.value = false;
    countdown.value = null;
    fading.value = false;
    elapsed.value = 0;
    playPos.value = 0;
    // Right-size for the in-chat circle (a ~200px round bubble, never fullscreen): a small,
    // squarish capture keeps files small with no visible loss at that size.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing.value,
        width: { ideal: 480 },
        height: { ideal: 480 },
        aspectRatio: { ideal: 1 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: true,
    });
    const v = preview.value;
    if (v) {
      v.src = ''; // drop any prior review clip
      v.srcObject = stream;
      await firstFrame(v); // hold the black cover over the scaled-down initial render
    }
    if (!stream) return; // closed (teardown) while awaiting the first frame
    ready.value = true;
    // Now the framed preview exists: run the 3-2-1 countdown, fading up from black.
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
  // Modest bitrate to match the small-circle capture — ~0.8 Mbps video is plenty for a
  // ~200px round bubble, keeping video messages small.
  recorder = new MediaRecorder(stream, {
    ...(mt ? { mimeType: mt } : {}),
    videoBitsPerSecond: 800_000,
    audioBitsPerSecond: 64_000,
  });
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  phase.value = 'recording';
  startMs = Date.now();
  elapsed.value = 0;
  timer = window.setInterval(() => {
    elapsed.value = (Date.now() - startMs) / 1000;
    // At the max length, STOP into review (never auto-send) — the user always decides.
    if (elapsed.value >= MAX) void stopToReview();
  }, 100);
}

// Grab a still from the LIVE preview as a thumbnail — reliable (we always have real frames
// here), unlike decoding the recorded blob, which can fail on some devices. drawImage reads
// the raw frame (the CSS mirror doesn't apply), so it matches the recorded, un-mirrored video.
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

// End recording and drop into review: finalize the clip, release the camera, and play it
// back so the user can watch before deciding to Send or Retake.
async function stopToReview(): Promise<void> {
  if (phase.value !== 'recording' || !recorder) return;
  reviewPoster = capturePoster(); // capture while the live camera frame is still showing
  reviewDur = Math.max(1, Math.round(elapsed.value));
  if (timer) clearInterval(timer);
  timer = undefined;
  const rec = recorder;
  const mime = rec.mimeType || 'video/webm';
  const blob: Blob = await new Promise((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: mime }));
    rec.stop();
  });
  recorder = null;
  stream?.getTracks().forEach((t) => t.stop()); // stop the camera; we have the clip now
  stream = null;
  reviewBlob = blob;
  reviewUrl = URL.createObjectURL(blob);
  elapsed.value = reviewDur; // the timer now shows the clip length
  playPos.value = 0;
  phase.value = 'review';
  const v = preview.value;
  if (v) {
    v.srcObject = null;
    v.src = reviewUrl;
    v.loop = false;
    v.currentTime = 0;
    void v.play().catch(() => {
      /* autoplay-with-sound may be blocked when reached via the max-length stop (no
         gesture); the user can tap Play. */
    });
  }
}

function onReviewTime(): void {
  if (phase.value === 'review' && preview.value) playPos.value = preview.value.currentTime;
}
function onReviewEnd(): void {
  reviewPlaying.value = false;
  if (phase.value === 'review') playPos.value = reviewDur; // leave the ring full
}

// Watch the clip back: play, pause, or replay from the start once it has ended.
function toggleReview(): void {
  const v = preview.value;
  if (!v) return;
  if (v.paused || v.ended) {
    if (v.ended) v.currentTime = 0;
    void v.play().catch(() => {});
  } else {
    v.pause();
  }
}

function send(): void {
  if (!reviewBlob) return;
  const blob = reviewBlob;
  const dur = reviewDur;
  const poster = reviewPoster;
  releaseReview();
  emit('send', blob, dur, poster);
}

// Discard the reviewed clip and record again from scratch.
async function retake(): Promise<void> {
  releaseReview();
  teardown();
  await start();
}

function releaseReview(): void {
  if (reviewUrl) {
    URL.revokeObjectURL(reviewUrl);
    reviewUrl = null;
  }
  reviewBlob = null;
  reviewPoster = undefined;
  reviewDur = 0;
  reviewPlaying.value = false;
}

function teardown(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (countTimer) clearInterval(countTimer);
  countTimer = undefined;
  countdown.value = null;
  fading.value = false;
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch {
    /* ignore */
  }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  releaseReview();
  const v = preview.value;
  if (v) {
    v.srcObject = null;
    v.src = '';
  }
  ready.value = false;
  phase.value = 'countdown';
  elapsed.value = 0;
  playPos.value = 0;
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
/* Reviewing is not recording — drop the red so the timer reads as a clip length, not a
   live recording indicator. */
.vn-timer.review {
  background: rgba(0, 0, 0, 0.45);
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
/* Keep the preview invisible until the first real frame, so the brief scaled-down whole-
   frame render the camera paints on open is never seen (the black cover sits over it too). */
.vn-video.hidden {
  opacity: 0;
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
  display: flex;
  align-items: center;
  justify-content: center;
}
.vn-btn.send {
  background: var(--ion-color-primary);
}
/* A no-op slot the same size as a button so the centred Stop stays centred. */
.vn-btn-spacer {
  width: 52px;
  height: 52px;
}
/* Stop control: a circular button with a red square (the universal stop glyph). Disabled
   during the countdown (nothing to stop yet). */
.vn-stop {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.vn-stop:disabled {
  opacity: 0.45;
  cursor: default;
}
.vn-stop-sq {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: #ef4444;
  animation: vn-pulse 1.2s ease-in-out infinite;
}
.vn-stop:disabled .vn-stop-sq {
  animation: none;
}
@keyframes vn-pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
