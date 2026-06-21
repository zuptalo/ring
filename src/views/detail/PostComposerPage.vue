<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/wall" />
        </ion-buttons>
        <ion-title>New post</ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" :disabled="!canShare || sharing" @click="share">Share</ion-button>
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
        <video v-else :src="mediaUrl" controls playsinline />
        <ion-button class="remove" fill="solid" color="dark" size="small" @click="clearMedia">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </div>

      <ion-list v-else :inset="true">
        <ion-item button :detail="false" @click="pickMedia">
          <ion-icon slot="start" :icon="imageOutline" color="primary" />
          <ion-label color="primary">Add photo or video</ion-label>
        </ion-item>
      </ion-list>
      <input
        ref="fileInput"
        type="file"
        accept="image/*,video/*"
        style="display: none"
        @change="onFile"
      />

      <ion-list v-if="media" :inset="true">
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
import { imageOutline, closeOutline } from 'ionicons/icons';
import { vEnterSend } from '@/directives/enter-send';
import { createPost, type PostLifetime } from '@/db/queries';

const router = useRouter();
const body = ref('');
const audience = ref<'friends' | 'close'>('friends');
const lifetime = ref<PostLifetime>('72h');
const sharing = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const media = ref<File | null>(null);
const mediaUrl = ref<string | undefined>(undefined);
const quality = ref<'sd' | 'hd'>('hd');
const mediaKind = computed<'image' | 'video'>(() =>
  media.value?.type.startsWith('video/') ? 'video' : 'image',
);

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
  mediaUrl.value = URL.createObjectURL(f);
}
function clearMedia(): void {
  if (mediaUrl.value) URL.revokeObjectURL(mediaUrl.value);
  mediaUrl.value = undefined;
  media.value = null;
  if (fileInput.value) fileInput.value.value = '';
}
onUnmounted(() => {
  if (mediaUrl.value) URL.revokeObjectURL(mediaUrl.value);
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
        ? { blob: media.value, kind: mediaKind.value, name: media.value.name || 'attachment', quality: quality.value }
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
.hint {
  margin: 8px 20px;
  font-size: 13px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
</style>
