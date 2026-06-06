<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/chat/${chatId}`" />
        </ion-buttons>
        <ion-title>Message info</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-list :inset="true" v-if="message">
        <ion-item lines="none">
          <ion-label class="ion-text-wrap">
            <p>{{ message.body || mediaLabel(message.kind) }}</p>
          </ion-label>
          <ion-note slot="end">
            {{ formatTime(message.timestamp) }}
            <ion-icon
              class="tick"
              :icon="statusIcon(message.status)"
              :color="message.status === 'read' ? 'primary' : undefined"
            />
          </ion-note>
        </ion-item>
      </ion-list>

      <!-- Group: per-recipient read / delivered lists -->
      <template v-if="isGroup">
        <ion-list :inset="true">
          <ion-list-header>
            <ion-icon :icon="checkmarkDone" color="primary" />
            <ion-label>Read by</ion-label>
          </ion-list-header>
          <ion-item v-for="r in readBy" :key="r.contactId">
            <ion-avatar slot="start">
              <img :src="avatarFor(r.contactId)" :alt="nameFor(r.contactId)" />
            </ion-avatar>
            <ion-label>{{ nameFor(r.contactId) }}</ion-label>
            <ion-note slot="end">{{ formatTime(r.readAt!) }}</ion-note>
          </ion-item>
          <ion-item v-if="readBy.length === 0" lines="none">
            <ion-note>No one yet</ion-note>
          </ion-item>
        </ion-list>

        <ion-list :inset="true">
          <ion-list-header>
            <ion-icon :icon="checkmarkDone" />
            <ion-label>Delivered to</ion-label>
          </ion-list-header>
          <ion-item v-for="r in deliveredTo" :key="r.contactId">
            <ion-avatar slot="start">
              <img :src="avatarFor(r.contactId)" :alt="nameFor(r.contactId)" />
            </ion-avatar>
            <ion-label>{{ nameFor(r.contactId) }}</ion-label>
            <ion-note slot="end">{{ formatTime(r.deliveredAt!) }}</ion-note>
          </ion-item>
          <ion-item v-if="deliveredTo.length === 0" lines="none">
            <ion-note>No one yet</ion-note>
          </ion-item>
        </ion-list>
      </template>

      <!-- 1:1: simple status timeline -->
      <ion-list :inset="true" v-else-if="message">
        <ion-item v-if="reached('read')">
          <ion-icon slot="start" :icon="checkmarkDone" color="primary" />
          <ion-label>Read</ion-label>
          <ion-note v-if="message.readAt" slot="end">{{ formatTime(message.readAt) }}</ion-note>
        </ion-item>
        <ion-item v-if="reached('delivered')">
          <ion-icon slot="start" :icon="checkmarkDone" />
          <ion-label>Delivered</ion-label>
          <ion-note v-if="message.deliveredAt" slot="end">{{ formatTime(message.deliveredAt) }}</ion-note>
        </ion-item>
        <ion-item>
          <ion-icon slot="start" :icon="statusIcon(message.status === 'pending' ? 'pending' : 'sent')" />
          <ion-label>{{ message.status === 'pending' ? 'Pending' : 'Sent' }}</ion-label>
          <ion-note slot="end">{{ formatTime(message.timestamp) }}</ion-note>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonList, IonListHeader, IonItem, IonAvatar, IonLabel,
  IonNote, IonIcon,
} from '@ionic/vue';
import { timeOutline, checkmark, checkmarkDone } from 'ionicons/icons';
import { getMessage, getChat, listContacts } from '@/db/queries';
import { initialsAvatar } from '@/db/avatars';
import type { Chat, Contact, Message, MessageStatus } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatTime } from '@/utils/time';

const route = useRoute();
const chatId = route.params.id as string;
const messageId = route.params.messageId as string;

const message = useLiveQuery<Message | undefined>(
  () => getMessage(messageId),
  ['messages'],
  undefined,
);
const chat = useLiveQuery<Chat | undefined>(() => getChat(chatId), ['chats'], undefined);
const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);

// Per-recipient (Read by / Delivered to) lists are a group concept; branch on the
// chat being a group rather than on the message carrying a receipts array, so the
// right panel shows even for an edge-case row and never shows for a stray 1:1 one.
const isGroup = computed(() => chat.value?.isGroup === true && !!message.value?.receipts);

const contactMap = computed(
  () => new Map(contacts.value.map((c) => [c.id, c])),
);
const nameFor = (id: string) => contactMap.value.get(id)?.name ?? 'Unknown';
// Fall back to a generated initials avatar (never an empty src → broken image) for
// members whose contact row was pruned (e.g. someone who left the group).
const avatarFor = (id: string) => contactMap.value.get(id)?.avatar || initialsAvatar(nameFor(id));

const readBy = computed(() =>
  (message.value?.receipts ?? [])
    .filter((r) => r.readAt)
    .sort((a, b) => (a.readAt ?? 0) - (b.readAt ?? 0)),
);
const deliveredTo = computed(() =>
  (message.value?.receipts ?? [])
    .filter((r) => r.deliveredAt && !r.readAt)
    .sort((a, b) => (a.deliveredAt ?? 0) - (b.deliveredAt ?? 0)),
);

const order: MessageStatus[] = ['pending', 'sent', 'delivered', 'read'];
const reached = (s: MessageStatus) =>
  !!message.value && order.indexOf(message.value.status) >= order.indexOf(s);

function statusIcon(status: MessageStatus) {
  if (status === 'pending') return timeOutline;
  if (status === 'sent') return checkmark;
  return checkmarkDone;
}

function mediaLabel(kind: Message['kind']) {
  return kind === 'image' ? '📷 Photo'
    : kind === 'video' ? '🎥 Video'
    : kind === 'voice' ? '🎤 Voice message'
    : kind === 'file' ? '📎 Attachment'
    : '';
}
</script>

<style scoped>
.tick {
  font-size: 15px;
  vertical-align: -2px;
  margin-inline-start: 3px;
}
</style>
