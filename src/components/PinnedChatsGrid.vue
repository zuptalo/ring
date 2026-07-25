<template>
  <!-- iMessage-style pinned chats (specs 1044 + 1045): large circular avatars in a
       3-column grid above the list, in the USER'S order. Tap opens the chat. A short
       press-and-hold lifts a tile into the page's drag controller (rearrange /
       drag-out-to-unpin); holding still opens the peek. Right-click (desktop) keeps
       the full actions sheet — on touch the peek's menu (incl. More…) replaced it.
       The TransitionGroup FLIP-animates tiles as the drag's preview gap moves. -->
  <TransitionGroup ref="root" tag="div" name="pin" class="pin-grid" role="list" aria-label="Pinned chats">
    <template v-for="id in displayIds" :key="id">
      <!-- A member tile. While it's the one riding the drag proxy it renders as the
           ghost well via CSS ONLY — the BUTTON MUST STAY MOUNTED: iOS stops
           delivering the gesture's touch/pointer events the moment their original
           target leaves the DOM, which froze the drag (and let the peek timer fire
           mid-drag). Keyed as the chat so FLIP moves the gap around the grid. -->
      <button
        v-if="byId[id]"
        type="button"
        class="pin-tile"
        :class="{ 'pin-ghost': id === dragId }"
        role="listitem"
        :aria-label="byId[id].name"
        :aria-hidden="id === dragId ? 'true' : undefined"
        :data-chat-id="id"
        @click="$emit('open', id)"
        @pointerdown="$emit('press', byId[id], $event)"
        @contextmenu.prevent="$emit('more', byId[id])"
      >
        <div class="pin-avatar">
          <user-avatar :src="byId[id].avatar" :alt="byId[id].name" :attention="byId[id].unread > 0" />
          <ion-badge v-if="byId[id].unread" color="primary" class="pin-badge">{{ byId[id].unread }}</ion-badge>
          <span v-else-if="byId[id].manualUnread" class="pin-dot" aria-hidden="true" />
          <!-- spec 1062: last-outgoing-message tick at the avatar's bottom-left (a pinned
               tile has no preview row), and the online presence dot at the bottom-right. -->
          <span v-if="(byId[id].lastTick ?? 'none') !== 'none'" class="pin-tick">
            <message-tick :tier="byId[id].lastTick ?? 'none'" size="13px" />
          </span>
          <span v-if="isOnline(byId[id])" class="pin-presence" aria-hidden="true" />
          <!-- spec 1062: groups show a compact online count instead of a single dot. -->
          <span
            v-else-if="byId[id].isGroup && groupOnlineCount(byId[id])"
            class="pin-online-count"
            aria-label="online"
          >{{ groupOnlineCount(byId[id]) }}</span>
        </div>
        <span class="pin-name" dir="auto">{{ byId[id].name }}</span>
      </button>
      <!-- A FOREIGN drag (a list row hovering in): no chat data here, so the well is
           its own element. It's never the gesture's touch target, so (un)mounting
           it mid-drag is safe. -->
      <div v-else-if="id === dragId" class="pin-tile pin-ghost" role="listitem" aria-hidden="true">
        <div class="pin-avatar" />
      </div>
    </template>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonBadge } from '@ionic/vue';
import UserAvatar from '@/components/UserAvatar.vue';
import MessageTick from '@/components/MessageTick.vue';
import { peerPresence } from '@/composables/usePresence';
import { groupOnline } from '@/composables/group-online';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { listAllContacts } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';
import type { Chat, Contact } from '@/db/types';

// spec 1062: 1:1 online presence for the tile's bottom-right dot (groups get an
// online count instead — see groupOnlineCount). Reactive via the presence map.
function isOnline(chat: Chat): boolean {
  return !chat.isGroup && !!peerPresence(chat.participantIds[0])?.online;
}

// Shared contact set for group counts (one liveQuery for the whole grid — the tiles
// are one component, so we can't call useGroupPresence per tile). Pure groupOnline()
// keeps the zero-knowledge rule: only members who are my contacts + online are counted.
const selfId = getSelfUserId() ?? '';
const contacts = useLiveQuery(() => listAllContacts(), ['contacts', 'chats'], [] as Contact[]);
const contactIds = computed(() => new Set(contacts.value.map((c) => c.id)));
function groupOnlineCount(chat: Chat): number {
  if (!chat.isGroup) return 0;
  const members = chat.participantIds.filter((id) => id !== selfId);
  return groupOnline(members, contactIds.value, (id) => !!peerPresence(id)?.online).count;
}

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
  /* Ionic's global css puts touch-action: manipulation on every <button>, which
     let the browser pointercancel the drag gesture (spec 1045). `none` fixed the
     drag but ate vertical SCROLLS started on a tile — the list only scrolled from
     the gaps (spec 1052 rider). pan-y is the balance: a vertical swipe scrolls
     (the browser claims it; onPointerCancel cleanly drops the pending press),
     while a held press still lifts — after LIFT_MS the controller's non-passive
     document touchmove blocker owns the finger, so the drag and the
     drag-out-to-unpin keep working on iOS. */
  touch-action: pan-y;
}
/* The avatar <img> must never start a NATIVE image drag under the mouse — the
   browser pointercancels our gesture when it does (belt to the dragstart block
   in useChatDrag). */
.pin-tile img {
  -webkit-user-drag: none;
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
/* The empty well left behind by (or opening up for) the floating avatar. Applied
   to the SAME tile element (CSS only — see the template note about iOS): its
   content hides, the avatar box becomes the well. Hidden via OPACITY, not
   visibility: flipping visibility back while the tile's FLIP transform settles
   hit a WebKit stale-paint bug — the dropped tile's NAME stayed invisible until
   the next grid invalidation (i.e. the next drag). Opacity changes always go
   through the compositor, and the transition forces the repaint. */
.pin-ghost .pin-avatar {
  border-radius: 50%;
  background: color-mix(in srgb, var(--app-text, #000) 8%, transparent);
}
.pin-avatar > *,
.pin-name {
  opacity: 1;
  transition: opacity 0.12s ease;
}
.pin-ghost .pin-avatar > *,
.pin-ghost .pin-name {
  opacity: 0;
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
/* spec 1062: last-outgoing tick at the avatar's bottom-left, in a small chip that
   backs it against the app background so it reads over any avatar. */
.pin-tick {
  position: absolute;
  bottom: -1px;
  inset-inline-start: -1px;
  display: flex;
  align-items: center;
  padding: 1px 3px;
  border-radius: 999px;
  background: var(--ion-background-color, #fff);
  color: var(--app-text-muted);
  line-height: 0;
}
/* spec 1062: online dot at the avatar's bottom-right — the list-row .presence-dot
   pattern, scaled up for the 88px tile with a background-coloured ring to separate
   it from the avatar edge. */
.pin-presence {
  position: absolute;
  bottom: 3px;
  inset-inline-end: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--ion-color-success, #2dd36f);
  border: 2.5px solid var(--ion-background-color, #fff);
  box-sizing: border-box;
}
/* spec 1062: group online count pill at the tile's bottom-right. */
.pin-online-count {
  position: absolute;
  bottom: 2px;
  inset-inline-end: 2px;
  min-width: 19px;
  height: 19px;
  padding: 0 4px;
  border-radius: 10px;
  background: var(--ion-color-success, #2dd36f);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--ion-background-color, #fff);
  box-sizing: border-box;
}
.pin-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  /* A pin tile is a bare <button>, which inherits Ionic's primary (blue) text
     color. --ion-text-color is only defined by the dark palette, so on LIGHT it
     was empty and the name fell through to that blue. --app-text is defined in
     BOTH themes (black on light, white on dark) — the same var the rest of this
     component uses — so the name matches the list rows on either theme. */
  color: var(--app-text);
}
</style>
