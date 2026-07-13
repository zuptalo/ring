<template>
  <!-- Long-press chat peek (spec 1045): a read-only card of the latest messages with
       a small action menu beneath, iMessage-style. Strictly a LOCAL view — opening it
       never marks the chat read, sends no receipts, and triggers no downloads
       (pending media renders as its label/poster only). Tap the card to really open
       the chat; tap anywhere else to dismiss. -->
  <Teleport to="body">
    <Transition name="peek">
      <div v-if="isOpen && chat" class="peek-root">
        <div class="peek-backdrop" @click="$emit('dismiss')" />
        <div class="peek-stack" role="dialog" :aria-label="`Preview of ${chat.name}`">
          <div
            class="peek-card"
            role="button"
            :aria-label="`Open ${chat.name}`"
            tabindex="0"
            @click="$emit('open', chat.id)"
            @keydown.enter="$emit('open', chat.id)"
          >
            <div class="peek-head">
              <ion-avatar class="peek-av"><user-avatar :src="chat.avatar" :alt="chat.name" /></ion-avatar>
              <span class="peek-title" dir="auto">{{ chat.name }}</span>
            </div>
            <div class="peek-msgs">
              <p v-if="loaded && msgs.length === 0" class="peek-empty">No messages yet</p>
              <div
                v-for="m in msgs"
                :key="m.id"
                class="peek-row"
                :class="{ out: m.outgoing }"
              >
                <div class="peek-bubble" :class="{ out: m.outgoing }">
                  <span v-if="chat.isGroup && !m.outgoing" class="peek-sender" dir="auto">{{ m.senderName }}</span>
                  <img
                    v-if="!m.deleted && m.posterData"
                    class="peek-thumb"
                    :src="m.posterData"
                    :alt="m.kind"
                  />
                  <span v-if="m.deleted" class="peek-label">Message deleted</span>
                  <template v-else>
                    <span v-if="kindLabel(m)" class="peek-label">{{ kindLabel(m) }}</span>
                    <span v-if="m.kind === 'text' || m.body" class="peek-body" dir="auto">
                      <emoji-text :text="m.body" />
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- The action menu. Pin/Unpin honours the 9-pin cap with the existing
               toast; Delete confirms like the actions sheet; More… bridges to the
               full sheet so pinned chats keep Mute/Hide/Lock on touch (this gesture
               replaced their old long-press-for-sheet). -->
          <ion-list :inset="true" class="peek-menu" @click.stop>
            <ion-item button :detail="false" @click="togglePin">
              <ion-icon slot="start" :icon="pinOutline" />
              <ion-label>{{ chat.pinned ? 'Unpin' : 'Pin' }}</ion-label>
            </ion-item>
            <ion-item button :detail="false" @click="toggleUnread">
              <ion-icon slot="start" :icon="unread ? mailOpenOutline : mailUnreadOutline" />
              <ion-label>{{ unread ? 'Mark as Read' : 'Mark as Unread' }}</ion-label>
            </ion-item>
            <ion-item button :detail="false" @click="openMore">
              <ion-icon slot="start" :icon="ellipsisHorizontal" />
              <ion-label>More…</ion-label>
            </ion-item>
            <ion-item button :detail="false" @click="confirmRemove">
              <ion-icon slot="start" color="danger" :icon="chat.isGroup ? exitOutline : trashOutline" />
              <ion-label color="danger">{{ chat.isGroup ? 'Exit group' : 'Delete' }}</ion-label>
            </ion-item>
          </ion-list>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  IonList, IonItem, IonLabel, IonIcon, IonAvatar, actionSheetController,
} from '@ionic/vue';
import {
  pinOutline, mailOpenOutline, mailUnreadOutline, trashOutline, exitOutline,
  ellipsisHorizontal,
} from 'ionicons/icons';
import UserAvatar from '@/components/UserAvatar.vue';
import EmojiText from '@/components/EmojiText.vue';
import {
  listMessagesOlder, setChatPinned, markChatRead, markChatUnread, deleteChat, leaveGroup,
  MAX_PINNED_CHATS,
} from '@/db/queries';
import { mediaPreview } from '@/services/message-preview';
import { appToast } from '@/services/toast';
import { GAMES } from '@/games/registry';
import type { Chat, Message } from '@/db/types';

const PEEK_MESSAGES = 15; // about a screenful; the card scrolls if tall

const props = defineProps<{ chat: Chat | null; isOpen: boolean }>();
const emit = defineEmits<{
  (e: 'dismiss'): void;
  (e: 'open', id: string): void;
  (e: 'more', chat: Chat): void;
}>();

const msgs = ref<Message[]>([]);
const loaded = ref(false);
watch(
  () => [props.isOpen, props.chat?.id] as const,
  async ([open, id]) => {
    if (!open || !id) return;
    loaded.value = false;
    msgs.value = await listMessagesOlder(id, null, PEEK_MESSAGES); // oldest→newest
    loaded.value = true;
  },
);

const unread = computed(() => !!props.chat && (props.chat.unread > 0 || !!props.chat.manualUnread));

/** The muted label line for non-text kinds ("" for plain text bubbles). */
function kindLabel(m: Message): string {
  switch (m.kind) {
    case 'text':
      return '';
    case 'location':
      return m.location?.label || 'Location';
    case 'poll':
      return m.poll?.question || 'Poll';
    case 'contact':
      return m.contact?.name || 'Contact';
    case 'game':
    case 'gamechallenge':
      return m.game ? GAMES[m.game.gameType]?.displayName ?? 'Game' : 'Game';
    case 'call':
      return 'Call';
    default:
      // Media kinds: label + duration; the body (caption) renders separately below.
      return mediaPreview(m.kind, m.durationSec, m.body || undefined, m.videoNote);
  }
}

async function togglePin(): Promise<void> {
  if (!props.chat) return;
  const ok = await setChatPinned(props.chat.id, !props.chat.pinned);
  if (!ok) {
    await appToast({ message: `You can only pin ${MAX_PINNED_CHATS} chats.`, duration: 2200 });
  }
  emit('dismiss');
}

async function toggleUnread(): Promise<void> {
  if (!props.chat) return;
  if (unread.value) await markChatRead(props.chat.id);
  else await markChatUnread(props.chat.id);
  emit('dismiss');
}

function openMore(): void {
  if (props.chat) emit('more', props.chat);
}

async function confirmRemove(): Promise<void> {
  const c = props.chat;
  if (!c) return;
  const sheet = await actionSheetController.create({
    header: c.isGroup ? `Leave "${c.name}"?` : 'Delete this chat?',
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
.peek-root {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.peek-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.peek-stack {
  position: relative;
  width: min(92vw, 440px);
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.peek-card {
  background: var(--ion-background-color, #fff);
  border-radius: 18px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 140px;
  max-height: 55vh;
  cursor: pointer;
  box-shadow: 0 24px 60px -18px rgba(0, 0, 0, 0.55);
}
.peek-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 8px;
}
.peek-av {
  width: 30px;
  height: 30px;
}
.peek-title {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.peek-msgs {
  flex: 1;
  overflow: hidden; /* read-only peek: the newest messages fill from the bottom */
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 6px;
  padding: 4px 12px 14px;
}
.peek-empty {
  text-align: center;
  color: var(--ion-color-medium);
  margin: 24px 0;
}
.peek-row {
  display: flex;
  justify-content: flex-start;
}
.peek-row.out {
  justify-content: flex-end;
}
.peek-bubble {
  max-width: 78%;
  padding: 7px 11px;
  border-radius: 15px;
  background: var(--app-bubble-in);
  border: 1px solid color-mix(in srgb, var(--app-text, #000) 14%, transparent);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14.5px;
  line-height: 1.3;
}
.peek-bubble.out {
  background: var(--app-bubble-out);
}
.peek-sender {
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-primary);
}
.peek-thumb {
  max-width: 180px;
  max-height: 130px;
  border-radius: 10px;
  object-fit: cover;
}
.peek-label {
  color: var(--app-text-muted, var(--ion-color-medium));
  font-style: italic;
}
.peek-body {
  unicode-bidi: plaintext;
  text-align: start;
  overflow-wrap: anywhere;
}
.peek-menu {
  margin: 0;
  border-radius: 14px;
}
/* Enter/leave: quick iMessage-style pop. */
.peek-enter-active,
.peek-leave-active {
  transition: opacity 0.16s ease;
}
.peek-enter-active .peek-stack,
.peek-leave-active .peek-stack {
  transition: transform 0.16s ease;
}
.peek-enter-from,
.peek-leave-to {
  opacity: 0;
}
.peek-enter-from .peek-stack,
.peek-leave-to .peek-stack {
  transform: scale(0.92);
}
</style>
