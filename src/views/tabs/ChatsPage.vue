<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Chats</ion-title>
        <ion-buttons slot="end">
          <ion-button aria-label="New chat" @click="newOpen = true">
            <ion-icon slot="icon-only" :icon="createOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search"
          @ion-input="onSearchInput($event.detail.value ?? '')"
        />
      </ion-toolbar>
      <ion-toolbar>
        <ChatFilterBar :chips="chips" :active="activeFilter" @select="setActive" @open-more="listsSheetOpen = true" />
      </ion-toolbar>
    </ion-header>

    <ion-content ref="contentRef" :fullscreen="true">
      <!-- Pull down to recover: force a fresh reconnect so the server re-runs its on-connect
           queue flush and we pull anything missed while the socket was dropped. -->
      <ion-refresher slot="fixed" @ion-refresh="onPullRefresh">
        <ion-refresher-content pulling-text="Pull to reconnect &amp; catch up" refreshing-text="Reconnecting…" />
      </ion-refresher>
      <!-- The iOS large title yields its space to the pinned grid when pins exist
           (spec 1044): the grid already anchors the page visually, and stacking
           both pushed the first rows below the fold. -->
      <ion-header v-if="!(ready && gridChats.length)" collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Chats</ion-title>
        </ion-toolbar>
      </ion-header>

      <ion-list>
        <!-- Archived entry (only when something is archived). -->
        <ion-item v-if="archivedCount > 0" button :detail="true" @click="router.push('/chats/archived')">
          <ion-icon slot="start" :icon="archiveOutline" color="medium" />
          <ion-label>Archived</ion-label>
          <ion-note slot="end">{{ archivedCount }}</ion-note>
        </ion-item>
        <!-- Locked chats entry (no count, to avoid revealing how many). Gated on open. -->
        <ion-item v-if="hasLocked" button :detail="true" @click="router.push('/chats/locked')">
          <ion-icon slot="start" :icon="lockClosedOutline" color="medium" />
          <ion-label>Locked chats</ion-label>
        </ion-item>
        <!-- Reveal-session affordance: only present WHILE revealed, so it leaks no
             signal otherwise. Tapping re-hides immediately (spec 1019, FR-006/US3). -->
        <ion-item v-if="revealed" button :detail="false" lines="full" @click="relock">
          <ion-icon slot="start" :icon="eyeOffOutline" color="medium" />
          <ion-label>Hide hidden chats</ion-label>
        </ion-item>
        <!-- Revealed hidden chats: their own block right under the reveal
             affordance, ABOVE the pinned grid (spec 1052 rider) — the hidden
             section reads as one unit while it exists. -->
        <ChatListItem
          v-for="chat in hiddenRows"
          :key="'hidden-' + chat.id"
          :chat="chat"
          :draft="draftFor(chat.id)"
          :lifted="dragActive && dragState.origin === 'list' && dragState.chat?.id === chat.id"
          @open="open"
          @more="(c) => actions?.openMore(c)"
          @press="(c, e) => pressStart(e, c, 'list')"
        />

        <!-- First-pin drop zone (spec 1045): with NO pins there is no grid to drop
             on, so while a row is lifted this stands in where the grid would be.
             Its element doubles as the drag controller's grid target. -->
        <div
          v-if="showFirstPinZone"
          ref="dropZone"
          class="pin-dropzone"
          :class="{ hover: dragState.hoverIndex != null }"
          aria-hidden="true"
        >
          <div class="dz-well"><ion-icon :icon="pinOutline" /></div>
          <span class="dz-label">Drag here to pin</span>
        </div>

        <!-- Pinned chats: the iMessage-style avatar grid (spec 1044), in the user's
             own order with drag-to-rearrange (spec 1045). Gated on `ready` so the
             fail-closed hidden state can't flash tiles at cold open. -->
        <PinnedChatsGrid
          v-if="ready && gridChats.length"
          ref="gridComp"
          :chats="gridChats"
          :display-order="gridOrder"
          :drag-id="dragActive ? dragState.chat?.id ?? null : null"
          @open="open"
          @more="(c) => actions?.openMore(c)"
          @press="(c, e) => pressStart(e, c, 'grid')"
        />

        <ChatListItem
          v-for="chat in listChats"
          :key="chat.id"
          :chat="chat"
          :draft="draftFor(chat.id)"
          :lifted="dragActive && dragState.origin === 'list' && dragState.chat?.id === chat.id"
          @open="open"
          @more="(c) => actions?.openMore(c)"
          @press="(c, e) => pressStart(e, c, 'list')"
        />
      </ion-list>

      <!-- Empty states. With no chats at all, a hint row points to Contacts to
           start a conversation (mirrors the Contacts "Browse user directory" row);
           a filtered view that happens to be empty just says so. -->
      <ion-list v-if="ready && activeFilter === 'all' && allChats.length === 0" class="hint-list">
        <!-- router.replace (not push): switching to a tab is terminal, like tapping
             the tab bar — it must not grow history (see navigation.spec). -->
        <ion-item button :detail="true" lines="full" @click="router.replace('/tabs/contacts')">
          <ion-icon slot="start" :icon="peopleOutline" color="primary" />
          <ion-label>
            <h2>Start a conversation</h2>
            <p>Pick a contact to chat with</p>
          </ion-label>
        </ion-item>
      </ion-list>
      <div v-else-if="ready && chats.length === 0 && pinParts.grid.length === 0" class="empty">
        <ion-note>{{ emptyMessage }}</ion-note>
      </div>

      <ChatActionsHost ref="actions" />

      <!-- Long-press peek (spec 1045): read-only preview + quick actions. -->
      <ChatPeekOverlay
        :chat="peekChat"
        :is-open="peekOpen"
        @dismiss="peekOpen = false"
        @open="(id) => { peekOpen = false; router.push(`/chat/${id}`); }"
        @more="onPeekMore"
      />

      <!-- The floating drag proxy (spec 1045): the lifted chat's avatar riding the
           pointer. Pin-shaped for BOTH origins (a lifted row "becomes a pin"); shows
           the ⊘ badge when the grid is full and this row can't land there. -->
      <Teleport to="body">
        <div
          v-if="dragActive && dragState.chat"
          class="drag-proxy"
          :class="{ dragging: dragState.phase === 'dragging' }"
          :style="proxyStyle"
          aria-hidden="true"
        >
          <div class="proxy-avatar">
            <user-avatar :src="dragState.chat.avatar" :alt="dragState.chat.name" />
            <span v-if="dragState.blocked" class="proxy-ban">
              <ion-icon :icon="banOutline" />
            </span>
            <ion-badge v-else-if="dragState.chat.unread" color="primary" class="proxy-badge">
              {{ dragState.chat.unread }}
            </ion-badge>
          </div>
          <span class="proxy-name" dir="auto">{{ dragState.chat.name }}</span>
        </div>
      </Teleport>

      <!-- Lists "More" sheet + Edit Chats tab editor + New/Edit list (chip-row flows). -->
      <ChatListsSheet
        :is-open="listsSheetOpen"
        :lists="lists"
        :tab-filters="tabFilters"
        @dismiss="onSheetDismiss"
        @edit="queueAfterSheet(() => (editTabsOpen = true))"
        @new-list="queueAfterSheet(openNewList)"
        @edit-list="(id) => queueAfterSheet(() => openEditList(id))"
        @select="(id) => { setActive(id); listsSheetOpen = false; }"
      />
      <EditChatTabsModal
        :is-open="editTabsOpen"
        :lists="lists"
        :tab-filters="tabFilters"
        @dismiss="editTabsOpen = false"
      />
      <NewListModal
        :is-open="newListOpen"
        :list-id="editListId"
        @dismiss="newListOpen = false; editListId = null;"
        @created="(id) => { newListOpen = false; editListId = null; setActive(`list:${id}`); }"
      />
    </ion-content>

    <!-- New chat: pick a contact to start (or open) a direct chat. -->
    <ion-modal :is-open="newOpen" @did-dismiss="newOpen = false">
      <ion-header :translucent="true">
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="newOpen = false">Cancel</ion-button>
          </ion-buttons>
          <ion-title>New chat</ion-title>
        </ion-toolbar>
        <ion-toolbar>
          <ion-searchbar
            :value="pickSearch"
            placeholder="Search name"
            @ion-input="pickSearch = $event.detail.value ?? ''"
          />
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <ion-list>
          <ion-item button :detail="true" @click="newGroup">
            <ion-icon slot="start" :icon="peopleOutline" color="primary" />
            <ion-label>New group</ion-label>
          </ion-item>
          <ion-item button :detail="true" @click="addNew">
            <ion-icon slot="start" :icon="personAddOutline" color="primary" />
            <ion-label>Add contact</ion-label>
          </ion-item>
          <!-- Deliberately NO "New hidden chat" entry here (spec 1019): surfacing it
               in the New-chat sheet would advertise the feature to anyone who opens
               it, undercutting the plausible deniability the whole design rests on.
               A hidden chat is only ever created by hiding an existing conversation
               (the swipe → More → "Hide chat" action). -->
        </ion-list>
        <ion-list>
          <ion-list-header><ion-label>Contacts</ion-label></ion-list-header>
          <ion-item
            v-for="person in pickContacts"
            :key="person.id"
            button
            :detail="false"
            @click="startChat(person)"
          >
            <ion-avatar slot="start">
              <user-avatar :src="person.avatar" :alt="person.name" />
            </ion-avatar>
            <ion-label>
              <h2>{{ person.name }}</h2>
              <p>{{ person.about }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </ion-content>
    </ion-modal>
  </ion-page>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonIcon, IonSearchbar, IonContent, IonList, IonListHeader, IonItem, IonAvatar,
  IonLabel, IonNote, IonModal, IonRefresher, IonRefresherContent, IonBadge,
  type RefresherCustomEvent,
} from '@ionic/vue';
import {
  createOutline, personAddOutline, peopleOutline, archiveOutline, lockClosedOutline,
  eyeOffOutline, banOutline, pinOutline,
} from 'ionicons/icons';
import ChatListItem from '@/components/ChatListItem.vue';
import PinnedChatsGrid from '@/components/PinnedChatsGrid.vue';
import ChatPeekOverlay from '@/components/ChatPeekOverlay.vue';
import { partitionPinned, MAX_PINNED_CHATS } from '@/utils/chat-pins';
import { useChatDrag } from '@/composables/useChatDrag';
import ChatActionsHost from '@/components/ChatActionsHost.vue';
import ChatFilterBar from '@/components/ChatFilterBar.vue';
import ChatListsSheet from '@/components/ChatListsSheet.vue';
import EditChatTabsModal from '@/components/EditChatTabsModal.vue';
import NewListModal from '@/components/NewListModal.vue';
import {
  listArchivedChats, listLockedChats, listContacts, startDirectChat, getSetting, listDrafts,
  ensurePinRanks, setPinnedOrder, setChatPinned,
} from '@/db/queries';
import { appToast } from '@/services/toast';
import { useChatFilters } from '@/services/chat-filters';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useConnect } from '@/composables/useConnect';
import { useHiddenChats } from '@/composables/useHiddenChats';
import { hiddenPinLength } from '@/services/hidden-chats';
import { isHiddenId } from '@/services/hidden-state';
import { isUnlocked } from '@/services/crypto/identity';
import type { Chat, Contact, ChatDraft } from '@/db/types';

const router = useRouter();

// Pull-to-refresh = recovery: force a fresh socket so the server re-flushes its on-connect
// queue (pulling anything missed while it was dropped). It's fire-and-forget, so hold the
// control briefly to give the reconnect + drain a moment, then release.
// NB: import useSync DYNAMICALLY here, not statically — a static edge from this page reorders
// module eval and trips a useSync↔useCall circular-import TDZ (`syncState` before init).
async function onPullRefresh(e: RefresherCustomEvent): Promise<void> {
  const { forceReconnect } = await import('@/composables/useSync');
  forceReconnect();
  await new Promise((r) => setTimeout(r, 1200));
  void e.detail.complete();
}
const search = ref('');
const actions = ref<InstanceType<typeof ChatActionsHost> | null>(null);
const { connect, requireProfile } = useConnect();

// Hidden Chats reveal gesture (spec 1019, US3): typing the dedicated PIN into the
// chat search bar reveals hidden chats — the only entry point, so it leaks nothing
// when unused. A non-matching query behaves as ordinary search.
const { revealed, reveal, relock } = useHiddenChats();
const pinLen = ref<number | null>(null);
const hiddenEnabled = ref(false);
onMounted(async () => {
  // Stamp arrangement ranks onto pins that predate spec 1045 (one-time, idempotent)
  // so the grid's order is stable from this build's first run.
  void ensurePinRanks();
  pinLen.value = await hiddenPinLength();
  hiddenEnabled.value = await getSetting<boolean>('privacy.hiddenChatsEnabled', false);
});
async function onSearchInput(val: string): Promise<void> {
  search.value = val;
  if (revealed.value) return;
  if (!hiddenEnabled.value) return; // FR-013a: disabled → the reveal gesture is inert
  if (!/^\d{4,}$/.test(val)) return; // only attempt on a numeric, PIN-shaped query
  if (pinLen.value == null) pinLen.value = await hiddenPinLength(); // PIN may have been set this session
  if (pinLen.value && val.length === pinLen.value && (await reveal(val))) {
    search.value = ''; // clear the PIN so the revealed list shows, not a filtered-by-PIN view
  }
}

// Filtered chat list + chips (All / Unread / Favorites / Groups + lists).
const { chats, activeFilter, setActive, chips, lists, tabFilters, allChats, loaded } = useChatFilters(search);
// Don't render an empty state until the list has settled on a result we can trust.
// At cold open the query can resolve to [] while the keystore is still locked
// (listChats fails CLOSED until the hidden set is known — see queries.ts), and that
// transient empty must NOT be read as "you have no chats" and flash the
// "Start a conversation" hint before the real chats load. Gating on isUnlocked alone
// isn't enough: there's a sub-frame window where the keystore is unlocked but the
// list hasn't re-queried yet, so allChats still holds the stale []. We therefore flip
// `ready` only when a query RESOLVES while unlocked — i.e. allChats changes after
// unlock — at which point allChats holds the real result and the checks below are
// consistent with what we render. A re-lock resets it so we wait again.
const ready = ref(false);
watch(isUnlocked, (u) => { if (!u) ready.value = false; });
watch(allChats, () => { if (isUnlocked.value) ready.value = true; }, { immediate: true });
// Pinned grid vs list rows (spec 1044): on the All chip with no search, pinned chats
// render as the avatar grid and LEAVE the list; searching or any other chip shows
// everything as plain rows so pins stay findable. `chats` is already pinned-first
// and hidden-fail-closed, so the grid inherits both.
const pinParts = computed(() =>
  partitionPinned(chats.value, { filterAll: activeFilter.value === 'all', searching: !!search.value.trim() }),
);

/* ---- Pinned-grid drag + long-press peek (spec 1045) ---- */

// Optimistic grid order: set at drop time so the grid doesn't flash back to the
// pre-drop order in the beat between the gesture ending and the IndexedDB write
// landing in the live query. Cleared when the query catches up (watch below) or
// by the safety timeout (a failed write must not wedge the UI).
const optimisticGrid = ref<string[] | null>(null);
let optimisticClear: ReturnType<typeof setTimeout> | null = null;
function setOptimistic(ids: string[]): void {
  optimisticGrid.value = ids;
  if (optimisticClear) clearTimeout(optimisticClear);
  optimisticClear = setTimeout(() => (optimisticGrid.value = null), 1500);
}
watch(pinParts, (p) => {
  const o = optimisticGrid.value;
  if (!o) return;
  const ids = p.grid.map((c) => c.id);
  if (ids.length === o.length && ids.every((id, i) => id === o[i])) optimisticGrid.value = null;
});

// What the grid/list actually render: the optimistic projection when one is
// pending, else the query's partition. A just-pinned row leaves the list at
// once; a just-unpinned tile re-enters it when the write lands (recency decides
// its slot, so there's nothing sensible to project meanwhile).
const chatById = computed(() => {
  const m = new Map<string, Chat>();
  for (const c of chats.value) m.set(c.id, c);
  return m;
});
// Revealed hidden chats surface as their OWN block above the pinned area
// (spec 1052 rider): hidden things live in the hidden section, so they leave
// the grid and the plain rows while revealed. isHiddenId reads the reveal
// session's cache — `revealed` in each computed provides the reactivity edge.
const hiddenRows = computed<Chat[]>(() =>
  revealed.value ? chats.value.filter((c) => isHiddenId(c.id)) : [],
);
const gridChats = computed<Chat[]>(() => {
  const o = optimisticGrid.value;
  const grid = !o ? pinParts.value.grid : o.map((id) => chatById.value.get(id)).filter((c): c is Chat => !!c);
  return revealed.value ? grid.filter((c) => !isHiddenId(c.id)) : grid;
});
const listChats = computed<Chat[]>(() => {
  const o = optimisticGrid.value;
  const base = !o ? pinParts.value.list : pinParts.value.list.filter((c) => !new Set(o).has(c.id));
  return revealed.value ? base.filter((c) => !isHiddenId(c.id)) : base;
});

const gridComp = ref<{ el: () => HTMLElement | null } | null>(null);
// The first-pin drop zone (no pins yet): shown only while a ROW is lifted on the
// All view — the only context where the grid (and so drag-pinning) exists.
const dropZone = ref<HTMLElement | null>(null);
const showFirstPinZone = computed(
  () =>
    dragActive.value &&
    dragState.origin === 'list' &&
    gridChats.value.length === 0 &&
    activeFilter.value === 'all' &&
    !search.value.trim(),
);
const contentRef = ref<{ $el: HTMLIonContentElement } | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
onMounted(async () => {
  scrollEl.value = (await contentRef.value?.$el.getScrollElement()) ?? null;
});

const peekChat = ref<Chat | null>(null);
const peekOpen = ref(false);
// The peek's More… bridges to the full actions sheet; give the overlay's leave
// transition a beat so the sheet's own enter animation isn't swallowed.
function onPeekMore(chat: Chat): void {
  peekOpen.value = false;
  setTimeout(() => actions.value?.openMore(chat), 220);
}

const { state: dragState, displayIds: gridOrder, pressStart, consumeClickSwallow } = useChatDrag({
  gridEl: () => gridComp.value?.el() ?? dropZone.value,
  scrollEl: () => scrollEl.value,
  pinnedIds: () => optimisticGrid.value ?? pinParts.value.grid.map((c) => c.id),
  maxPins: MAX_PINNED_CHATS,
  onReorder: (ids) => {
    setOptimistic(ids);
    void setPinnedOrder(ids);
  },
  onUnpin: (id) => {
    setOptimistic((optimisticGrid.value ?? pinParts.value.grid.map((c) => c.id)).filter((x) => x !== id));
    void setChatPinned(id, false);
  },
  onPin: (id, at) => {
    const base = optimisticGrid.value ?? pinParts.value.grid.map((c) => c.id);
    const next = [...base];
    next.splice(Math.min(at, next.length), 0, id);
    setOptimistic(next);
    void setChatPinned(id, true, at).then((ok) => {
      if (ok) return;
      optimisticGrid.value = null; // raced past the cap (e.g. another device pinned)
      void appToast({ message: `You can only pin ${MAX_PINNED_CHATS} chats.`, duration: 2200 });
    });
  },
  onPeek: (chat) => {
    peekChat.value = chat;
    peekOpen.value = true;
  },
});
const dragActive = computed(() => dragState.phase === 'lifted' || dragState.phase === 'dragging');
// The proxy follows the pointer, hovering just above the finger. transform-only
// updates so tracking stays cheap at 60fps.
const proxyStyle = computed(() => ({
  transform: `translate3d(${dragState.x - 44}px, ${dragState.y - 100}px, 0)`,
}));
const listsSheetOpen = ref(false);
const editTabsOpen = ref(false);
const newListOpen = ref(false);
const editListId = ref<string | null>(null);

function openNewList(): void {
  editListId.value = null;
  newListOpen.value = true;
}
function openEditList(id: string): void {
  editListId.value = id;
  newListOpen.value = true;
}

// Opening a modal while the bottom sheet is still dismissing drops the new modal's
// transition, so defer the next action until the sheet has fully dismissed.
const afterSheet = ref<(() => void) | null>(null);
function queueAfterSheet(fn: () => void): void {
  afterSheet.value = fn;
  listsSheetOpen.value = false; // triggers the sheet's did-dismiss → onSheetDismiss
}
function onSheetDismiss(): void {
  listsSheetOpen.value = false;
  const fn = afterSheet.value;
  afterSheet.value = null;
  fn?.();
}

// Contextual empty-state copy for a filtered view that has no matches.
const emptyMessage = computed(() => {
  switch (activeFilter.value) {
    case 'unread':
      return 'No unread chats';
    case 'favorites':
      return 'No favorite chats yet';
    case 'groups':
      return 'No group chats';
    default:
      return activeFilter.value.startsWith('list:') ? 'No chats in this list yet' : 'No chats';
  }
});

// Count for the Archived entry row.
const archived = useLiveQuery(() => listArchivedChats(), ['chats', 'messages'], [] as Chat[]);
const archivedCount = computed(() => archived.value.length);
// Whether any chat is locked (entry shows; count hidden for privacy).
const locked = useLiveQuery(() => listLockedChats(), ['chats', 'messages'], [] as Chat[]);
const hasLocked = computed(() => locked.value.length > 0);

// Unsent drafts → mark the chat row with a "Draft" preview (spec: keep-your-place). Keyed by chatId;
// a row shows it instead of the last message until the draft is sent or cleared.
const drafts = useLiveQuery(() => listDrafts(), ['drafts'], [] as ChatDraft[]);
const draftMap = computed(() => {
  const m = new Map<string, string>();
  for (const d of drafts.value) {
    // A draft is text, a started reply, and/or staged attachments. The preview is the text if any,
    // otherwise a label for the attachments (e.g. "Photo", "3 attachments").
    if (d.text?.trim() || d.reply || d.mediaCount) m.set(d.chatId, d.text?.trim() || d.mediaLabel || '');
  }
  return m;
});
const draftFor = (id: string): string | undefined => draftMap.value.get(id);

function open(id: string) {
  // A completed lift/drag/peek must not ALSO open the chat via the trailing click.
  if (consumeClickSwallow()) return;
  router.push(`/chat/${id}`);
}

/* ---- New chat modal ---- */
const newOpen = ref(false);
const pickSearch = ref('');
const pickContacts = useLiveQuery(
  () => listContacts(pickSearch.value),
  ['contacts', 'chats'],
  [] as Contact[],
  () => pickSearch.value,
);

async function startChat(person: Contact) {
  if (!(await requireProfile())) return;
  const chatId = await startDirectChat(person);
  newOpen.value = false;
  router.push(`/chat/${chatId}`);
}

function addNew() {
  newOpen.value = false;
  void connect();
}

async function newGroup() {
  if (!(await requireProfile())) return;
  newOpen.value = false;
  router.push('/new-group');
}
</script>

<style scoped>
/* Empty state: a filtered-but-empty view just shows a short label near the top. */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-top: 40px;
}
/* First-pin drop zone (spec 1045): a dashed well where the pinned grid will be,
   shown only mid-drag when there are no pins yet. */
.pin-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px 10px;
}
.dz-well {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  border: 2px dashed color-mix(in srgb, var(--app-text, #000) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-muted, var(--ion-color-medium));
  font-size: 30px;
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}
.dz-label {
  font-size: 13px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
/* The lifted avatar is over the zone: light up so the drop reads as accepted. */
.pin-dropzone.hover .dz-well {
  border-color: var(--ion-color-primary, #10b981);
  background: color-mix(in srgb, var(--ion-color-primary, #10b981) 12%, transparent);
  color: var(--ion-color-primary, #10b981);
  transform: scale(1.06);
}

/* "Start a conversation" hint row, flush at the top like the Contacts browse row. */
.hint-list {
  padding-top: 0;
}
.hint-list ion-icon {
  font-size: 24px;
}
</style>

<style>
/* The drag proxy teleports to <body>, so its styles must be unscoped. */
.drag-proxy {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 10001;
  width: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none; /* the pointer stays on the page underneath */
  filter: drop-shadow(0 12px 22px rgba(0, 0, 0, 0.35));
  transition: scale 0.15s ease;
  scale: 1.06;
}
.drag-proxy.dragging {
  scale: 1.12;
}
.drag-proxy .proxy-avatar {
  position: relative;
  width: 88px;
  height: 88px;
}
.drag-proxy .proxy-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ion-text-color);
}
.drag-proxy .proxy-badge {
  position: absolute;
  top: -2px;
  inset-inline-end: -6px;
  border-radius: 10px;
}
/* No room in the grid (9 pins): the forbidden badge at the proxy's top right. */
.drag-proxy .proxy-ban {
  position: absolute;
  top: -4px;
  inset-inline-end: -8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--ion-color-danger, #eb445a);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.drag-proxy .proxy-ban ion-icon {
  font-size: 18px;
}
</style>
