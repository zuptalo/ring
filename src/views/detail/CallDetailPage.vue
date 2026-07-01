<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/calls" />
        </ion-buttons>
        <ion-title>Call info</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <template v-if="contact">
        <div class="profile ion-text-center">
          <ion-avatar class="profile-avatar">
            <img :src="contact.avatar" :alt="contact.name" />
          </ion-avatar>
          <h1>{{ contact.name }}</h1>
          <p>{{ contact.phone }}</p>
        </div>

        <ion-grid class="actions">
          <!-- Spec 1025 US6: Video and Message swapped (Video takes Message's place). -->
          <ion-row>
            <ion-col>
              <ion-button expand="block" fill="clear" @click="call('video')">
                <ion-icon slot="start" :icon="videocamOutline" />
                Video
              </ion-button>
            </ion-col>
            <ion-col>
              <ion-button expand="block" fill="clear" @click="call('audio')">
                <ion-icon slot="start" :icon="callOutline" />
                Audio
              </ion-button>
            </ion-col>
            <ion-col>
              <ion-button expand="block" fill="clear" @click="message">
                <ion-icon slot="start" :icon="chatbubbleOutline" />
                Message
              </ion-button>
            </ion-col>
          </ion-row>
        </ion-grid>
      </template>

      <ion-list>
        <ion-list-header>
          <ion-label>Recent</ion-label>
        </ion-list-header>
        <ion-item v-for="c in calls" :key="c.id" :detail="false">
          <ion-icon
            slot="start"
            :icon="c.video ? videocamOutline : callOutline"
            :color="c.missed ? 'danger' : 'primary'"
          />
          <ion-label :color="c.missed ? 'danger' : undefined">
            <h2>{{ typeLabel(c) }}</h2>
            <p v-if="c.durationSec">
              {{ formatDuration(c.durationSec) }}<span v-if="c.bytes"> · {{ formatBytes(c.bytes) }}</span>
            </p>
          </ion-label>
          <ion-note slot="end">
            {{ formatDay(c.timestamp) }} · {{ formatClock(c.timestamp) }}
          </ion-note>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonGrid, IonRow, IonCol, IonButton, IonIcon,
  IonList, IonListHeader, IonItem, IonLabel, IonNote,
} from '@ionic/vue';
import { chatbubbleOutline, callOutline, videocamOutline } from 'ionicons/icons';
import { getContact, listCallsForContact, listChats } from '@/db/queries';
import { startDirectCall } from '@/composables/useCall';
import type { Call, Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatClock, formatDuration, formatDay } from '@/utils/time';
import { formatBytes } from '@/utils/bytes';

const route = useRoute();
const router = useRouter();
const contactId = route.params.contactId as string;

const contact = useLiveQuery<Contact | undefined>(
  () => getContact(contactId),
  ['contacts'],
  undefined,
);
const calls = useLiveQuery(
  () => listCallsForContact(contactId),
  ['calls'],
  [] as Call[],
);

const typeLabel = (c: Call) => {
  const dir = c.missed ? 'Missed' : c.direction === 'outgoing' ? 'Outgoing' : 'Incoming';
  return `${dir} ${c.video ? 'video' : 'voice'} call`;
};

async function message() {
  const chats = await listChats();
  const direct = chats.find(
    (c) => !c.isGroup && c.participantIds.includes(contactId),
  );
  if (direct) router.push(`/chat/${direct.id}`);
}

function call(kind: 'audio' | 'video') {
  void startDirectCall(contactId, kind);
}
</script>

<style scoped>
.profile {
  padding: 24px 16px 8px;
}
.profile-avatar {
  width: 96px;
  height: 96px;
  margin: 0 auto 12px;
}
.profile h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.profile p {
  margin: 4px 0 0;
  color: var(--app-text-muted);
}
.actions {
  max-width: 420px;
  margin: 0 auto;
}
</style>
