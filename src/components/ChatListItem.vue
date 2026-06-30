<template>
  <!-- One chat row + its swipe actions. Reused by the Chats tab, the Archived view,
       and the filtered lists. Quick actions live on the swipe; the full set is in the
       per-chat "More" sheet (opened via the `more` emit). -->
  <ion-item-sliding ref="sliding">
    <!-- Start side (swipe right): Mark Unread/Read + Pin/Unpin. Icon-over-label like
         WhatsApp. The label names the action: "Read" when it'll clear unread, else
         "Unread"; "Unpin" when pinned, else "Pin". -->
    <ion-item-options side="start">
      <ion-item-option color="success" @click="toggleRead">
        <ion-icon slot="top" :icon="unread ? mailOpenOutline : mailUnreadOutline" />
        {{ unread ? 'Read' : 'Unread' }}
      </ion-item-option>
      <ion-item-option color="medium" @click="togglePin">
        <ion-icon slot="top" :icon="pinOutline" :class="{ 'pin-off': chat.pinned }" />
        {{ chat.pinned ? 'Unpin' : 'Pin' }}
      </ion-item-option>
    </ion-item-options>

    <ion-item button :detail="false" :class="{ 'hidden-row': isHidden }" @click="$emit('open', chat.id)">
      <div class="avatar-wrap" slot="start">
        <ion-avatar>
          <img :src="chat.avatar" :alt="chat.name" />
        </ion-avatar>
        <span v-if="isOnline" class="presence-dot" aria-hidden="true" />
      </div>
      <ion-label>
        <h2>{{ chat.name }}</h2>
        <p class="preview-row">
          <template v-if="activityLabel">
            <span class="preview activity">{{ activityLabel }}</span>
          </template>
          <!-- An unsent draft trumps the last message so you can see where you left off. -->
          <template v-else-if="draft !== undefined">
            <span class="draft-tag">Draft</span>
            <span class="preview draft-text">{{ draft ? ': ' + draft : '' }}</span>
          </template>
          <template v-else>
            <ion-icon
              v-if="previewIcon"
              :icon="previewIcon"
              class="preview-ico"
              aria-hidden="true"
            />
            <span class="preview">{{ chat.lastMessage }}</span>
          </template>
        </p>
      </ion-label>
      <div class="meta" slot="end">
        <ion-note :class="{ unread: unread }">{{ formatTime(chat.lastMessageTime) }}</ion-note>
        <div class="meta-icons">
          <ion-icon v-if="isHidden" :icon="eyeOffOutline" class="meta-ico hidden-ico" aria-label="Hidden chat" />
          <ion-icon v-if="muted" :icon="notificationsOffOutline" class="meta-ico" aria-hidden="true" />
          <ion-icon v-if="chat.locked" :icon="lockClosedOutline" class="meta-ico" aria-hidden="true" />
          <ion-icon v-if="chat.pinned" :icon="pinOutline" class="meta-ico pin" aria-hidden="true" />
          <!-- spec 1020: a distinct "@" marker when this chat has an unread @mention,
               separate from the normal unread count beside it. -->
          <ion-badge v-if="chat.unreadMentions" color="primary" class="mention-badge" aria-label="You were mentioned">@</ion-badge>
          <ion-badge v-if="chat.unread" color="primary">{{ chat.unread }}</ion-badge>
          <span v-else-if="chat.manualUnread" class="unread-dot" aria-hidden="true" />
        </div>
      </div>
    </ion-item>

    <!-- End side (swipe left): More + Archive/Unarchive (icon-over-label). -->
    <ion-item-options side="end">
      <ion-item-option color="medium" @click="more">
        <ion-icon slot="top" :icon="ellipsisHorizontal" />
        More
      </ion-item-option>
      <ion-item-option color="success" @click="toggleArchive">
        <ion-icon slot="top" :icon="archiveOutline" />
        {{ chat.archived ? 'Unarchive' : 'Archive' }}
      </ion-item-option>
    </ion-item-options>
  </ion-item-sliding>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonItemSliding, IonItem, IonItemOptions, IonItemOption, IonAvatar, IonLabel, IonNote,
  IonBadge, IonIcon,
} from '@ionic/vue';
import {
  pinOutline, archiveOutline, ellipsisHorizontal, mailOpenOutline, mailUnreadOutline,
  notificationsOffOutline, lockClosedOutline, eyeOffOutline,
  cameraOutline, videocamOutline, micOutline, documentOutline, imagesOutline,
  locationOutline, barChartOutline, personOutline, musicalNotesOutline, callOutline,
} from 'ionicons/icons';
import {
  markChatRead, markChatUnread, setChatPinned, setChatArchived, MAX_PINNED_CHATS,
} from '@/db/queries';
import { appToast } from '@/services/toast';
import { isHiddenId } from '@/services/hidden-state';
import { peerPresence } from '@/composables/usePresence';
import { activityFor, activityKindLabel } from '@/composables/useTyping';
import { formatTime } from '@/utils/time';
import type { Chat } from '@/db/types';

const props = defineProps<{ chat: Chat; draft?: string }>();
const emit = defineEmits<{ (e: 'open', id: string): void; (e: 'more', chat: Chat): void }>();

const sliding = ref<{ $el: HTMLIonItemSlidingElement } | null>(null);
function closeSwipe(): void {
  void (sliding.value?.$el as HTMLIonItemSlidingElement | undefined)?.close?.();
}

const PREVIEW_ICONS: Record<NonNullable<Chat['lastKind']>, string | null> = {
  image: cameraOutline, video: videocamOutline, videonote: videocamOutline, voice: micOutline,
  file: documentOutline, album: imagesOutline, location: locationOutline,
  poll: barChartOutline, contact: personOutline, audio: musicalNotesOutline, call: callOutline,
  text: null, reaction: null,
};
const previewIcon = computed(() => (props.chat.lastKind ? PREVIEW_ICONS[props.chat.lastKind] : null));

// A hidden chat only ever appears in the list during an active reveal session
// (listChats excludes it otherwise), so membership here is enough to mark it. Keyed
// on the chat id so it re-evaluates when the list re-queries on reveal/relock/hide.
const isHidden = computed(() => isHiddenId(props.chat.id));
const unread = computed(() => props.chat.unread > 0 || !!props.chat.manualUnread);
const muted = computed(() => !!props.chat.mutedUntil && props.chat.mutedUntil > Date.now());
const isOnline = computed(
  () => !props.chat.isGroup && !!peerPresence(props.chat.participantIds?.[0] ?? '')?.online,
);
// While the 1:1 peer is composing, the row shows their activity ("typing…",
// "recording audio…", …) in place of the last-message preview (spec 1009).
// Group rows keep the preview (per-sender group activity is US5).
const activityLabel = computed(() => {
  if (props.chat.isGroup) return '';
  const peer = props.chat.participantIds?.[0];
  if (!peer) return '';
  const list = activityFor(peer);
  return list.length ? activityKindLabel(list[0].kind) : '';
});

async function toggleRead(): Promise<void> {
  if (unread.value) await markChatRead(props.chat.id);
  else await markChatUnread(props.chat.id);
  closeSwipe();
}
async function togglePin(): Promise<void> {
  const ok = await setChatPinned(props.chat.id, !props.chat.pinned);
  if (!ok) {
    await appToast({
      message: `You can only pin ${MAX_PINNED_CHATS} chats.`,
      duration: 2200,
    });
  }
  closeSwipe();
}
async function toggleArchive(): Promise<void> {
  await setChatArchived(props.chat.id, !props.chat.archived);
  closeSwipe();
}
function more(): void {
  emit('more', props.chat);
  closeSwipe();
}
</script>

<style scoped>
.meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.meta-icons {
  display: flex;
  align-items: center;
  gap: 6px;
}
.meta-ico {
  font-size: 15px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
.meta-ico.pin {
  transform: rotate(45deg);
}
/* "@" mention marker: a circular badge so it reads as a symbol, not a count. */
.mention-badge {
  min-width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-weight: 700;
}
/* Revealed hidden chat: a faint tint on the whole row + an eye-off marker, so it's
   easy to tell apart from normal chats during a reveal session. Only renders while
   revealed (the row isn't in the list otherwise), so it leaks nothing when locked. */
.hidden-row {
  --background: var(--ring-hidden-tint, rgba(var(--ion-color-medium-rgb, 146, 148, 156), 0.1));
}
.hidden-ico {
  color: var(--ion-color-medium);
}
.unread-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--ion-color-primary, #10b981);
}
ion-note.unread {
  color: var(--ion-color-primary, #10b981);
}
/* Uniform-width swipe action buttons with a slightly larger icon. */
ion-item-option {
  min-width: 84px;
  font-size: 12px;
  --padding-start: 4px;
  --padding-end: 4px;
}
ion-item-option ion-icon {
  font-size: 26px;
  margin-bottom: 3px;
}
/* The Pin/Unpin swipe icon: same pin glyph, struck-through look when already pinned. */
.pin-off {
  opacity: 0.6;
}
.preview-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  height: 2.6em;
}
.preview-ico {
  flex: none;
  font-size: 16px;
  margin-top: 2px;
  color: var(--app-text-muted);
}
.preview.activity {
  color: var(--ion-color-primary, #10b981);
}
/* "Draft" marker on a chat with an unsent message — red, like the convention, with the text muted. */
.draft-tag {
  flex: none;
  margin-top: 1px;
  color: var(--ion-color-danger, #eb445a);
  font-weight: 600;
}
.draft-text {
  color: var(--app-text-muted);
}
.preview {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  white-space: normal;
  line-height: 1.3;
  /* RTL names/previews (Persian/Arabic/Hebrew) read correctly and hug the start edge. */
  unicode-bidi: plaintext;
  text-align: start;
}
ion-label h2 {
  /* Keep correct bidi CHARACTER order for RTL/mixed names (plaintext), but always
     LEFT-align the name in the chats list (incl. RTL names + group names), rather than
     start-aligning (which would right-align RTL). */
  unicode-bidi: plaintext;
  text-align: left;
  /* Never wrap the name to a second line (e.g. a long group title like "Kamran, Macbook &
     iPad" on a narrow screen) — keep it one line and truncate with an ellipsis. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.avatar-wrap {
  position: relative;
}
.presence-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--ion-color-success, #2dd36f);
  border: 2px solid var(--ion-background-color, #fff);
}
</style>
