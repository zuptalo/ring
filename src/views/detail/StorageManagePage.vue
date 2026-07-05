<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings/storage" />
        </ion-buttons>
        <ion-title>Manage storage</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Manage storage</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Used vs available. The quota comes from navigator.storage.estimate()
           (the origin's real allowance); only Ring's own usage is visible to a
           web app, so the label is scoped honestly. -->
      <ion-list :inset="true">
        <ion-item lines="none">
          <ion-label class="ion-text-wrap">
            <h2>{{ formatBytes(used) }}</h2>
            <p>{{ quota ? formatBytes(quota) + ' available' : 'Used by Ring on this device' }}</p>
            <p v-if="thumbsUsed > 0">includes {{ formatBytes(thumbsUsed) }} in previews</p>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-progress-bar :value="quota ? Math.min(used / quota, 1) : 0" />
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-list-header><ion-label>Media by type</ion-label></ion-list-header>
        <ion-item
          v-for="(t, i) in typeRows"
          :key="t.kind"
          :button="byType[t.kind] > 0"
          :detail="false"
          :lines="i === typeRows.length - 1 ? 'none' : undefined"
          @click="byType[t.kind] > 0 && cleanKind([t.kind], t.label)"
        >
          <ion-label class="ion-text-wrap">
            {{ t.label }}
            <p v-if="thumbsByType[t.kind] > 0">+ {{ formatBytes(thumbsByType[t.kind]) }} previews</p>
          </ion-label>
          <ion-note slot="end">{{ formatBytes(byType[t.kind]) }}</ion-note>
          <ion-icon
            v-if="byType[t.kind] > 0"
            slot="end"
            :icon="trashOutline"
            color="medium"
            aria-hidden="true"
          />
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item button :detail="false" @click="cleanLarge">
          <ion-icon slot="start" :icon="fileTrayFullOutline" color="primary" />
          <ion-label color="primary">Free up large files…</ion-label>
        </ion-item>
        <ion-item button :detail="false" lines="none" @click="confirmKeepPreviews">
          <ion-icon slot="start" :icon="imagesOutline" color="primary" />
          <ion-label color="primary">Free space, keep previews</ion-label>
        </ion-item>
      </ion-list>

      <ion-list :inset="true" v-if="perChat.length">
        <ion-list-header><ion-label>Storage by chat</ion-label></ion-list-header>
        <ion-item v-for="row in perChat" :key="row.chatId">
          <ion-avatar slot="start">
            <user-avatar :src="row.avatar" :alt="row.name" />
          </ion-avatar>
          <ion-label class="ion-text-wrap">
            <h2>{{ row.name }}</h2>
            <p>
              {{ row.count }} item{{ row.count === 1 ? '' : 's' }}
              <template v-if="row.bytesThumbs > 0"> · {{ formatBytes(row.bytesThumbs) }} previews</template>
            </p>
          </ion-label>
          <ion-note slot="end">{{ formatBytes(row.bytes) }}</ion-note>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item button :detail="false" @click="confirmClear">
          <ion-icon slot="start" :icon="trashOutline" color="danger" />
          <ion-label color="danger">Clear all media</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { computed, onMounted, ref } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonList, IonListHeader, IonItem, IonLabel, IonNote, IonIcon,
  IonAvatar, IonProgressBar, alertController, actionSheetController,
} from '@ionic/vue';
import { trashOutline, fileTrayFullOutline, imagesOutline } from 'ionicons/icons';
import {
  storageByChat, storageByType, clearAllMedia,
  deleteMediaByKind, deleteMediaLargerThan, mediaCleanupPreview, freeKeepingPreviews,
} from '@/db/queries';
import type { Media } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatBytes } from '@/utils/bytes';

const typeRows: { kind: Media['kind']; label: string }[] = [
  { kind: 'image', label: 'Photos' },
  { kind: 'video', label: 'Videos' },
  { kind: 'voice', label: 'Voice' },
  { kind: 'audio', label: 'Audio' },
  { kind: 'file', label: 'Documents' },
];

const perChat = useLiveQuery(() => storageByChat(), ['messages', 'media', 'chats'], []);
const zeroByKind = { image: 0, video: 0, file: 0, voice: 0, audio: 0 };
const typeStats = useLiveQuery(
  () => storageByType(),
  ['media'],
  { total: 0, byKind: { ...zeroByKind }, thumbsTotal: 0, thumbsByKind: { ...zeroByKind } },
);
const byType = computed(() => typeStats.value.byKind);
const thumbsByType = computed(() => typeStats.value.thumbsByKind);
const used = computed(() => typeStats.value.total);
const thumbsUsed = computed(() => typeStats.value.thumbsTotal);

// Origin storage allowance (real where the API exists; 0 hides the ratio).
const quota = ref(0);
onMounted(async () => {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) quota.value = est.quota;
  } catch {
    /* unsupported */
  }
});

// Confirm + delete all media of one or more kinds (shows what will be freed).
async function cleanKind(kinds: Media['kind'][], label: string): Promise<void> {
  const { bytes, count } = await mediaCleanupPreview({ kinds });
  if (count === 0) return;
  const a = await alertController.create({
    header: `Delete ${label.toLowerCase()}`,
    message: `Remove ${count} item${count === 1 ? '' : 's'} (${formatBytes(bytes)}) from this device? This cannot be undone.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Delete', role: 'destructive', handler: () => void deleteMediaByKind(kinds) },
    ],
  });
  await a.present();
}

// Pick a size threshold, then confirm deleting everything above it.
async function cleanLarge(): Promise<void> {
  const MB = 1024 * 1024;
  const thresholds = [10, 50, 100];
  const buttons = await Promise.all(
    thresholds.map(async (mb) => {
      const { bytes, count } = await mediaCleanupPreview({ minBytes: mb * MB });
      return {
        text: `Larger than ${mb} MB · ${count} item${count === 1 ? '' : 's'} (${formatBytes(bytes)})`,
        handler: () => void confirmLarge(mb * MB, mb),
      };
    }),
  );
  const sheet = await actionSheetController.create({
    header: 'Free up large files',
    buttons: [...buttons, { text: 'Cancel', role: 'cancel' as const }],
  });
  await sheet.present();
}

async function confirmLarge(minBytes: number, mb: number): Promise<void> {
  const { bytes, count } = await mediaCleanupPreview({ minBytes });
  if (count === 0) return;
  const a = await alertController.create({
    header: `Delete files over ${mb} MB`,
    message: `Remove ${count} item${count === 1 ? '' : 's'} (${formatBytes(bytes)})? This cannot be undone.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Delete', role: 'destructive', handler: () => void deleteMediaLargerThan(minBytes) },
    ],
  });
  await a.present();
}

// Free the full-resolution originals app-wide but keep the small previews (spec 1014 FR-018).
async function confirmKeepPreviews(): Promise<void> {
  const a = await alertController.create({
    header: 'Free space, keep previews',
    message:
      'Remove the full-resolution photos and videos from this device but keep the small previews. Previews still show in chats, but the full-resolution originals are removed permanently and cannot be recovered.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Free space', role: 'destructive', handler: () => void freeKeepingPreviews() },
    ],
  });
  await a.present();
}

async function confirmClear() {
  const a = await alertController.create({
    header: 'Clear all media',
    message: 'This removes all downloaded photos, videos, voice notes and files from this device. This cannot be undone.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Clear', role: 'destructive', handler: () => clearAllMedia() },
    ],
  });
  await a.present();
}
</script>
