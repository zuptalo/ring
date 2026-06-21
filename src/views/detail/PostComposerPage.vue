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
        :placeholder="media ? 'Add a caption…' : 'Share something with your friends…'"
        autocapitalize="sentences"
        :spellcheck="true"
        dir="auto"
        :value="body"
        @ion-input="onInput"
      />

      <!-- Attachment preview -->
      <div v-if="mediaUrl" class="preview">
        <img v-if="mediaKind === 'image'" :src="mediaUrl" alt="Selected photo" />
        <video v-else-if="mediaKind === 'video'" :src="mediaUrl" controls playsinline />
        <audio v-else class="vpreview" :src="mediaUrl" controls />
        <ion-button class="remove" fill="solid" color="dark" size="small" @click="clearMedia">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
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
          <ion-label color="primary">Add photo or video</ion-label>
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
        style="display: none"
        @change="onFile"
      />

      <!-- Quality applies to photos/videos only; voice is sent as recorded. -->
      <ion-list v-if="media && mediaKind !== 'voice'" :inset="true">
        <ion-list-header>Quality</ion-list-header>
        <ion-item lines="none">
          <ion-segment :value="quality" @ion-change="onQuality">
            <ion-segment-button value="sd"><ion-label>SD</ion-label></ion-segment-button>
            <ion-segment-button value="hd"><ion-label>HD</ion-label></ion-segment-button>
          </ion-segment>
        </ion-item>
      </ion-list>

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

// One attachment slot, shared by a picked photo/video file and a recorded voice clip.
// `mediaKind` is set explicitly when the attachment is chosen (a recorded Blob has no
// filename, so we can't derive the kind from a File like the picker can).
const fileInput = ref<HTMLInputElement | null>(null);
const media = ref<Blob | null>(null);
const mediaUrl = ref<string | undefined>(undefined);
const mediaKind = ref<'image' | 'video' | 'voice'>('image');
const mediaName = ref('attachment');
const mediaDuration = ref<number | undefined>(undefined);
const quality = ref<'sd' | 'hd'>('hd');

const canShare = computed(() => body.value.trim().length > 0 || !!media.value);

function onInput(e: CustomEvent): void {
  body.value = (e.detail as { value?: string | null }).value ?? '';
}
function onAudience(e: CustomEvent): void {
  audience.value = ((e.detail as { value?: string }).value as 'friends' | 'close') ?? 'friends';
}
function onLifetime(e: CustomEvent): void {
  lifetime.value = ((e.detail as { value?: string }).value as PostLifetime) ?? '72h';
}
function onQuality(e: CustomEvent): void {
  quality.value = ((e.detail as { value?: string }).value as 'sd' | 'hd') ?? 'hd';
}

function pickMedia(): void {
  fileInput.value?.click();
}
function onFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  clearMedia();
  media.value = f;
  mediaKind.value = f.type.startsWith('video/') ? 'video' : 'image';
  mediaName.value = f.name || 'attachment';
  mediaUrl.value = URL.createObjectURL(f);
}
function clearMedia(): void {
  if (mediaUrl.value) URL.revokeObjectURL(mediaUrl.value);
  mediaUrl.value = undefined;
  media.value = null;
  mediaDuration.value = undefined;
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
  media.value = blob;
  mediaKind.value = 'voice';
  mediaName.value = `voice.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`;
  mediaDuration.value = durationSec;
  mediaUrl.value = URL.createObjectURL(blob);
}

onUnmounted(() => {
  if (mediaUrl.value) URL.revokeObjectURL(mediaUrl.value);
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
      media: media.value
        ? { blob: media.value, kind: mediaKind.value, name: mediaName.value, durationSec: mediaDuration.value, quality: quality.value }
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
