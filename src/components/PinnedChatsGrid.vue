<template>
  <!-- iMessage-style pinned chats (spec 1044): large circular avatars in a 3-column
       grid above the list. Tap opens the chat; LONG-PRESS opens the actions sheet —
       pinned chats leave the list rows, so the row's swipe gestures can't reach
       them and the sheet (with its Pin/Unpin action) is their management surface. -->
  <div class="pin-grid" role="list" aria-label="Pinned chats">
    <button
      v-for="chat in chats"
      :key="chat.id"
      type="button"
      class="pin-tile"
      role="listitem"
      :aria-label="chat.name"
      :data-chat-id="chat.id"
      @click="onTap(chat)"
      @pointerdown="pressStart(chat)"
      @pointerup="pressEnd"
      @pointercancel="pressEnd"
      @contextmenu.prevent="$emit('more', chat)"
    >
      <div class="pin-avatar">
        <user-avatar :src="chat.avatar" :alt="chat.name" :attention="chat.unread > 0" />
        <ion-badge v-if="chat.unread" color="primary" class="pin-badge">{{ chat.unread }}</ion-badge>
        <span v-else-if="chat.manualUnread" class="pin-dot" aria-hidden="true" />
      </div>
      <span class="pin-name">{{ chat.name }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { IonBadge } from '@ionic/vue';
import UserAvatar from '@/components/UserAvatar.vue';
import type { Chat } from '@/db/types';

defineProps<{ chats: Chat[] }>();
const emit = defineEmits<{ (e: 'open', id: string): void; (e: 'more', chat: Chat): void }>();

// Long-press → the actions sheet; a completed long-press swallows the click that
// follows on pointerup so the chat doesn't ALSO open underneath the sheet.
const LONG_PRESS_MS = 500;
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressed = false;

function pressStart(chat: Chat): void {
  longPressed = false;
  pressTimer = setTimeout(() => {
    longPressed = true;
    emit('more', chat);
  }, LONG_PRESS_MS);
}
function pressEnd(): void {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = null;
}
function onTap(chat: Chat): void {
  if (longPressed) {
    longPressed = false;
    return;
  }
  emit('open', chat.id);
}
</script>

<style scoped>
.pin-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  row-gap: 12px;
  padding: 12px 8px 4px;
}
.pin-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  min-width: 0; /* let the name ellipsize instead of widening the column */
}
.pin-avatar {
  position: relative;
  width: 72px;
  height: 72px;
}
.pin-badge {
  position: absolute;
  top: -2px;
  inset-inline-end: -6px;
  border-radius: 10px;
}
.pin-dot {
  position: absolute;
  top: 2px;
  inset-inline-end: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ion-color-primary);
}
.pin-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ion-text-color);
}
</style>
