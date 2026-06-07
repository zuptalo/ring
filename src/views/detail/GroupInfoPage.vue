<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/chats" />
        </ion-buttons>
        <ion-title>Group info</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <template v-if="chat">
        <div class="profile ion-text-center">
          <button class="avatar-btn" type="button" @click="editPhoto" aria-label="Change group photo">
            <ion-avatar class="profile-avatar">
              <img :src="chat.avatar" :alt="chat.name" />
            </ion-avatar>
            <span class="cam"><ion-icon :icon="cameraOutline" /></span>
          </button>
          <button class="name-btn" type="button" @click="rename">
            <h1>{{ chat.name }}</h1>
            <ion-icon :icon="createOutline" />
          </button>
          <p>{{ members.length + 1 }} members</p>
        </div>

        <ion-list :inset="true">
          <ion-item button :detail="false" @click="addMember">
            <ion-icon slot="start" :icon="personAddOutline" color="primary" />
            <ion-label color="primary">Invite member</ion-label>
          </ion-item>
        </ion-list>

        <ion-list :inset="true">
          <ion-item button :detail="true" @click="openMedia">
            <ion-icon slot="start" :icon="imagesOutline" />
            <ion-label>Media, links & docs</ion-label>
          </ion-item>
          <ion-item button :detail="false" @click="searchInChat">
            <ion-icon slot="start" :icon="searchOutline" />
            <ion-label>Search in chat</ion-label>
          </ion-item>
          <ion-item button :detail="false" lines="none" @click="openMute">
            <ion-icon slot="start" :icon="muted ? notificationsOffOutline : notificationsOutline" />
            <ion-label>Notifications</ion-label>
            <ion-note slot="end">{{ muteLabel }}</ion-note>
          </ion-item>
        </ion-list>

        <ion-list v-if="invited.length" :inset="true">
          <ion-list-header><ion-label>Invited</ion-label></ion-list-header>
          <ion-item
            v-for="m in invited"
            :key="m.id"
            button
            :detail="false"
            @click="cancelInvite(m)"
          >
            <ion-avatar slot="start"><img :src="m.avatar" :alt="m.name" /></ion-avatar>
            <ion-label>
              {{ m.name }}
              <p>Invited · pending</p>
            </ion-label>
            <ion-icon slot="end" :icon="ellipsisHorizontal" color="medium" />
          </ion-item>
        </ion-list>

        <ion-list :inset="true">
          <ion-list-header><ion-label>Members</ion-label></ion-list-header>
          <ion-item lines="full">
            <ion-avatar slot="start"><img :src="selfAvatar" alt="You" /></ion-avatar>
            <ion-label>You</ion-label>
          </ion-item>
          <ion-item
            v-for="m in members"
            :key="m.id"
            button
            :detail="false"
            @click="memberOptions(m)"
          >
            <ion-avatar slot="start"><img :src="m.avatar" :alt="m.name" /></ion-avatar>
            <ion-label>{{ m.name }}</ion-label>
            <ion-icon slot="end" :icon="ellipsisHorizontal" color="medium" />
          </ion-item>
        </ion-list>

        <ion-list :inset="true">
          <ion-item button :detail="false" @click="leave">
            <ion-icon slot="start" :icon="exitOutline" color="danger" />
            <ion-label color="danger">Leave group</ion-label>
          </ion-item>
        </ion-list>

        <!-- Hidden picker for the group photo. -->
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="file-hidden"
          @change="onFile"
        />
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonList, IonListHeader, IonItem, IonLabel, IonIcon, IonNote,
  actionSheetController, alertController,
} from '@ionic/vue';
import {
  personAddOutline, exitOutline, createOutline, cameraOutline, ellipsisHorizontal,
  imagesOutline, searchOutline, notificationsOutline, notificationsOffOutline,
} from 'ionicons/icons';
import {
  getChat, listContacts, inviteToGroup, removeMember, leaveGroup,
  renameGroup, setGroupAvatar, clearGroupAvatar, setChatMute,
} from '@/db/queries';
import { getSecret } from '@/db/secrets';
import type { Chat, Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { initialsAvatar } from '@/db/avatars';

const route = useRoute();
const router = useRouter();
const chatId = route.params.id as string;

const chat = useLiveQuery<Chat | undefined>(() => getChat(chatId), ['chats'], undefined);
const allContacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);

const muted = computed(() => !!chat.value?.mutedUntil && chat.value.mutedUntil > Date.now());
const muteLabel = computed(() => {
  const until = chat.value?.mutedUntil ?? 0;
  if (until <= Date.now()) return 'On';
  if (until - Date.now() > 360 * 24 * 60 * 60 * 1000) return 'Muted';
  return `Muted until ${new Date(until).toLocaleDateString()}`;
});

function openMedia(): void {
  router.push(`/chat/${chatId}/media`);
}
function searchInChat(): void {
  router.push(`/chat/${chatId}?search=1`);
}
async function openMute(): Promise<void> {
  const HOUR = 60 * 60 * 1000;
  const buttons = muted.value
    ? [
        { text: 'Unmute', handler: () => void setChatMute(chatId, null) },
        { text: 'Cancel', role: 'cancel' as const },
      ]
    : [
        { text: 'Mute for 8 hours', handler: () => void setChatMute(chatId, Date.now() + 8 * HOUR) },
        { text: 'Mute for 1 week', handler: () => void setChatMute(chatId, Date.now() + 7 * 24 * HOUR) },
        { text: 'Mute always', handler: () => void setChatMute(chatId, Date.now() + 100 * 365 * 24 * HOUR) },
        { text: 'Cancel', role: 'cancel' as const },
      ];
  const sheet = await actionSheetController.create({ header: 'Notifications', buttons });
  await sheet.present();
}

const selfAvatar = ref(initialsAvatar('You'));
watch(
  chat,
  () => void getSecret('profileAvatar', '').then((a) => (selfAvatar.value = a || initialsAvatar('You'))),
  { immediate: true },
);

// Member profiles (resolve participant ids → contacts).
const members = computed(() =>
  (chat.value?.participantIds ?? []).map((id) => {
    const c = allContacts.value.find((x) => x.id === id);
    return { id, name: c?.name ?? id.slice(0, 8), avatar: c?.avatar ?? initialsAvatar(c?.name ?? '?') };
  }),
);

async function rename(): Promise<void> {
  const alert = await alertController.create({
    header: 'Group name',
    message: 'Leave blank to use the members’ names.',
    inputs: [
      {
        name: 'name',
        type: 'text',
        value: chat.value?.autoName ? '' : (chat.value?.name ?? ''),
        placeholder: 'Group name',
        attributes: { maxlength: 60 },
      },
    ],
    buttons: [
      { text: 'Cancel', role: 'cancel' as const },
      {
        text: 'Save',
        handler: (data: { name?: string }) => {
          void renameGroup(chatId, (data?.name ?? '').trim());
        },
      },
    ],
  });
  await alert.present();
}

const fileInput = ref<HTMLInputElement>();

async function editPhoto(): Promise<void> {
  const buttons = [
    { text: 'Change photo', handler: () => fileInput.value?.click() },
    ...(chat.value?.customAvatar
      ? [{ text: 'Reset to default', role: 'destructive' as const, handler: () => void clearGroupAvatar(chatId) }]
      : []),
    { text: 'Cancel', role: 'cancel' as const },
  ];
  const sheet = await actionSheetController.create({ header: 'Group photo', buttons });
  await sheet.present();
}

function onFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => void setGroupAvatar(chatId, String(reader.result));
  reader.readAsDataURL(file);
}

// Members added after creation are INVITED, not added immediately; they must
// accept before they join and start receiving messages (see inviteToGroup).
async function addMember(): Promise<void> {
  const taken = new Set([...(chat.value?.participantIds ?? []), ...(chat.value?.invitedIds ?? [])]);
  const eligible = allContacts.value.filter((c) => !taken.has(c.id));
  if (eligible.length === 0) return;
  const sheet = await actionSheetController.create({
    header: 'Invite member',
    buttons: [
      ...eligible.map((c) => ({ text: c.name, handler: () => void inviteToGroup(chatId, c.id) })),
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

// Invited-but-not-joined members (pending acceptance).
const invited = computed(() =>
  (chat.value?.invitedIds ?? []).map((id) => {
    const c = allContacts.value.find((x) => x.id === id);
    return { id, name: c?.name ?? id.slice(0, 8), avatar: c?.avatar ?? initialsAvatar(c?.name ?? '?') };
  }),
);

async function cancelInvite(m: { id: string; name: string }): Promise<void> {
  const sheet = await actionSheetController.create({
    header: m.name,
    buttons: [
      {
        text: 'Cancel invitation',
        role: 'destructive' as const,
        handler: () => void removeMember(chatId, m.id),
      },
      { text: 'Close', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

async function memberOptions(m: { id: string; name: string }): Promise<void> {
  const sheet = await actionSheetController.create({
    header: m.name,
    buttons: [
      {
        text: 'Remove from group',
        role: 'destructive' as const,
        handler: () => void removeMember(chatId, m.id),
      },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

async function leave(): Promise<void> {
  const sheet = await actionSheetController.create({
    header: `Leave "${chat.value?.name ?? 'group'}"?`,
    buttons: [
      {
        text: 'Leave group',
        role: 'destructive',
        handler: () => {
          void leaveGroup(chatId).then(() => router.replace('/tabs/chats'));
        },
      },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}
</script>

<style scoped>
.profile {
  padding: 24px 16px 8px;
}
.avatar-btn {
  position: relative;
  display: inline-block;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.profile-avatar {
  width: 96px;
  height: 96px;
  margin: 0 auto 12px;
}
.cam {
  position: absolute;
  right: -2px;
  bottom: 8px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--ion-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  border: 2px solid var(--ion-background-color, #fff);
}
.name-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
}
.name-btn h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.name-btn ion-icon {
  font-size: 18px;
  color: var(--app-text-muted);
}
.profile p {
  margin: 4px 0 0;
  color: var(--app-text-muted);
}
.file-hidden {
  display: none;
}
</style>
