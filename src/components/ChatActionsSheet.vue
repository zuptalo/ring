<template>
  <!-- Per-chat operations bottom sheet (the chat-row "More"). A rounded sheet with the
       chat's avatar + name, an X to close, the action rows, and a destructive action. -->
  <ion-modal
    :is-open="isOpen"
    :initial-breakpoint="1"
    :breakpoints="[0, 1]"
    class="chat-actions-modal"
    @did-dismiss="$emit('dismiss')"
  >
    <ion-content v-if="chat" class="sheet">
      <div class="sheet-head">
        <ion-avatar class="head-av"><img :src="chat.avatar" :alt="chat.name" /></ion-avatar>
        <h2 class="head-name">{{ chat.name }}</h2>
        <button class="close" aria-label="Close" @click="$emit('dismiss')">
          <ion-icon :icon="closeOutline" />
        </button>
      </div>

      <ion-list :inset="true" class="actions">
        <ion-item button :detail="false" @click="openMute">
          <ion-icon slot="start" :icon="muted ? notificationsOutline : notificationsOffOutline" />
          <ion-label>{{ muted ? 'Unmute' : 'Mute' }}</ion-label>
        </ion-item>
        <ion-item button :detail="false" @click="openInfo">
          <ion-icon slot="start" :icon="informationCircleOutline" />
          <ion-label>{{ chat.isGroup ? 'Group info' : 'Contact info' }}</ion-label>
        </ion-item>
        <ion-item button :detail="false" @click="toggleLock">
          <ion-icon slot="start" :icon="chat.locked ? lockOpenOutline : lockClosedOutline" />
          <ion-label>{{ chat.locked ? 'Unlock chat' : 'Lock chat' }}</ion-label>
        </ion-item>
        <ion-item button :detail="false" @click="toggleFavorite">
          <ion-icon slot="start" :icon="chat.favorite ? heart : heartOutline" />
          <ion-label>{{ chat.favorite ? 'Remove from Favorites' : 'Add to Favorites' }}</ion-label>
        </ion-item>
        <ion-item button :detail="false" @click="addToList">
          <ion-icon slot="start" :icon="listOutline" />
          <ion-label>Add to list</ion-label>
        </ion-item>
        <ion-item button :detail="false" @click="confirmClear">
          <ion-icon slot="start" :icon="closeCircleOutline" />
          <ion-label>Clear chat</ion-label>
        </ion-item>
      </ion-list>

      <ion-list :inset="true" class="actions danger">
        <ion-item button :detail="false" @click="confirmRemove">
          <ion-icon slot="start" color="danger" :icon="chat.isGroup ? exitOutline : trashOutline" />
          <ion-label color="danger">{{ chat.isGroup ? 'Exit group' : 'Delete chat' }}</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonModal, IonContent, IonList, IonItem, IonLabel, IonIcon, IonAvatar,
  actionSheetController,
} from '@ionic/vue';
import {
  closeOutline, notificationsOffOutline, notificationsOutline, informationCircleOutline,
  heart, heartOutline, listOutline, closeCircleOutline, exitOutline, trashOutline,
  lockClosedOutline, lockOpenOutline,
} from 'ionicons/icons';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  setChatMute, toggleChatFavorite, clearChat, deleteChat, leaveGroup, setChatLocked,
} from '@/db/queries';
import { lockConfigured } from '@/services/chat-lock';
import type { Chat } from '@/db/types';

const props = defineProps<{ chat: Chat | null; isOpen: boolean }>();
const emit = defineEmits<{ (e: 'dismiss'): void; (e: 'addToList', chat: Chat): void }>();

const router = useRouter();
const HOUR = 60 * 60 * 1000;
const muted = computed(() => !!props.chat?.mutedUntil && props.chat.mutedUntil > Date.now());

async function openMute(): Promise<void> {
  const id = props.chat?.id;
  if (!id) return;
  const buttons = muted.value
    ? [{ text: 'Unmute', handler: () => void setChatMute(id, null) }]
    : [
        { text: 'Mute for 8 hours', handler: () => void setChatMute(id, Date.now() + 8 * HOUR) },
        { text: 'Mute for 1 week', handler: () => void setChatMute(id, Date.now() + 7 * 24 * HOUR) },
        { text: 'Mute always', handler: () => void setChatMute(id, Date.now() + 100 * 365 * 24 * HOUR) },
      ];
  const sheet = await actionSheetController.create({
    header: 'Notifications',
    buttons: [...buttons, { text: 'Cancel', role: 'cancel' as const }],
  });
  await sheet.present();
  await sheet.onDidDismiss();
  emit('dismiss');
}

function openInfo(): void {
  const c = props.chat;
  if (!c) return;
  emit('dismiss');
  if (c.isGroup) router.push(`/group/${c.id}`);
  else if (c.participantIds[0]) router.push(`/contact/${c.participantIds[0]}`);
}

async function toggleFavorite(): Promise<void> {
  if (props.chat) await toggleChatFavorite(props.chat.id);
  emit('dismiss');
}

async function toggleLock(): Promise<void> {
  const c = props.chat;
  if (!c) return;
  if (c.locked) {
    // Unlocking from within the (already auth-gated) Locked view: no re-prompt.
    await setChatLocked(c.id, false);
    emit('dismiss');
    return;
  }
  // Locking requires an app passcode to exist; otherwise send them to set one up.
  if (!(await lockConfigured())) {
    emit('dismiss');
    const sheet = await actionSheetController.create({
      header: 'Set an app passcode first to lock chats.',
      buttons: [
        { text: 'Set up App lock', handler: () => void router.push('/settings/privacy-app-lock') },
        { text: 'Cancel', role: 'cancel' as const },
      ],
    });
    await sheet.present();
    return;
  }
  await setChatLocked(c.id, true);
  emit('dismiss');
}

function addToList(): void {
  if (props.chat) emit('addToList', props.chat);
}

async function confirmClear(): Promise<void> {
  const id = props.chat?.id;
  if (!id) return;
  const sheet = await actionSheetController.create({
    header: 'Clear all messages in this chat? The chat stays in your list.',
    buttons: [
      { text: 'Clear chat', role: 'destructive', handler: () => void clearChat(id) },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
  await sheet.onDidDismiss();
  emit('dismiss');
}

async function confirmRemove(): Promise<void> {
  const c = props.chat;
  if (!c) return;
  const sheet = await actionSheetController.create({
    header: c.isGroup ? `Leave "${c.name}"?` : `Delete this chat?`,
    buttons: [
      {
        text: c.isGroup ? 'Exit group' : 'Delete chat',
        role: 'destructive',
        handler: () => void (c.isGroup ? leaveGroup(c.id) : deleteChat(c.id)),
      },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
  await sheet.onDidDismiss();
  emit('dismiss');
}
</script>

<style scoped>
.sheet {
  --padding-top: 8px;
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 6px;
}
.head-av {
  width: 44px;
  height: 44px;
}
.head-name {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.close {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.24));
  color: var(--ion-text-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
}
.actions ion-icon {
  font-size: 22px;
  color: var(--ion-text-color);
}
</style>
