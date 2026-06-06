<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings/storage" />
        </ion-buttons>
        <ion-title>Network usage</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Network usage</ion-title>
        </ion-toolbar>
      </ion-header>

      <ion-list :inset="true">
        <ion-list-header><ion-label>Messages</ion-label></ion-list-header>
        <ion-item>
          <ion-label>Sent</ion-label>
          <ion-note slot="end">{{ stats.messagesSent }}</ion-note>
        </ion-item>
        <ion-item lines="none">
          <ion-label>Received</ion-label>
          <ion-note slot="end">{{ stats.messagesReceived }}</ion-note>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-list-header><ion-label>Media & calls</ion-label></ion-list-header>
        <ion-item>
          <ion-label>Media transferred</ion-label>
          <ion-note slot="end">{{ formatBytes(stats.mediaBytes) }}</ion-note>
        </ion-item>
        <ion-item>
          <ion-label>Calls</ion-label>
          <ion-note slot="end">{{ stats.calls }}</ion-note>
        </ion-item>
        <ion-item>
          <ion-label>Total call time</ion-label>
          <ion-note slot="end">{{ formatDuration(stats.callSeconds) }}</ion-note>
        </ion-item>
        <ion-item lines="none">
          <ion-label>Call data</ion-label>
          <ion-note slot="end">{{ formatBytes(stats.callBytes) }}</ion-note>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item button :detail="false" @click="confirmReset">
          <ion-icon slot="start" :icon="refreshOutline" color="danger" />
          <ion-label color="danger">Reset statistics</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonList, IonListHeader, IonItem, IonLabel, IonNote, IonIcon,
  alertController,
} from '@ionic/vue';
import { refreshOutline } from 'ionicons/icons';
import { networkStats, getSetting, setSetting } from '@/db/queries';
import { getAll } from '@/db/idb';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatBytes } from '@/utils/bytes';
import type { Setting } from '@/db/types';

// resetAt lives in settings; recompute stats whenever messages/media/calls OR
// the reset point change.
const settingsRows = useLiveQuery(() => getAll<Setting>('settings'), ['settings'], [] as Setting[]);
const resetAt = () =>
  (settingsRows.value.find((r) => r.key === 'network.resetAt')?.value as number) ?? 0;

const stats = useLiveQuery(
  () => getSetting('network.resetAt', 0).then((since) => networkStats(since)),
  ['messages', 'media', 'calls', 'settings'],
  { messagesSent: 0, messagesReceived: 0, mediaBytes: 0, calls: 0, callSeconds: 0, callBytes: 0 },
  resetAt,
);

function formatDuration(sec: number): string {
  if (!sec) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : '', !h && s ? `${s}s` : ''].filter(Boolean).join(' ') || '0s';
}

async function confirmReset() {
  const a = await alertController.create({
    header: 'Reset statistics',
    message: 'Network usage counters will start again from zero.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Reset', role: 'destructive', handler: () => setSetting('network.resetAt', Date.now()) },
    ],
  });
  await a.present();
}
</script>
