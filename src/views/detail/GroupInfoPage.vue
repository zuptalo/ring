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
              <user-avatar :src="chat.avatar" :alt="chat.name" />
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
          <ion-item button :detail="true" @click="openStarred">
            <ion-icon slot="start" :icon="starOutline" />
            <ion-label>Starred messages</ion-label>
          </ion-item>
          <ion-item button :detail="false" @click="searchInChat">
            <ion-icon slot="start" :icon="searchOutline" />
            <ion-label>Search in chat</ion-label>
          </ion-item>
          <ion-item button :detail="false" @click="openMute">
            <ion-icon slot="start" :icon="muted ? notificationsOffOutline : notificationsOutline" />
            <ion-label>Notifications</ion-label>
            <ion-note slot="end">{{ muteLabel }}</ion-note>
          </ion-item>
          <ion-item button :detail="false" @click="openTtl">
            <ion-icon slot="start" :icon="timerOutline" />
            <ion-label>Disappearing messages</ion-label>
            <ion-note slot="end">{{ ttlLabel }}</ion-note>
          </ion-item>
          <ion-item button :detail="false" @click="openQuality('photo')">
            <ion-icon slot="start" :icon="imagesOutline" />
            <ion-label>Photo quality</ion-label>
            <ion-note slot="end">{{ qualityLabel('photo') }}</ion-note>
          </ion-item>
          <ion-item button :detail="false" lines="none" @click="openQuality('video')">
            <ion-icon slot="start" :icon="videocamOutline" />
            <ion-label>Video quality</ion-label>
            <ion-note slot="end">{{ qualityLabel('video') }}</ion-note>
          </ion-item>
        </ion-list>

        <!-- Per-chat notification controls (spec 1015 US4/US5), same as 1:1 chats:
             web push, in-app banner, and how much a notification reveals. -->
        <ion-list v-if="chat" :inset="true">
          <ion-item>
            <ion-icon slot="start" :icon="notificationsOutline" />
            <ion-toggle :checked="notifyWebPush" @ion-change="setWebPush($event.detail.checked)">
              Web push
            </ion-toggle>
          </ion-item>
          <ion-item>
            <ion-icon slot="start" :icon="chatbubbleOutline" />
            <ion-toggle :checked="notifyInApp" @ion-change="setInApp($event.detail.checked)">
              In-app banners
            </ion-toggle>
          </ion-item>
          <ion-item button :detail="false" @click="chooseContent">
            <ion-icon slot="start" :icon="documentTextOutline" />
            <ion-label>Show content</ion-label>
            <ion-note slot="end">{{ contentLabel }}</ion-note>
          </ion-item>
          <!-- spec 1020: let an @mention break through even when this group is muted. -->
          <ion-item lines="none">
            <ion-icon slot="start" :icon="atOutline" />
            <ion-toggle :checked="notifyMentions" @ion-change="setMentions($event.detail.checked)">
              Notify for mentions even when muted
            </ion-toggle>
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
            <ion-avatar slot="start"><user-avatar :src="m.avatar" :alt="m.name" /></ion-avatar>
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
            <ion-avatar slot="start"><user-avatar :src="selfAvatar" :alt="selfName" /></ion-avatar>
            <ion-label>{{ selfName }} <span class="you-tag">(You)</span></ion-label>
          </ion-item>
          <ion-item
            v-for="m in members"
            :key="m.id"
            button
            :detail="false"
            @click="memberOptions(m)"
          >
            <ion-avatar slot="start"><user-avatar :src="m.avatar" :alt="m.name" /></ion-avatar>
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
import UserAvatar from '@/components/UserAvatar.vue';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonList, IonListHeader, IonItem, IonLabel, IonIcon, IonNote, IonToggle,
  actionSheetController, alertController,
} from '@ionic/vue';
import {
  personAddOutline, exitOutline, createOutline, cameraOutline, ellipsisHorizontal,
  imagesOutline, searchOutline, notificationsOutline, notificationsOffOutline, starOutline, timerOutline, atOutline,
  chatbubbleOutline, documentTextOutline, videocamOutline,
} from 'ionicons/icons';
import {
  getChat, listContacts, addMemberToGroup, removeMember, leaveGroup,
  renameGroup, setGroupAvatar, clearGroupAvatar, setChatMute, setChatTtl, setChatSendQuality,
  setChatNotifyPrefs, type ChatNotifyContent,
} from '@/db/queries';
import type { Chat, Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useSelfProfile } from '@/composables/useSelfProfile';
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

// Per-chat notification controls (spec 1015), identical to 1:1 chats.
const notifyWebPush = computed(() => chat.value?.notifyWebPush ?? true);
const notifyInApp = computed(() => chat.value?.notifyInApp ?? true);
const notifyMentions = computed(() => chat.value?.notifyMentions ?? true);
const notifyContent = computed<ChatNotifyContent>(() => chat.value?.notifyContent ?? 'full');
const CONTENT_LABELS: Record<ChatNotifyContent, string> = {
  full: 'Message content',
  generic: 'No preview',
  none: 'Badge only',
};
const contentLabel = computed(() => CONTENT_LABELS[notifyContent.value]);

async function setWebPush(on: boolean): Promise<void> {
  await setChatNotifyPrefs(chatId, { webPush: on });
}
async function setMentions(on: boolean): Promise<void> {
  await setChatNotifyPrefs(chatId, { mentions: on });
}
async function setInApp(on: boolean): Promise<void> {
  await setChatNotifyPrefs(chatId, { inApp: on });
}
async function chooseContent(): Promise<void> {
  const set = (content: ChatNotifyContent) => () => void setChatNotifyPrefs(chatId, { content });
  const sheet = await actionSheetController.create({
    header: 'Show in notifications',
    buttons: [
      { text: 'Message content', handler: set('full') },
      { text: 'No preview', handler: set('generic') },
      { text: 'Badge only (no banner)', handler: set('none') },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}

function openMedia(): void {
  router.push(`/chat/${chatId}/media`);
}
function openStarred(): void {
  router.push(`/chat/${chatId}/starred`);
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

const DAY = 24 * 60 * 60 * 1000;
const ttlLabel = computed(() => {
  const ms = chat.value?.defaultTtlMs ?? 0;
  if (!ms) return 'Off';
  if (ms === DAY) return '24 hours';
  if (ms === 7 * DAY) return '7 days';
  if (ms === 90 * DAY) return '90 days';
  return `${Math.round(ms / DAY)} days`;
});
async function openTtl(): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Disappearing messages',
    subHeader: 'New messages disappear for everyone after:',
    buttons: [
      { text: '24 hours', handler: () => void setChatTtl(chatId, DAY) },
      { text: '7 days', handler: () => void setChatTtl(chatId, 7 * DAY) },
      { text: '90 days', handler: () => void setChatTtl(chatId, 90 * DAY) },
      { text: 'Off', handler: () => void setChatTtl(chatId, null) },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

const QUALITY_ROWS = [
  { q: 'sd' as const, text: 'SD (smaller)' },
  { q: 'hd' as const, text: 'HD' },
  { q: 'fhd' as const, text: 'Full HD' },
  { q: 'original' as const, text: 'Original' },
];
function qualityLabel(kind: 'photo' | 'video'): string {
  const q = kind === 'photo' ? chat.value?.sendQualityPhoto : chat.value?.sendQualityVideo;
  return q ? (QUALITY_ROWS.find((r) => r.q === q)?.text ?? q) : 'Default';
}
async function openQuality(kind: 'photo' | 'video'): Promise<void> {
  const sheet = await actionSheetController.create({
    header: kind === 'photo' ? 'Photo quality' : 'Video quality',
    subHeader: `Quality for ${kind === 'photo' ? 'photos' : 'videos'} sent in this group:`,
    buttons: [
      ...QUALITY_ROWS.map((r) => ({ text: r.text, handler: () => void setChatSendQuality(chatId, kind, r.q) })),
      { text: 'Use global default', handler: () => void setChatSendQuality(chatId, kind, null) },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

// Our own chosen name + avatar for the self member row (reactive, app-wide).
const { name: selfName, avatar: selfAvatar } = useSelfProfile();

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

// The picker only offers existing contacts, who join immediately (membership is a
// natural extension of the contact relationship — like the people you pick at group
// creation). addMemberToGroup keeps an accept-first invite only for non-contacts.
async function addMember(): Promise<void> {
  const taken = new Set([...(chat.value?.participantIds ?? []), ...(chat.value?.invitedIds ?? [])]);
  const eligible = allContacts.value.filter((c) => !taken.has(c.id));
  if (eligible.length === 0) return;
  const sheet = await actionSheetController.create({
    header: 'Add member',
    buttons: [
      ...eligible.map((c) => ({ text: c.name, handler: () => void addMemberToGroup(chatId, c.id) })),
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
.you-tag {
  color: var(--ion-color-medium);
  font-size: 0.85em;
}
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
