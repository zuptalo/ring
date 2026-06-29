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

      <!-- Voice preview (a voice post is always on its own) -->
      <div v-if="hasVoice" class="preview">
        <audio class="vpreview" :src="mediaItems[0].url" controls />
        <ion-button class="remove" fill="solid" color="dark" size="small" @click="clearMedia">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </div>

      <!-- Photo/video staging: several compose an album (FR-019). A row of removable
           thumbnails (their order is the album order) plus an "add more" tile. -->
      <div v-else-if="mediaItems.length" class="album-stage">
        <div v-for="(m, i) in mediaItems" :key="m.url" class="stage-thumb">
          <img v-if="m.kind === 'image'" :src="m.url" alt="" />
          <video v-else :src="m.url" muted playsinline />
          <button type="button" class="stage-x" aria-label="Remove" @click="removeMedia(i)">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
        <button type="button" class="stage-add" aria-label="Add more photos or videos" @click="pickMedia">
          <ion-icon :icon="imageOutline" />
        </button>
      </div>

      <!-- Recording a voice post in progress -->
      <ion-list v-else-if="recording" :inset="true">
        <ion-item lines="none">
          <ion-icon slot="start" :icon="micOutline" color="danger" class="recdot" />
          <ion-label>Recording… {{ recElapsed }}</ion-label>
          <ion-button slot="end" fill="solid" color="danger" @click="stopRecording">Stop</ion-button>
        </ion-item>
      </ion-list>

      <!-- Attachment options: a photo/video file, or a recorded voice post -->
      <ion-list v-else :inset="true">
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
import { computed, ref, onUnmounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonTextarea, IonList, IonListHeader, IonItem, IonSegment, IonSegmentButton,
  IonLabel, IonIcon, alertController,
} from '@ionic/vue';
import { useRouter } from 'vue-router';
import { imageOutline, closeOutline, micOutline } from 'ionicons/icons';
import { vEnterSend } from '@/directives/enter-send';
import { createPost, type PostLifetime } from '@/db/queries';

const router = useRouter();
const body = ref('');
const audience = ref<'friends' | 'close'>('friends');
const lifetime = ref<PostLifetime>('72h');
const sharing = ref(false);

// Staged attachments. Several photos/videos compose an ALBUM post (spec 1022, FR-019); a
// recorded voice clip is always on its own. Object URLs back the previews, revoked on
// remove/unmount. `kind` is explicit (a recorded Blob has no filename to derive it from).
interface PostMedia {
  blob: Blob;
  kind: 'image' | 'video' | 'voice';
  name: string;
  durationSec?: number;
  url: string;
}
const fileInput = ref<HTMLInputElement | null>(null);
const mediaItems = ref<PostMedia[]>([]);
const hasVoice = computed(() => mediaItems.value.some((m) => m.kind === 'voice'));

const canShare = computed(() => body.value.trim().length > 0 || mediaItems.value.length > 0);

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
function onFile(e: Event): void {
  // Picking several photos/videos stages them all → one album on Send. A voice clip in the
  // stage means it's a voice post; clear it before adding files (the two don't mix).
  if (hasVoice.value) clearMedia();
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  for (const f of files) {
    mediaItems.value.push({
      blob: f,
      kind: f.type.startsWith('video/') ? 'video' : 'image',
      name: f.name || 'attachment',
      url: URL.createObjectURL(f),
    });
  }
  if (fileInput.value) fileInput.value.value = '';
}
function removeMedia(i: number): void {
  const [gone] = mediaItems.value.splice(i, 1);
  if (gone) URL.revokeObjectURL(gone.url);
}
function clearMedia(): void {
  for (const m of mediaItems.value) URL.revokeObjectURL(m.url);
  mediaItems.value = [];
  if (fileInput.value) fileInput.value.value = '';
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
  clearMedia();
  mediaItems.value = [
    {
      blob,
      kind: 'voice',
      name: `voice.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`,
      durationSec,
      url: URL.createObjectURL(blob),
    },
  ];
}

onUnmounted(() => {
  for (const m of mediaItems.value) URL.revokeObjectURL(m.url);
  if (recTimer) clearInterval(recTimer);
  recStream?.getTracks().forEach((t) => t.stop());
});

async function share(): Promise<void> {
  if (!canShare.value || sharing.value) return;
  sharing.value = true;
  try {
    await createPost({
      body: body.value,
      audience: audience.value,
      lifetime: lifetime.value,
      // HD-only on the Wall (spec 1022, FR-020): no quality choice — every post ships at HD.
      // One item → a single-media post; several photos/videos → an album (FR-019).
      media: mediaItems.value.length
        ? mediaItems.value.map((m) => ({
            blob: m.blob,
            kind: m.kind,
            name: m.name,
            durationSec: m.durationSec,
            quality: 'hd' as const,
          }))
        : undefined,
    });
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
  padding: 8px 16px;
}
.stage-thumb {
  position: relative;
  flex: 0 0 auto;
  padding: 6px 6px 0 0; /* room for the overhanging × */
}
.stage-thumb img,
.stage-thumb video {
  width: 84px;
  height: 84px;
  object-fit: cover;
  border-radius: 12px;
  display: block;
  background: #000;
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
