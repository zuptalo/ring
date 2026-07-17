<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/chat/${chatId}`" />
        </ion-buttons>
        <ion-title>Starred</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div v-if="!messages.length" class="empty ion-text-center">
        <ion-icon :icon="starOutline" />
        <p>No starred messages</p>
        <p class="hint">Star a message (long-press it) to keep it here.</p>
      </div>

      <ion-list v-else>
        <ion-item v-for="m in messages" :key="m.id" button :detail="false" @click="jump(m)">
          <ion-icon slot="start" :icon="star" color="warning" />
          <ion-label class="ion-text-wrap">
            <h2>{{ m.outgoing ? 'You' : m.senderName }}</h2>
            <p>{{ preview(m) }}</p>
            <p class="time">{{ when(m.timestamp) }}</p>
          </ion-label>
          <ion-button slot="end" fill="clear" size="small" @click.stop="unstar(m)">Unstar</ion-button>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonList, IonItem, IonLabel, IonIcon, IonButton,
} from '@ionic/vue';
import { star, starOutline } from 'ionicons/icons';
import { listStarred, toggleFavorite } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Message } from '@/db/types';

const route = useRoute();
const router = useRouter();
const chatId = route.params.id as string;

const messages = useLiveQuery<Message[]>(() => listStarred(chatId), ['messages'], []);

function preview(m: Message): string {
  if (m.body) return m.body;
  switch (m.kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return m.videoNote ? 'Video note' : 'Video';
    case 'voice':
      return 'Voice message';
    case 'audio':
      return m.audio?.title || 'Audio';
    case 'file':
      return 'Document';
    case 'location':
      return m.location?.label || 'Location';
    case 'poll':
      return m.poll?.question || 'Poll';
    case 'contact':
      return m.contact?.name || 'Contact';
    default:
      return 'Message';
  }
}

function when(ts: number): string {
  return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function jump(m: Message): void {
  router.push(`/chat/${chatId}?jump=${m.id}`);
}

function unstar(m: Message): void {
  void toggleFavorite(m.id);
}
</script>

<style scoped>
.empty {
  padding: 64px 24px;
  color: var(--app-text-muted);
}
.empty ion-icon {
  font-size: 48px;
  opacity: 0.5;
}
.empty p {
  margin: 8px 0 0;
}
.empty .hint {
  font-size: 13px;
}
.time {
  font-size: 12px;
  opacity: 0.7;
}
</style>
