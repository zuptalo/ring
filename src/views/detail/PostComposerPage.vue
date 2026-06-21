<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/wall" />
        </ion-buttons>
        <ion-title>New post</ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" :disabled="!canShare || sharing" @click="share">Share</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-textarea
        class="composer"
        :auto-grow="true"
        :rows="4"
        placeholder="Share something with your friends…"
        autocapitalize="sentences"
        :spellcheck="true"
        dir="auto"
        :value="body"
        @ion-input="onInput"
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
            <ion-segment-button value="24h"><ion-label>24 hours</ion-label></ion-segment-button>
            <ion-segment-button value="7d"><ion-label>7 days</ion-label></ion-segment-button>
            <ion-segment-button value="keep"><ion-label>Keep</ion-label></ion-segment-button>
          </ion-segment>
        </ion-item>
      </ion-list>

      <p class="hint">
        Your post is end-to-end encrypted and visible only to the audience you choose.
        Only friends can see it — never the server or the wider network.
      </p>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonContent, IonTextarea, IonList, IonListHeader, IonItem, IonSegment, IonSegmentButton,
  IonLabel, alertController,
} from '@ionic/vue';
import { useRouter } from 'vue-router';
import { createPost, type PostLifetime } from '@/db/queries';

const router = useRouter();
const body = ref('');
const audience = ref<'friends' | 'close'>('friends');
const lifetime = ref<PostLifetime>('24h');
const sharing = ref(false);

const canShare = computed(() => body.value.trim().length > 0);

function onInput(e: CustomEvent): void {
  body.value = (e.detail as { value?: string | null }).value ?? '';
}
function onAudience(e: CustomEvent): void {
  audience.value = ((e.detail as { value?: string }).value as 'friends' | 'close') ?? 'friends';
}
function onLifetime(e: CustomEvent): void {
  lifetime.value = ((e.detail as { value?: string }).value as PostLifetime) ?? '24h';
}

async function share(): Promise<void> {
  if (!canShare.value || sharing.value) return;
  sharing.value = true;
  try {
    await createPost({ payload: { kind: 'text', body: body.value.trim() }, audience: audience.value, lifetime: lifetime.value });
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
.hint {
  margin: 8px 20px;
  font-size: 13px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
</style>
