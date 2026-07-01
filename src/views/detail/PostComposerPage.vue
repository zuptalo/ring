<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/wall" />
        </ion-buttons>
        <ion-title>New post</ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" :disabled="!canShare || sharing || recording" @click="share">Share</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-textarea
        v-enter-send="share"
        class="composer"
        :auto-grow="true"
        :rows="3"
        :placeholder="mediaItems.length ? 'Add a caption…' : 'Share something with your friends…'"
        autocapitalize="sentences"
        :spellcheck="true"
        dir="auto"
        :value="body"
        @ion-input="onInput"
      />

      <!-- Media staging (FR-019): photos, videos AND voice clips compose ONE post as a row of
           reorderable thumbnails (their order is the album order). Voice mixes in like any other
           item — record it and it joins the row; tap its ▶ to review it through the same player
           the chat and feed use. -->
      <div v-if="mediaItems.length" ref="stageRow" class="album-stage">
        <div
          v-for="(m, i) in mediaItems"
          :key="m.url"
          class="stage-thumb"
          :class="{ dragging: dragIndex === i }"
          @touchstart.passive="onThumbTouchStart(i, $event)"
        >
          <button v-if="m.kind === 'voice'" type="button" class="stage-voice" @click="previewVoice(m)">
            <ion-icon :icon="micOutline" />
            <span>{{ fmtDur(m.durationSec) }}</span>
            <ion-icon class="stage-play" :icon="playCircle" aria-hidden="true" />
          </button>
          <template v-else>
            <img v-if="m.kind === 'image' || m.poster" :src="m.kind === 'image' ? m.url : m.poster" alt="" />
            <div v-else class="stage-vid">
              <ion-spinner v-if="!m.posterTried" name="crescent" class="stage-spin" />
            </div>
            <ion-icon v-if="m.kind === 'video'" class="stage-play" :icon="playCircle" aria-hidden="true" />
          </template>
          <button type="button" class="stage-x" aria-label="Remove" @click="removeMedia(i)">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
        <button type="button" class="stage-add" aria-label="Add more photos or videos" :disabled="atMaxMedia" @click="pickMedia">
          <ion-icon :icon="imageOutline" />
        </button>
        <button type="button" class="stage-add" aria-label="Record a voice clip" :disabled="recording || atMaxMedia" @click="startRecording">
          <ion-icon :icon="micOutline" />
        </button>
      </div>
      <p v-if="mediaItems.length > 1" class="stage-hint">
        Hold &amp; drag a thumbnail to reorder.<span v-if="atMaxMedia"> · {{ MAX_MEDIA }}-item max reached</span>
      </p>

      <!-- Recording in progress — can be the first item or added to an existing album. -->
      <ion-list v-if="recording" :inset="true">
        <ion-item lines="none">
          <ion-icon slot="start" :icon="micOutline" color="danger" class="recdot" />
          <ion-label>Recording… {{ recElapsed }}</ion-label>
          <ion-button slot="end" fill="solid" color="danger" @click="stopRecording">Stop</ion-button>
        </ion-item>
      </ion-list>

      <!-- First-attachment options: only when nothing is staged yet and not already recording. -->
      <ion-list v-if="!mediaItems.length && !recording" :inset="true">
        <ion-item button :detail="false" @click="pickMedia">
          <ion-icon slot="start" :icon="imageOutline" color="primary" />
          <ion-label color="primary">Add photos or videos</ion-label>
        </ion-item>
        <ion-item button :detail="false" @click="startRecording">
          <ion-icon slot="start" :icon="micOutline" color="primary" />
          <ion-label color="primary">Record voice</ion-label>
        </ion-item>
      </ion-list>
      <input
        ref="fileInput"
        type="file"
        accept="image/*,video/*"
        multiple
        style="display: none"
        @change="onFile"
      />

      <ion-list :inset="true">
        <ion-list-header>Who can see this</ion-list-header>
        <ion-item lines="none">
          <ion-segment :value="audience" @ion-change="onAudience">
            <ion-segment-button value="friends"><ion-label>All friends</ion-label></ion-segment-button>
            <ion-segment-button value="close"><ion-label>Close friends</ion-label></ion-segment-button>
          </ion-segment>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-list-header>Disappears after</ion-list-header>
        <ion-item lines="none">
          <ion-segment :value="lifetime" @ion-change="onLifetime">
            <ion-segment-button value="1h"><ion-label>1 hour</ion-label></ion-segment-button>
            <ion-segment-button value="24h"><ion-label>24 hours</ion-label></ion-segment-button>
            <ion-segment-button value="72h"><ion-label>72 hours</ion-label></ion-segment-button>
          </ion-segment>
        </ion-item>
      </ion-list>

      <p class="hint">
        Your post is end to end encrypted and only the audience you pick can see it, never the
        server or the wider network. It disappears after the time you choose once there is no new
        activity, and a fresh reaction or comment keeps it around a little longer.
      </p>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonTextarea, IonList, IonListHeader, IonItem, IonSegment, IonSegmentButton,
  IonLabel, IonIcon, IonSpinner, alertController,
} from '@ionic/vue';
import { useRouter, useRoute } from 'vue-router';
import { imageOutline, closeOutline, micOutline, playCircle } from 'ionicons/icons';
import { vEnterSend } from '@/directives/enter-send';
import { enqueuePendingPost, getPendingPost, deletePendingPost, type PostLifetime } from '@/db/queries';
import { kickPendingPosts } from '@/services/pending-posts';
import { hasRoomFor } from '@/services/storage-estimate';
import { generateVideoPoster } from '@/utils/media-meta';
import { playAudio, stopIfPlaying } from '@/composables/useAudioPlayer';
import { appToast } from '@/services/toast';

const router = useRouter();
const route = useRoute();
const body = ref('');
const audience = ref<'friends' | 'close'>('friends');
const lifetime = ref<PostLifetime>('72h');
const sharing = ref(false); // true only during the brief enqueue, before the composer dismisses
// Set when we're finishing a draft recovered after the app closed mid-post (?resume=<outbox id>):
// the old record is removed once the post is re-shared so it doesn't linger on the Wall.
const resumeId = ref<string | null>(null);

// Staged attachments. Several photos/videos compose an ALBUM post (spec 1022, FR-019); a
// recorded voice clip is always on its own. Object URLs back the previews, revoked on
// remove/unmount. `kind` is explicit (a recorded Blob has no filename to derive it from).
interface PostMedia {
  blob: Blob;
  kind: 'image' | 'video' | 'voice';
  name: string;
  durationSec?: number;
  url: string;
  poster?: string; // first-frame thumbnail for a staged video (a <video> tile paints black)
  posterTried?: boolean; // poster generation has settled (succeeded or given up) — stop the spinner
}
const fileInput = ref<HTMLInputElement | null>(null);
const mediaItems = ref<PostMedia[]>([]);
// Cap items per post (photos + videos + voice clips combined). Keeps the album swipe + the
// upload manageable, and bounds the encode/upload work.
const MAX_MEDIA = 10;
const atMaxMedia = computed(() => mediaItems.value.length >= MAX_MEDIA);

const canShare = computed(() => body.value.trim().length > 0 || mediaItems.value.length > 0);

// mm:ss for a staged voice clip's thumbnail.
const fmtDur = (s?: number): string => {
  const n = Math.round(s ?? 0);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
// Review a staged clip through the SAME single-source player the chat + feed use (so the
// minimized controller behaves identically and only one thing ever plays).
function previewVoice(m: PostMedia): void {
  playAudio({ id: m.url, url: m.url, title: 'Voice clip', subtitle: 'Your recording', isVoice: true });
}

function onInput(e: CustomEvent): void {
  body.value = (e.detail as { value?: string | null }).value ?? '';
}
function onAudience(e: CustomEvent): void {
  audience.value = ((e.detail as { value?: string }).value as 'friends' | 'close') ?? 'friends';
}
function onLifetime(e: CustomEvent): void {
  lifetime.value = ((e.detail as { value?: string }).value as PostLifetime) ?? '72h';
}

function pickMedia(): void {
  fileInput.value?.click();
}
async function onFile(e: Event): Promise<void> {
  // Picking several photos/videos stages them all → one album on Send. Voice clips mix in as
  // their own items now, so we just APPEND — never clear what's already staged. Cap at MAX_MEDIA.
  const picked = Array.from((e.target as HTMLInputElement).files ?? []);
  const room = MAX_MEDIA - mediaItems.value.length;
  const files = picked.slice(0, Math.max(0, room));
  if (fileInput.value) fileInput.value.value = '';
  if (picked.length > files.length) {
    void appToast(`You can share up to ${MAX_MEDIA} items in one post.`);
  }
  // Spec 1024 (US3): the outbox caches these blobs plaintext until the upload confirms. Refuse the
  // pick up front if the device clearly can't stage them, so we fail loudly here instead of mid-upload.
  const incoming = files.reduce((n, f) => n + f.size, 0);
  if (!(await hasRoomFor(incoming))) {
    void appToast('Not enough storage on this device. Free up space and try again.');
    return;
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const kind = f.type.startsWith('video/') ? 'video' : 'image';
    mediaItems.value.push({ blob: f, kind, name: f.name || 'attachment', url });
    // A <video> tile paints black until it seeks — generate a first-frame poster and drop it
    // onto the (reactive) staged item so the preview shows a real thumbnail. Match by url since
    // the index can shift if another item is removed while this resolves.
    if (kind === 'video') {
      void generateVideoPoster(f)
        .then((poster) => {
          const it = mediaItems.value.find((m) => m.url === url);
          if (it && poster) it.poster = poster;
        })
        .catch(() => {})
        .finally(() => {
          const it = mediaItems.value.find((m) => m.url === url);
          if (it) it.posterTried = true; // stop the spinner whether or not we got a frame
        });
    }
  }
}
function removeMedia(i: number): void {
  const [gone] = mediaItems.value.splice(i, 1);
  if (gone) {
    stopIfPlaying(gone.url); // dismiss the player if we're previewing this clip
    URL.revokeObjectURL(gone.url);
  }
}
function clearMedia(): void {
  for (const m of mediaItems.value) {
    stopIfPlaying(m.url);
    URL.revokeObjectURL(m.url);
  }
  mediaItems.value = [];
  if (fileInput.value) fileInput.value.value = '';
}

/* ---- press-and-hold to reorder the staged album ----
   The row scrolls natively (smooth, with momentum) — we never touch that. A press-and-hold on
   a thumbnail "lifts" it; only THEN do we take over the gesture (preventDefault) and reorder
   live as the finger passes its neighbours. A swipe that moves before the hold fires cancels
   the lift, so it just scrolls. Touch events (not pointer) + a non-passive document listener,
   which is what actually works on iOS. */
const stageRow = ref<HTMLElement | null>(null);
const dragIndex = ref<number | null>(null);
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let touchId: number | null = null;
let downX = 0;
let downY = 0;
let lifted = false;

function thumbAt(clientX: number): number {
  const thumbs = Array.from(stageRow.value?.querySelectorAll('.stage-thumb') ?? []) as HTMLElement[];
  for (let k = 0; k < thumbs.length; k++) {
    if (clientX < thumbs[k].getBoundingClientRect().right) return k;
  }
  return thumbs.length - 1;
}
function tracked(e: TouchEvent): Touch | null {
  for (const t of Array.from(e.changedTouches)) if (t.identifier === touchId) return t;
  return null;
}
function onThumbTouchStart(i: number, e: TouchEvent): void {
  if (touchId !== null) return; // ignore a second finger mid-gesture
  if ((e.target as HTMLElement).closest('.stage-x')) return; // the remove button owns its taps
  const t = e.changedTouches[0];
  touchId = t.identifier;
  downX = t.clientX;
  downY = t.clientY;
  lifted = false;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    lifted = true;
    dragIndex.value = i;
    navigator.vibrate?.(8);
  }, 300);
}
function onDocTouchMove(e: TouchEvent): void {
  if (touchId === null) return;
  const t = tracked(e);
  if (!t) return;
  if (!lifted) {
    // Still deciding: any real travel before the hold means the user is scrolling — stand down
    // and let the browser scroll natively (do NOT preventDefault).
    if (Math.abs(t.clientX - downX) > 10 || Math.abs(t.clientY - downY) > 10) {
      clearTimeout(holdTimer);
      touchId = null;
    }
    return;
  }
  // Lifted — we own the gesture now: stop the scroll and reorder.
  e.preventDefault();
  const over = thumbAt(t.clientX);
  if (dragIndex.value !== null && over >= 0 && over !== dragIndex.value) {
    const arr = mediaItems.value;
    const [moved] = arr.splice(dragIndex.value, 1);
    arr.splice(over, 0, moved);
    dragIndex.value = over;
  }
}
function onDocTouchEnd(e: TouchEvent): void {
  if (touchId === null || !tracked(e)) return;
  clearTimeout(holdTimer);
  dragIndex.value = null;
  touchId = null;
  lifted = false;
}
onMounted(() => {
  // Non-passive so preventDefault works once a thumbnail is lifted; on document so the gesture
  // keeps tracking even as the finger leaves the row.
  document.addEventListener('touchmove', onDocTouchMove, { passive: false });
  document.addEventListener('touchend', onDocTouchEnd);
  document.addEventListener('touchcancel', onDocTouchEnd);
  void loadResumeDraft();
});

// Spec 1024: if we arrived via "Finish" on a recovered draft, restore the WHOLE post — caption,
// audience, lifetime, and every attachment (photos, videos and voice) — so it's ready to post as-is.
async function loadResumeDraft(): Promise<void> {
  const id = typeof route.query.resume === 'string' ? route.query.resume : null;
  if (!id) return;
  const rec = await getPendingPost(id);
  if (!rec || rec.status !== 'interrupted') return; // gone or no longer recoverable
  resumeId.value = id;
  body.value = rec.body ?? '';
  if (rec.audience) audience.value = rec.audience;
  if (rec.lifetime) lifetime.value = rec.lifetime;
  for (const it of rec.items) {
    // Rebuild a FRESH in-memory Blob from the inline bytes. A Blob read back from IDB can hang on iOS
    // after a reload; the ArrayBuffer we stashed at enqueue always reads back. Skip an older item that
    // only has a (now-unreadable) legacy Blob and no bytes.
    if (!it.bytes && !it.blob) continue;
    const blob = it.bytes ? new Blob([it.bytes], { type: it.mime || defaultMime(it.kind) }) : (it.blob as Blob);
    mediaItems.value.push({
      blob,
      kind: it.kind,
      name: it.name,
      durationSec: it.durationSec,
      url: URL.createObjectURL(blob),
      poster: it.poster, // a video's first-frame thumbnail rode along in the outbox record
      posterTried: it.kind === 'video' ? !!it.poster : undefined,
    });
    // A recovered video with no saved poster: regenerate one so its tile isn't a black box.
    if (it.kind === 'video' && !it.poster) {
      const staged = mediaItems.value[mediaItems.value.length - 1];
      void generateVideoPoster(blob)
        .then((poster) => {
          if (poster) staged.poster = poster;
        })
        .catch(() => {})
        .finally(() => {
          staged.posterTried = true;
        });
    }
  }
}

function defaultMime(kind: 'image' | 'video' | 'voice'): string {
  return kind === 'voice' ? 'audio/webm' : kind === 'video' ? 'video/mp4' : 'image/jpeg';
}

/* ---- voice post recording (mirrors the chat voice recorder, minus the live
   waveform/pause/preview — a post is a single take, kept simple) ---- */
const recording = ref(false);
const recElapsed = ref('0:00');
let recorder: MediaRecorder | null = null;
let recChunks: Blob[] = [];
let recStream: MediaStream | null = null;
let recStart = 0;
let recTimer: number | undefined;

async function startRecording(): Promise<void> {
  if (atMaxMedia.value) {
    void appToast(`You can share up to ${MAX_MEDIA} items in one post.`);
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const types = ['audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t));
    recorder = new MediaRecorder(recStream, mimeType ? { mimeType } : undefined);
    recChunks = [];
    recorder.ondataavailable = (ev) => { if (ev.data.size) recChunks.push(ev.data); };
    recorder.onstop = finishRecording;
    recorder.start();
    recStart = Date.now();
    recElapsed.value = '0:00';
    recording.value = true;
    recTimer = window.setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      recElapsed.value = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
  } catch {
    const a = await alertController.create({
      header: 'Microphone unavailable',
      message: 'Allow microphone access to record a voice post.',
      buttons: ['OK'],
    });
    await a.present();
  }
}

function stopRecording(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function finishRecording(): void {
  if (recTimer) { clearInterval(recTimer); recTimer = undefined; }
  recording.value = false;
  recStream?.getTracks().forEach((t) => t.stop());
  recStream = null;
  const mime = recorder?.mimeType || 'audio/webm';
  recorder = null;
  if (!recChunks.length) return;
  const durationSec = Math.max(1, Math.round((Date.now() - recStart) / 1000));
  const blob = new Blob(recChunks, { type: mime });
  // APPEND the clip as its own album item (it mixes with photos/videos and is reorderable) —
  // don't replace what's already staged.
  mediaItems.value.push({
    blob,
    kind: 'voice',
    name: `voice.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`,
    durationSec,
    url: URL.createObjectURL(blob),
  });
}

onUnmounted(() => {
  for (const m of mediaItems.value) {
    stopIfPlaying(m.url); // leaving the composer discards the draft → stop any preview playing
    URL.revokeObjectURL(m.url);
  }
  if (recTimer) clearInterval(recTimer);
  recStream?.getTracks().forEach((t) => t.stop());
  document.removeEventListener('touchmove', onDocTouchMove);
  document.removeEventListener('touchend', onDocTouchEnd);
  document.removeEventListener('touchcancel', onDocTouchEnd);
});

async function share(): Promise<void> {
  if (!canShare.value || sharing.value) return;
  sharing.value = true;
  try {
    // Spec 1024: cache the staged media into the outbox and DISMISS immediately — the upload
    // worker finishes it in the background and the Wall shows a pending card with progress.
    // HD-only on the Wall (spec 1022, FR-020): every post ships at HD.
    await enqueuePendingPost({
      target: 'wall',
      body: body.value,
      audience: audience.value,
      lifetime: lifetime.value,
      items: mediaItems.value.map((m) => ({
        blob: m.blob,
        kind: m.kind,
        name: m.name,
        mime: m.blob.type || (m.kind === 'voice' ? 'audio/webm' : m.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
        durationSec: m.durationSec,
        poster: m.poster,
      })),
    });
    // Finishing a recovered draft: clear the old interrupted record now that it's re-queued.
    if (resumeId.value) await deletePendingPost(resumeId.value);
    kickPendingPosts();
    router.back();
  } catch (err) {
    const a = await alertController.create({
      header: 'Could not share',
      message: err instanceof Error ? err.message : 'Please try again.',
      buttons: ['OK'],
    });
    await a.present();
  } finally {
    sharing.value = false;
  }
}
</script>

<style scoped>
.composer {
  --padding-start: 20px;
  --padding-end: 20px;
  font-size: 17px;
  margin-top: 8px;
}
.preview {
  position: relative;
  margin: 8px 16px;
}
.preview img,
.preview video {
  width: 100%;
  max-height: 320px;
  object-fit: cover;
  border-radius: 14px;
  background: #000;
}
.preview .remove {
  position: absolute;
  top: 8px;
  right: 8px;
  --border-radius: 50%;
}
.vpreview {
  width: 100%;
}
/* Album staging: a horizontal row of removable thumbnails + an "add more" tile. */
.album-stage {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch; /* momentum scroll on iOS */
  padding: 8px 16px;
}
.stage-thumb {
  position: relative;
  flex: 0 0 auto;
  padding: 6px 6px 0 0; /* room for the overhanging × */
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}
.stage-thumb.dragging {
  transform: scale(1.08);
  opacity: 0.92;
  z-index: 2;
}
.stage-thumb img,
.stage-thumb .stage-vid {
  width: 84px;
  height: 84px;
  object-fit: cover;
  border-radius: 12px;
  display: block;
  background: #000;
  pointer-events: none; /* taps/drags belong to the thumb, not the media element */
}
.stage-vid {
  display: flex !important;
  align-items: center;
  justify-content: center;
  background: #1c1c1c;
}
/* Voice clip tile: a mic + duration, same 84px square as the photo/video thumbs, with a ▶
   overlay so it reads as tappable (reviews through the shared player). */
.stage-voice {
  width: 84px;
  height: 84px;
  border: none;
  border-radius: 12px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Mic to the top, duration to the bottom — clears the center for the (larger) play glyph. */
  justify-content: space-between;
  padding: 4px 0 9px;
  background: var(--ion-color-primary);
  color: #fff;
  font-size: 22px;
}
.stage-voice span {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.stage-voice .stage-play {
  position: absolute;
  left: 50%;
  top: 50%;
  right: auto;
  bottom: auto;
  transform: translate(-50%, -50%);
  font-size: 32px;
  opacity: 1;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35));
}
.stage-spin {
  width: 24px;
  height: 24px;
  color: rgba(255, 255, 255, 0.75);
}
/* play glyph marking a staged video (over its poster) */
.stage-play {
  position: absolute;
  left: 50%;
  top: calc(50% + 3px);
  transform: translate(-50%, -50%);
  font-size: 28px;
  color: #fff;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
  pointer-events: none;
}
.stage-hint {
  margin: 2px 16px 0;
  font-size: 12px;
  color: var(--ion-color-medium);
}
.stage-x {
  position: absolute;
  top: 0;
  right: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ion-color-medium);
  color: var(--ion-color-medium-contrast);
  font-size: 15px;
}
.stage-add {
  flex: 0 0 auto;
  width: 84px;
  height: 84px;
  margin-top: 6px;
  border-radius: 12px;
  border: 1.5px dashed var(--app-border);
  background: var(--app-surface);
  color: var(--ion-color-primary);
  font-size: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stage-add:disabled {
  opacity: 0.35;
}
/* Pulse the mic glyph while a voice post is being recorded. */
.recdot {
  animation: recpulse 1.2s ease-in-out infinite;
}
@keyframes recpulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.hint {
  margin: 8px 20px;
  font-size: 13px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
</style>
