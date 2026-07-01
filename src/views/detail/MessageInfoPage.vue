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
              v-if="isOutgoingMsg"
              class="tick"
              :icon="statusIcon(message.status)"
              :color="seenReceiptsOn && message.status === 'seen' ? 'primary' : undefined"
            />
          </ion-note>
        </ion-item>
      </ion-list>

      <!-- Disappearing message: exact time left + when it self-destructs (the bubble shows a melting
           face; the numbers live here). -->
      <ion-list :inset="true" v-if="message?.expiresAt">
        <ion-list-header>
          <ion-icon :icon="timeOutline" />
          <ion-label>Disappearing message</ion-label>
        </ion-list-header>
        <ion-item lines="inset">
          <ion-label>Disappears in</ion-label>
          <ion-note slot="end">{{ ttlLeftLabel }}</ion-note>
        </ion-item>
        <ion-item lines="none">
          <ion-label>Disappears at</ion-label>
          <ion-note slot="end">{{ formatTime(message.expiresAt) }}</ion-note>
        </ion-item>
      </ion-list>

      <!-- Media facts (quality · resolution · size · format · duration). Shown for
           media in BOTH directions — the metadata that used to sit on the bubble. -->
      <ion-list :inset="true" v-if="message && hasMediaMeta">
        <ion-list-header>
          <ion-icon :icon="informationCircleOutline" />
          <ion-label>Media</ion-label>
        </ion-list-header>
        <ion-item v-if="formatLabel" lines="inset">
          <ion-label>Format</ion-label>
          <ion-note slot="end">{{ formatLabel }}</ion-note>
        </ion-item>
        <ion-item v-if="resolution" lines="inset">
          <ion-label>Resolution</ion-label>
          <ion-note slot="end">{{ resolution }}</ion-note>
        </ion-item>
        <ion-item v-if="durationText" lines="inset">
          <ion-label>Duration</ion-label>
          <ion-note slot="end">{{ durationText }}</ion-note>
        </ion-item>
        <ion-item v-if="qualityText" lines="inset">
          <ion-label>Quality</ion-label>
          <ion-note slot="end">{{ qualityText }}</ion-note>
        </ion-item>
        <ion-item v-if="sizeText" lines="none">
          <ion-label>Size</ion-label>
          <ion-note slot="end">{{ sizeText }}</ion-note>
        </ion-item>
      </ion-list>

      <!-- Group: per-member Seen by / Delivered / Not yet delivered, covering every
           member of the roster (spec 1010 FR-006). Each tier shows a capped avatar
           stack (5 + "+N") plus the members' names. -->
      <template v-if="isGroup && isOutgoingMsg">
        <!-- Seen by — suppressed entirely when "Seen receipts" is off (reciprocity:
             you don't get to see others' seen on your own messages). -->
        <ion-list :inset="true" v-if="seenReceiptsOn">
          <ion-list-header>
            <ion-icon :icon="checkmarkDone" color="primary" />
            <ion-label>Seen by</ion-label>
          </ion-list-header>
          <ion-item lines="none">
            <div class="tier" v-if="seenByIds.length">
              <div class="avatar-stack">
                <ion-avatar v-for="id in stackIds(seenByIds)" :key="id">
                  <img :src="avatarFor(id)" :alt="nameFor(id)" />
                </ion-avatar>
                <span v-if="overflowCount(seenByIds)" class="stack-more">+{{ overflowCount(seenByIds) }}</span>
              </div>
              <ion-label class="ion-text-wrap names">{{ namesLine(seenByIds) }}</ion-label>
            </div>
            <ion-note v-else>No one yet</ion-note>
          </ion-item>
        </ion-list>

        <ion-list :inset="true">
          <ion-list-header>
            <ion-icon :icon="checkmarkDone" />
            <ion-label>Delivered</ion-label>
          </ion-list-header>
          <ion-item lines="none">
            <div class="tier" v-if="deliveredIds.length">
              <div class="avatar-stack">
                <ion-avatar v-for="id in stackIds(deliveredIds)" :key="id">
                  <img :src="avatarFor(id)" :alt="nameFor(id)" />
                </ion-avatar>
                <span v-if="overflowCount(deliveredIds)" class="stack-more">+{{ overflowCount(deliveredIds) }}</span>
              </div>
              <ion-label class="ion-text-wrap names">{{ namesLine(deliveredIds) }}</ion-label>
            </div>
            <ion-note v-else>No one yet</ion-note>
          </ion-item>
        </ion-list>

        <ion-list :inset="true">
          <ion-list-header>
            <ion-icon :icon="checkmark" />
            <ion-label>Not yet delivered</ion-label>
          </ion-list-header>
          <ion-item lines="none">
            <div class="tier" v-if="notDeliveredIds.length">
              <div class="avatar-stack">
                <ion-avatar v-for="id in stackIds(notDeliveredIds)" :key="id">
                  <img :src="avatarFor(id)" :alt="nameFor(id)" />
                </ion-avatar>
                <span v-if="overflowCount(notDeliveredIds)" class="stack-more">+{{ overflowCount(notDeliveredIds) }}</span>
              </div>
              <ion-label class="ion-text-wrap names">{{ namesLine(notDeliveredIds) }}</ion-label>
            </div>
            <ion-note v-else>Everyone has it</ion-note>
          </ion-item>
        </ion-list>
      </template>

      <!-- 1:1: simple status timeline (outgoing only — receipts don't apply to received). -->
      <ion-list :inset="true" v-else-if="message && isOutgoingMsg">
        <ion-item v-if="seenReceiptsOn && reached('seen')">
          <ion-icon slot="start" :icon="checkmarkDone" color="primary" />
          <ion-label>Seen</ion-label>
          <ion-note v-if="message.seenAt" slot="end">{{ formatTime(message.seenAt) }}</ion-note>
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
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonList, IonListHeader, IonItem, IonAvatar, IonLabel,
  IonNote, IonIcon,
} from '@ionic/vue';
import { checkmark, checkmarkDone, timeOutline, informationCircleOutline } from 'ionicons/icons';
import { getMessage, getChat, listContacts, getSetting } from '@/db/queries';
import { get } from '@/db/idb';
import { initialsAvatar } from '@/db/avatars';
import type { Chat, Contact, Media, Message, MessageStatus } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { isPreservedImageMime, qualityLabel } from '@/services/media-encode';
import { fileSizeLabel } from '@/utils/media-meta';
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

// Live countdown for a disappearing message (ticks each second while this page is open).
const nowMs = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => (tick = setInterval(() => (nowMs.value = Date.now()), 1000)));
onUnmounted(() => clearInterval(tick));
const ttlLeftLabel = computed(() => {
  const exp = message.value?.expiresAt;
  if (!exp) return '';
  let s = Math.max(0, Math.round((exp - nowMs.value) / 1000));
  if (s <= 0) return 'any moment';
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h) parts.push(`${s}s`); // show seconds only when under an hour
  return parts.join(' ');
});

// The on-device media record (for the MIME type → format label + preserved check).
// Re-runs once the message resolves and we learn its mediaId.
const media = useLiveQuery<Media | undefined>(
  () => (message.value?.mediaId ? get<Media>('media', message.value.mediaId) : Promise.resolve(undefined)),
  ['media'],
  undefined,
  () => message.value?.mediaId,
);

const isOutgoingMsg = computed(() => message.value?.outgoing === true);

// Media facts (formerly a badge on the bubble) — shown here for media in BOTH
// directions, so received media's quality/resolution/size is inspectable too.
const formatLabel = computed(() => {
  const mime = media.value?.mime;
  if (!mime) return '';
  const sub = mime.split('/')[1] ?? '';
  const friendly: Record<string, string> = { jpeg: 'JPEG', 'svg+xml': 'SVG', mpeg: 'MP3', quicktime: 'MOV', 'octet-stream': '' };
  return friendly[sub] ?? (sub ? sub.toUpperCase() : '');
});
const resolution = computed(() =>
  message.value?.mediaWidth && message.value?.mediaHeight ? `${message.value.mediaWidth}×${message.value.mediaHeight}` : '',
);
const durationText = computed(() => {
  const s = message.value?.durationSec;
  if (!s) return '';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
});
// GIF/WebP are always sent untouched, so "Original" is noise — drop it for those.
const qualityText = computed(() => {
  const q = message.value?.mediaQuality;
  const mime = media.value?.mime;
  if (!q || (mime && isPreservedImageMime(mime))) return '';
  return qualityLabel(q);
});
const sizeText = computed(() => fileSizeLabel(message.value?.mediaSize));
const hasMediaMeta = computed(
  () => !!(formatLabel.value || resolution.value || durationText.value || qualityText.value || sizeText.value),
);

// "Seen receipts" privacy preference (default on), reactive. Reciprocity DISPLAY
// gate (spec 1010 FR-009): when off, we don't render the seen tier on our own
// messages — seen members fall back into "Delivered" and the top tick isn't blue.
const seenReceiptsOn = useLiveQuery(
  () => getSetting<boolean>('privacy.seenReceipts', true),
  ['settings'],
  true,
);

// Per-member lists are a group concept; branch on the chat being a group rather
// than on the message carrying a receipts array, so the right panel shows even for
// an edge-case row and never shows for a stray 1:1 one.
const isGroup = computed(() => chat.value?.isGroup === true && !!message.value?.receipts);

const contactMap = computed(
  () => new Map(contacts.value.map((c) => [c.id, c])),
);
const nameFor = (id: string) => contactMap.value.get(id)?.name ?? 'Unknown';
// Fall back to a generated initials avatar (never an empty src → broken image) for
// members whose contact row was pruned (e.g. someone who left the group).
const avatarFor = (id: string) => contactMap.value.get(id)?.avatar || initialsAvatar(nameFor(id));

const receipts = computed(() => message.value?.receipts ?? []);
const participantIds = computed(() => chat.value?.participantIds ?? []);

// Seen by — only when seen receipts are on (otherwise the tier is suppressed and
// these members show as merely Delivered). Sorted by when they saw it.
const seenByIds = computed(() =>
  seenReceiptsOn.value
    ? receipts.value
        .filter((r) => r.seenAt)
        .sort((a, b) => (a.seenAt ?? 0) - (b.seenAt ?? 0))
        .map((r) => r.contactId)
    : [],
);
// Delivered but not (shown as) seen. With seen receipts off, every delivered
// member lands here (the seen tier is hidden).
const deliveredIds = computed(() =>
  receipts.value
    .filter((r) => r.deliveredAt && !(seenReceiptsOn.value && r.seenAt))
    .sort((a, b) => (a.deliveredAt ?? 0) - (b.deliveredAt ?? 0))
    .map((r) => r.contactId),
);
// Not yet delivered = every roster member with no delivered receipt (FR-011), so
// the three tiers together account for every member.
const notDeliveredIds = computed(() =>
  participantIds.value.filter(
    (id) => !receipts.value.some((r) => r.contactId === id && r.deliveredAt),
  ),
);

// Capped avatar stack (FR-006 / large-group edge case): show up to 5 avatars then
// a "+N" overflow, with the names listed alongside.
const STACK_CAP = 5;
const stackIds = (ids: string[]): string[] => ids.slice(0, STACK_CAP);
const overflowCount = (ids: string[]): number => Math.max(0, ids.length - STACK_CAP);
const namesLine = (ids: string[]): string => {
  const shown = ids.slice(0, STACK_CAP).map(nameFor);
  const extra = ids.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ');
};

const order: MessageStatus[] = ['pending', 'sent', 'delivered', 'seen'];
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
/* Overlapping avatar stack for each per-member tier; logical margins so it mirrors
   correctly in RTL. */
.tier {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 4px 0;
}
.avatar-stack {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.avatar-stack ion-avatar {
  width: 28px;
  height: 28px;
  border: 2px solid var(--ion-background-color, #fff);
  margin-inline-start: -8px;
}
.avatar-stack ion-avatar:first-child {
  margin-inline-start: 0;
}
.stack-more {
  margin-inline-start: 6px;
  font-size: 13px;
  opacity: 0.7;
}
.names {
  font-size: 14px;
}
</style>
