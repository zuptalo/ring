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

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
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

        <ChatListItem
          v-for="chat in chats"
          :key="chat.id"
          :chat="chat"
          @open="open"
          @more="(c) => actions?.openMore(c)"
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
      <div v-else-if="ready && chats.length === 0" class="empty">
        <ion-note>{{ emptyMessage }}</ion-note>
      </div>

      <ChatActionsHost ref="actions" />

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
              <img :src="person.avatar" :alt="person.name" />
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
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonIcon, IonSearchbar, IonContent, IonList, IonListHeader, IonItem, IonAvatar,
  IonLabel, IonNote, IonModal,
} from '@ionic/vue';
import {
  createOutline, personAddOutline, peopleOutline, archiveOutline, lockClosedOutline,
  eyeOffOutline,
} from 'ionicons/icons';
import ChatListItem from '@/components/ChatListItem.vue';
import ChatActionsHost from '@/components/ChatActionsHost.vue';
import ChatFilterBar from '@/components/ChatFilterBar.vue';
import ChatListsSheet from '@/components/ChatListsSheet.vue';
import EditChatTabsModal from '@/components/EditChatTabsModal.vue';
import NewListModal from '@/components/NewListModal.vue';
import { listArchivedChats, listLockedChats, listContacts, startDirectChat, getSetting } from '@/db/queries';
import { useChatFilters } from '@/services/chat-filters';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useConnect } from '@/composables/useConnect';
import { useHiddenChats } from '@/composables/useHiddenChats';
import { hiddenPinLength } from '@/services/hidden-chats';
import { isUnlocked } from '@/services/crypto/identity';
import type { Chat, Contact } from '@/db/types';

const router = useRouter();
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

function open(id: string) {
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
/* "Start a conversation" hint row, flush at the top like the Contacts browse row. */
.hint-list {
  padding-top: 0;
}
.hint-list ion-icon {
  font-size: 24px;
}
</style>
