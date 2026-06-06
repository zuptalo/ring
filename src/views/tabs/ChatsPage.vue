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
          @ion-input="search = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Chats</ion-title>
        </ion-toolbar>
      </ion-header>

      <ion-list>
        <ion-item-sliding v-for="chat in chats" :key="chat.id">
          <ion-item button :detail="false" @click="open(chat.id)">
            <div class="avatar-wrap" slot="start">
              <ion-avatar>
                <img :src="chat.avatar" :alt="chat.name" />
              </ion-avatar>
              <span v-if="online(chat)" class="presence-dot" aria-hidden="true" />
            </div>
            <ion-label>
              <h2>{{ chat.name }}</h2>
              <p class="preview-row">
                <ion-icon
                  v-if="previewIcon(chat.lastKind)"
                  :icon="previewIcon(chat.lastKind)"
                  class="preview-ico"
                  aria-hidden="true"
                />
                <span class="preview">{{ chat.lastMessage }}</span>
              </p>
            </ion-label>
            <div class="meta" slot="end">
              <ion-note>{{ formatTime(chat.lastMessageTime) }}</ion-note>
              <ion-badge v-if="chat.unread" color="primary">{{ chat.unread }}</ion-badge>
            </div>
          </ion-item>
          <ion-item-options side="end">
            <ion-item-option color="danger" @click="removeChat(chat.id)">
              <ion-icon slot="icon-only" :icon="trashOutline" />
            </ion-item-option>
          </ion-item-options>
        </ion-item-sliding>
      </ion-list>

      <div v-if="chats.length === 0" class="empty">
        <ion-note>No chats found</ion-note>
      </div>
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
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonIcon, IonSearchbar, IonContent, IonList, IonListHeader, IonItem, IonAvatar,
  IonLabel, IonNote, IonBadge, IonModal,
  IonItemSliding, IonItemOptions, IonItemOption,
} from '@ionic/vue';
import {
  createOutline, personAddOutline, peopleOutline, trashOutline,
  cameraOutline, videocamOutline, micOutline, documentOutline, imagesOutline,
  locationOutline, barChartOutline, personOutline, musicalNotesOutline,
} from 'ionicons/icons';
import { listChats, listContacts, startDirectChat, deleteChat } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { useConnect } from '@/composables/useConnect';
import { peerPresence } from '@/composables/usePresence';
import { formatTime } from '@/utils/time';
import type { Chat, Contact } from '@/db/types';

const router = useRouter();
const search = ref('');
// Ionic icon shown before a chats-list preview, by the last message's kind.
const PREVIEW_ICONS: Record<NonNullable<Chat['lastKind']>, string | null> = {
  image: cameraOutline,
  video: videocamOutline,
  videonote: videocamOutline,
  voice: micOutline,
  file: documentOutline,
  album: imagesOutline,
  location: locationOutline,
  poll: barChartOutline,
  contact: personOutline,
  audio: musicalNotesOutline,
  text: null,
  reaction: null,
};
const previewIcon = (kind?: Chat['lastKind']) => (kind ? PREVIEW_ICONS[kind] : null);
// Green dot on a 1:1 chat's avatar when the peer is online.
const online = (chat: Chat) =>
  !chat.isGroup && !!peerPresence(chat.participantIds?.[0] ?? '')?.online;
const removeChat = (id: string) => deleteChat(id);
const { connect, requireProfile } = useConnect();
const chats = useLiveQuery(
  () => listChats(search.value),
  ['chats', 'messages'],
  [],
  () => search.value,
);

function open(id: string) {
  router.push(`/chat/${id}`);
}

/* ---- New chat modal ---- */
const newOpen = ref(false);
const pickSearch = ref('');
const pickContacts = useLiveQuery(
  () => listContacts(pickSearch.value),
  ['contacts', 'chats'], // listContacts hides contacts whose 1:1 chat is pending
  [],
  () => pickSearch.value,
);

async function startChat(person: Contact) {
  if (!(await requireProfile())) return; // require a name + photo before messaging
  const chatId = await startDirectChat(person);
  newOpen.value = false;
  router.push(`/chat/${chatId}`);
}

// Close the New-chat modal and run the shared add-contact flow (same as the
// Contacts tab's add button: gated on profile → invite / scan / add by ID).
function addNew() {
  newOpen.value = false;
  void connect();
}

// Start a new group (name + pick members). Gated on a complete profile.
async function newGroup() {
  if (!(await requireProfile())) return;
  newOpen.value = false;
  router.push('/new-group');
}
</script>

<style scoped>
.meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
/* Last-message preview: wrap to at most 2 lines (ellipsis beyond), and always
   reserve those 2 lines so every row is the same height even for a 1-char message. */
.preview-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  height: 2.6em; /* 2 lines × line-height, reserved so every row is equal height */
}
.preview-ico {
  flex: none;
  font-size: 16px;
  margin-top: 2px;
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
}
/* Online indicator overlaid on the avatar (trivial layout CSS). */
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
.empty {
  text-align: center;
  margin-top: 40px;
}
</style>
