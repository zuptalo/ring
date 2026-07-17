<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/contacts" />
        </ion-buttons>
        <ion-title>Contact info</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <template v-if="contact">
        <div class="profile ion-text-center">
          <ion-avatar class="profile-avatar">
            <user-avatar :src="contact.avatar" :alt="contact.name" />
          </ion-avatar>
          <h1>{{ contact.name }}</h1>
          <p v-if="contact.username" class="handle">@{{ contact.username }}</p>
          <p v-if="statusLine" class="status">{{ statusLine }}</p>
        </div>

        <p v-if="contact.ghosted" class="ghost-note">This account no longer exists.</p>

        <div v-if="!contact.ghosted" class="actions">
          <ion-button expand="block" :disabled="contact.blocked" @click="message">
            <ion-icon slot="start" :icon="chatbubbleOutline" />
            Message
          </ion-button>
          <ion-button expand="block" fill="outline" @click="searchInChat">
            <ion-icon slot="start" :icon="searchOutline" />
            Search in chat
          </ion-button>
        </div>

        <!-- Local name/photo override + a staged remote change to adopt. -->
        <ion-list v-if="!contact.ghosted" :inset="true">
          <ion-item v-if="contact.pendingName != null || contact.pendingAvatar != null" lines="full">
            <ion-icon slot="start" :icon="personOutline" color="primary" />
            <ion-label class="ion-text-wrap">
              <p>They updated their profile</p>
              <h2>{{ contact.pendingName ?? contact.name }}</h2>
            </ion-label>
            <ion-button slot="end" size="small" fill="clear" @click="dismissPending">Not now</ion-button>
            <ion-button slot="end" size="small" @click="adoptPending">Use it</ion-button>
          </ion-item>
          <ion-item button :detail="false" @click="editName">
            <ion-icon slot="start" :icon="createOutline" />
            <ion-label>Edit name</ion-label>
          </ion-item>
          <ion-item button :detail="false" @click="editPhoto">
            <ion-icon slot="start" :icon="cameraOutline" />
            <ion-label>Change photo</ion-label>
          </ion-item>
          <ion-item v-if="contact.localProfile" button :detail="false" @click="resetProfile">
            <ion-icon slot="start" :icon="refreshOutline" color="medium" />
            <ion-label>Reset to their name &amp; photo</ion-label>
          </ion-item>
        </ion-list>

        <ion-list v-if="!contact.ghosted && contact.about" :inset="true">
          <ion-item lines="none">
            <ion-label class="ion-text-wrap">
              <p>About</p>
              <h2>{{ contact.about }}</h2>
            </ion-label>
          </ion-item>
        </ion-list>

        <ion-list v-if="contact.username" :inset="true">
          <ion-item lines="none">
            <ion-label class="ion-text-wrap">
              <p>Username</p>
              <h2 class="ring-id">@{{ contact.username }}</h2>
            </ion-label>
            <ion-button slot="end" fill="clear" size="small" @click="copyUsername">Copy</ion-button>
          </ion-item>
        </ion-list>

        <ion-list v-if="!contact.ghosted && chat" :inset="true">
          <ion-item button :detail="true" @click="openMedia">
            <ion-icon slot="start" :icon="imagesOutline" />
            <ion-label>Media, links & docs</ion-label>
          </ion-item>
          <ion-item button :detail="true" @click="openStarred">
            <ion-icon slot="start" :icon="starOutline" />
            <ion-label>Starred messages</ion-label>
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
          <ion-item button :detail="false" @click="openQuality('video')">
            <ion-icon slot="start" :icon="videocamOutline" />
            <ion-label>Video quality</ion-label>
            <ion-note slot="end">{{ qualityLabel('video') }}</ion-note>
          </ion-item>
          <ion-item button :detail="false" lines="none" @click="openPresenceOverride">
            <ion-icon slot="start" :icon="eyeOutline" />
            <ion-label class="ion-text-wrap">Online & last seen to this contact</ion-label>
            <ion-note slot="end">{{ presenceOverrideLabel }}</ion-note>
          </ion-item>
        </ion-list>

        <!-- Per-chat notification controls (spec 1015 US4/US5): web push, in-app
             banner, and how much a notification reveals. Device-local; enforced
             client-side. "Badge only" reveals nothing, just bumps the unread count. -->
        <ion-list v-if="!contact.ghosted && chat" :inset="true">
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
          <ion-item button :detail="false" lines="none" @click="chooseContent">
            <ion-icon slot="start" :icon="documentTextOutline" />
            <ion-label>Show content</ion-label>
            <ion-note slot="end">{{ contentLabel }}</ion-note>
          </ion-item>
        </ion-list>

        <ion-list v-if="!contact.ghosted" :inset="true">
          <ion-item v-if="contact.blocked" button :detail="false" @click="unblock">
            <ion-icon slot="start" :icon="banOutline" />
            <ion-label>Unblock</ion-label>
          </ion-item>
          <ion-item v-else button :detail="false" class="danger" @click="block">
            <ion-icon slot="start" :icon="banOutline" color="danger" />
            <ion-label color="danger">Block contact</ion-label>
          </ion-item>
        </ion-list>

        <!-- An explicit, tap-only Delete (the Contacts-list swipe gesture is easy to
             miss and unreliable on iOS); available for ghosted contacts too. -->
        <ion-list :inset="true">
          <ion-item button :detail="false" class="danger" @click="confirmDelete">
            <ion-icon slot="start" :icon="trashOutline" color="danger" />
            <ion-label color="danger">Delete contact</ion-label>
          </ion-item>
        </ion-list>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonButton, IonIcon, IonList, IonItem, IonLabel, IonNote, IonToggle,
  alertController, actionSheetController, modalController,
} from '@ionic/vue';
import type { ActionSheetButton } from '@ionic/vue';
import {
  chatbubbleOutline, searchOutline, banOutline, imagesOutline, videocamOutline,
  notificationsOutline, notificationsOffOutline, starOutline, timerOutline, eyeOutline, documentTextOutline,
  createOutline, cameraOutline, imageOutline, happyOutline, refreshOutline, personOutline, trashOutline,
} from 'ionicons/icons';
import { computed } from 'vue';
import {
  getContact, startDirectChat, blockContact, unblockContact, listChats, setChatMute, setChatTtl, setChatSendQuality,
  getPresenceOverrides, setPresenceOverride, setChatNotifyPrefs, type ChatNotifyContent,
  setContactLocalProfile, resetContactToRemote, resetContactAvatarToRemote,
  adoptContactProfile, dismissContactProfile, downscaleAvatar,
  deleteContact,
} from '@/db/queries';
import { appToast } from '@/services/toast';
import { refetchContactProfile, refetchContactAvatar } from '@/services/directory';
import EmojiPickerModal from '@/components/EmojiPickerModal.vue';
import { emojiAvatar } from '@/db/avatars';
import { pickImageFile, fileToDataUrl } from '@/utils/pick-image';
import { ensureProfile } from '@/composables/useProfileGate';
import { forceReconnect } from '@/composables/useSync';
import type { Contact, Chat } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { peerPresence, presenceLabel } from '@/composables/usePresence';

const route = useRoute();
const router = useRouter();
const contactId = route.params.id as string;

// ---- local name/photo override + adopt a staged remote change ----
async function editName(): Promise<void> {
  const a = await alertController.create({
    header: 'Edit name',
    message: 'This name is stored only on your device.',
    inputs: [{ name: 'name', type: 'text', value: contact.value?.name ?? '', placeholder: 'Name' }],
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Save',
        handler: async (d: { name?: string }) => {
          const n = (d.name ?? '').trim();
          if (n) await setContactLocalProfile(contactId, { name: n });
        },
      },
    ],
  });
  await a.present();
}
// Take/choose a photo via the shared robust picker (same as the profile page —
// it handles the Android camera focus/`change` race so the captured photo isn't
// dropped). Photos keep the downscale treatment; emoji below must not.
async function pickPhoto(capture: boolean): Promise<void> {
  const file = await pickImageFile(capture);
  if (!file) return;
  try {
    const avatar = await downscaleAvatar(await fileToDataUrl(file));
    await setContactLocalProfile(contactId, { avatar });
  } catch {
    await appToast({ message: "Couldn't use that image.", color: 'danger' });
  }
}

// Pick an emoji as the contact's photo (spec 1054): stored VERBATIM as
// emojiAvatar's disc — never through downscaleAvatar, whose canvas re-encode
// would rasterize the SVG and strip the recoverable emoji (killing the
// animated rendering in UserAvatar).
async function pickEmoji(): Promise<void> {
  const modal = await modalController.create({
    component: EmojiPickerModal,
    cssClass: 'emoji-picker-sheet',
    breakpoints: [0, 0.6, 0.95],
    initialBreakpoint: 0.6,
  });
  await modal.present();
  const { data } = await modal.onWillDismiss<{ emoji?: string }>();
  if (!data?.emoji) return;
  await setContactLocalProfile(contactId, { avatar: emojiAvatar(data.emoji) });
}

// "Reset to their photo" is offered only when there is actually a local PHOTO
// override to undo (a name-only override doesn't count) and a published photo
// is known. Requiring `localProfile` keeps the entry from doubling as a hidden
// half-adopt when a STAGED remote change is what makes avatar ≠ remoteAvatar.
const photoOverridden = computed(
  () =>
    !!contact.value?.localProfile &&
    !!contact.value.remoteAvatar &&
    contact.value.avatar !== contact.value.remoteAvatar,
);

// Optimistic: revert to the last-known published photo (works offline), then
// re-pull the peer's CURRENT one. Photo only — a custom name stays.
async function resetPhoto(): Promise<void> {
  await resetContactAvatarToRemote(contactId);
  await refetchContactAvatar(contactId);
}

async function editPhoto(): Promise<void> {
  const buttons: ActionSheetButton[] = [
    { text: 'Take photo', icon: cameraOutline, handler: () => void pickPhoto(true) },
    { text: 'Choose photo', icon: imageOutline, handler: () => void pickPhoto(false) },
    { text: 'Pick an emoji', icon: happyOutline, handler: () => void pickEmoji() },
  ];
  if (photoOverridden.value) {
    buttons.push({ text: 'Reset to their photo', icon: refreshOutline, handler: () => void resetPhoto() });
  }
  buttons.push({ text: 'Cancel', role: 'cancel' });
  const sheet = await actionSheetController.create({ header: 'Edit photo', buttons });
  await sheet.present();
}

async function resetProfile(): Promise<void> {
  // Optimistic: drop the override + revert to the last-known remote (works offline),
  // then re-pull the peer's CURRENT name/photo from the directory and apply it.
  await resetContactToRemote(contactId);
  await refetchContactProfile(contactId);
}
async function adoptPending(): Promise<void> {
  await adoptContactProfile(contactId);
}
async function dismissPending(): Promise<void> {
  await dismissContactProfile(contactId);
}

const contact = useLiveQuery<Contact | undefined>(
  () => getContact(contactId),
  ['contacts'],
  undefined,
);

// The existing 1:1 chat with this contact (if any) - drives the media + mute entries.
const chat = useLiveQuery<Chat | undefined>(
  async () =>
    (await listChats()).find(
      (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === contactId,
    ),
  ['chats'],
  undefined,
);

const muted = computed(() => !!chat.value?.mutedUntil && chat.value.mutedUntil > Date.now());
const muteLabel = computed(() => {
  const until = chat.value?.mutedUntil ?? 0;
  if (until <= Date.now()) return 'On';
  // A year+ out reads as "always"; otherwise show the date it lifts.
  if (until - Date.now() > 360 * 24 * 60 * 60 * 1000) return 'Muted';
  return `Muted until ${new Date(until).toLocaleDateString()}`;
});

// Per-chat notification controls (spec 1015). Derived from the (live-queried) chat
// record with the pre-1015 defaults applied, so toggling writes through
// setChatNotifyPrefs and the liveQuery re-renders.
const notifyWebPush = computed(() => chat.value?.notifyWebPush ?? true);
const notifyInApp = computed(() => chat.value?.notifyInApp ?? true);
const notifyContent = computed<ChatNotifyContent>(() => chat.value?.notifyContent ?? 'full');
const CONTENT_LABELS: Record<ChatNotifyContent, string> = {
  full: 'Message content',
  generic: 'No preview',
  none: 'Badge only',
};
const contentLabel = computed(() => CONTENT_LABELS[notifyContent.value]);

async function setWebPush(on: boolean): Promise<void> {
  if (chat.value) await setChatNotifyPrefs(chat.value.id, { webPush: on });
}
async function setInApp(on: boolean): Promise<void> {
  if (chat.value) await setChatNotifyPrefs(chat.value.id, { inApp: on });
}
async function chooseContent(): Promise<void> {
  if (!chat.value) return;
  const set = (content: ChatNotifyContent) => () => void setChatNotifyPrefs(chat.value!.id, { content });
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

// Online / last-seen line under the name ('' when unknown / hidden).
const statusLine = computed(() => presenceLabel(peerPresence(contactId)));

function openMedia(): void {
  if (chat.value) router.push(`/chat/${chat.value.id}/media`);
}

function openStarred(): void {
  if (chat.value) router.push(`/chat/${chat.value.id}/starred`);
}

async function openMute(): Promise<void> {
  const id = chat.value?.id;
  if (!id) return;
  const HOUR = 60 * 60 * 1000;
  const buttons = muted.value
    ? [
        { text: 'Unmute', handler: () => void setChatMute(id, null) },
        { text: 'Cancel', role: 'cancel' as const },
      ]
    : [
        { text: 'Mute for 8 hours', handler: () => void setChatMute(id, Date.now() + 8 * HOUR) },
        { text: 'Mute for 1 week', handler: () => void setChatMute(id, Date.now() + 7 * 24 * HOUR) },
        { text: 'Mute always', handler: () => void setChatMute(id, Date.now() + 100 * 365 * 24 * HOUR) },
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
  const id = chat.value?.id;
  if (!id) return;
  const sheet = await actionSheetController.create({
    header: 'Disappearing messages',
    subHeader: 'New messages disappear for everyone after:',
    buttons: [
      { text: '24 hours', handler: () => void setChatTtl(id, DAY) },
      { text: '7 days', handler: () => void setChatTtl(id, 7 * DAY) },
      { text: '90 days', handler: () => void setChatTtl(id, 90 * DAY) },
      { text: 'Off', handler: () => void setChatTtl(id, null) },
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
// Per-chat send-quality override for a kind (photos vs videos). "Default" clears it back to the
// global Upload-quality setting for that kind.
function qualityLabel(kind: 'photo' | 'video'): string {
  const q = kind === 'photo' ? chat.value?.sendQualityPhoto : chat.value?.sendQualityVideo;
  return q ? (QUALITY_ROWS.find((r) => r.q === q)?.text ?? q) : 'Default';
}
async function openQuality(kind: 'photo' | 'video'): Promise<void> {
  const id = chat.value?.id;
  if (!id) return;
  const sheet = await actionSheetController.create({
    header: kind === 'photo' ? 'Photo quality' : 'Video quality',
    subHeader: `Quality for ${kind === 'photo' ? 'photos' : 'videos'} sent in this chat:`,
    buttons: [
      ...QUALITY_ROWS.map((r) => ({ text: r.text, handler: () => void setChatSendQuality(id, kind, r.q) })),
      { text: 'Use global default', handler: () => void setChatSendQuality(id, kind, null) },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

// Per-contact presence override (on top of the global online/last-seen setting).
const presenceOverride = useLiveQuery<'allow' | 'deny' | undefined>(
  async () => (await getPresenceOverrides())[contactId],
  ['settings'],
  undefined,
);
const presenceOverrideLabel = computed(() =>
  presenceOverride.value === 'allow' ? 'Always shown' : presenceOverride.value === 'deny' ? 'Hidden' : 'Default',
);
async function openPresenceOverride(): Promise<void> {
  const sheet = await actionSheetController.create({
    header: 'Online & last seen',
    subHeader: 'Override your global setting for this contact:',
    buttons: [
      { text: 'Use my default setting', handler: () => void setPresenceOverride(contactId, null) },
      { text: 'Always show to this contact', handler: () => void setPresenceOverride(contactId, 'allow') },
      { text: 'Always hide from this contact', handler: () => void setPresenceOverride(contactId, 'deny') },
      { text: 'Cancel', role: 'cancel' as const },
    ],
  });
  await sheet.present();
}

// Open (or create) the 1:1 chat with this contact.
async function message() {
  const c = contact.value;
  if (!c) return;
  if (!(await ensureProfile())) return; // require a name + photo before messaging
  router.push(`/chat/${await startDirectChat(c)}`);
}

// Open the chat straight into in-conversation search (?search=1).
async function searchInChat() {
  const c = contact.value;
  if (!c) return;
  router.push(`/chat/${await startDirectChat(c)}?search=1`);
}

// Block this contact (server-enforced): confirm, then they can't message or re-add us.
async function block() {
  const alert = await alertController.create({
    header: 'Block contact?',
    message: 'They will no longer be able to message you or add you. You can unblock them later.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Block',
        role: 'destructive',
        handler: () => {
          void (async () => {
            try {
              await blockContact(contactId);
            } catch {
              void appToast({ message: 'Could not block. Try again.', duration: 1500, color: 'danger' });
            }
          })();
        },
      },
    ],
  });
  await alert.present();
}

async function confirmDelete() {
  const alert = await alertController.create({
    header: 'Delete contact?',
    message:
      'This removes them from your contacts and deletes this conversation on this device. It cannot be undone.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete',
        role: 'destructive',
        handler: () => {
          void (async () => {
            try {
              await deleteContact(contactId);
              // The contact (and its page) no longer exist → return to the list.
              router.replace('/tabs/contacts');
            } catch {
              void appToast({ message: 'Could not delete. Try again.', duration: 1500, color: 'danger' });
            }
          })();
        },
      },
    ],
  });
  await alert.present();
}

async function unblock() {
  const alert = await alertController.create({
    header: 'Unblock contact?',
    message: 'They will be able to message you and add you again, and any messages they sent while blocked will be delivered.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Unblock',
        handler: () => {
          void (async () => {
            try {
              await unblockContact(contactId);
              // Force a reconnect so the server flushes the messages it held while
              // blocked (the offline queue only flushes on connect).
              forceReconnect();
            } catch {
              void appToast({ message: 'Could not unblock. Try again.', duration: 1500, color: 'danger' });
            }
          })();
        },
      },
    ],
  });
  await alert.present();
}

function copyUsername() {
  if (!contact.value?.username) return;
  void navigator.clipboard?.writeText(`@${contact.value.username}`);
  void appToast({ message: 'Username copied', duration: 1200 });
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
.profile .handle {
  margin: 2px 0 0;
  font-size: 14px;
  color: var(--ion-color-primary);
  font-weight: 500;
}
.profile .status {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--app-text-muted);
}
.actions {
  max-width: 420px;
  margin: 8px auto 0;
  padding: 0 16px;
}
.ring-id {
  font-size: 0.8rem;
  word-break: break-all;
}
.ghost-note {
  text-align: center;
  margin: 4px 16px 0;
  font-size: 13px;
  color: var(--app-text-muted);
}
</style>
