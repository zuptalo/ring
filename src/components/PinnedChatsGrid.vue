<template>
  <!-- iMessage-style pinned chats (specs 1044 + 1045): large circular avatars in a
       3-column grid above the list, in the USER'S order. Tap opens the chat. A short
       press-and-hold lifts a tile into the page's drag controller (rearrange /
       drag-out-to-unpin); holding still opens the peek. Right-click (desktop) keeps
       the full actions sheet — on touch the peek's menu (incl. More…) replaced it.
       The TransitionGroup FLIP-animates tiles as the drag's preview gap moves. -->
  <TransitionGroup ref="root" tag="div" name="pin" class="pin-grid" role="list" aria-label="Pinned chats">
    <template v-for="id in displayIds" :key="id">
      <!-- The dragged chat's slot: an empty well under the floating proxy. Keyed as
           the chat so the gap itself is what FLIP moves around the grid. -->
      <div v-if="id === dragId" class="pin-tile pin-ghost" role="listitem" aria-hidden="true">
        <div class="pin-avatar pin-well" />
      </div>
      <button
        v-else-if="byId[id]"
        type="button"
        class="pin-tile"
        role="listitem"
        :aria-label="byId[id].name"
        :data-chat-id="id"
        @click="$emit('open', id)"
        @pointerdown="$emit('press', byId[id], $event)"
        @contextmenu.prevent="$emit('more', byId[id])"
      >
        <div class="pin-avatar">
          <user-avatar :src="byId[id].avatar" :alt="byId[id].name" :attention="byId[id].unread > 0" />
          <ion-badge v-if="byId[id].unread" color="primary" class="pin-badge">{{ byId[id].unread }}</ion-badge>
          <span v-else-if="byId[id].manualUnread" class="pin-dot" aria-hidden="true" />
        </div>
        <span class="pin-name" dir="auto">{{ byId[id].name }}</span>
      </button>
    </template>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonBadge } from '@ionic/vue';
import UserAvatar from '@/components/UserAvatar.vue';
import type { Chat } from '@/db/types';

const props = defineProps<{
  /** Pinned chats in the user's (rank) order. */
  chats: Chat[];
  /** Render order mid-drag (the live gap); falls back to `chats`' order. */
  displayOrder?: string[];
  /** The chat currently riding the floating proxy (its slot renders as a well). */
  dragId?: string | null;
}>();
defineEmits<{
  (e: 'open', id: string): void;
  (e: 'more', chat: Chat): void;
  (e: 'press', chat: Chat, ev: PointerEvent): void;
}>();

const byId = computed(() => {
  const m: Record<string, Chat> = {};
  for (const c of props.chats) m[c.id] = c;
  return m;
});
// Ids to render: the drag preview order when given, else the true order. Foreign
// ids (a list row hovering in) have no chat here — they render as the ghost well.
const displayIds = computed(() => {
  const order = props.displayOrder ?? props.chats.map((c) => c.id);
  return order.filter((id) => byId.value[id] || id === props.dragId);
});

// The grid's root element, for the page's drag controller hit-testing. The ref
// lands on the TransitionGroup component; its $el is the rendered .pin-grid div.
const root = ref<{ $el: HTMLElement } | null>(null);
defineExpose({
  el: (): HTMLElement | null => root.value?.$el ?? null,
});
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
  /* A press-and-hold must lift the tile, never select its label or pop the iOS
     callout — the gesture owns the long press now. */
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
/* FLIP: tiles glide to their new slot as the drag gap moves. */
.pin-move {
  transition: transform 0.2s ease;
}
.pin-avatar {
  position: relative;
  width: 88px;
  height: 88px;
}
/* The empty well left behind by (or opening up for) the floating avatar. */
.pin-well {
  border-radius: 50%;
  background: color-mix(in srgb, var(--app-text, #000) 8%, transparent);
}
.pin-ghost .pin-name {
  visibility: hidden;
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
