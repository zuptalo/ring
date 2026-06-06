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
            <img :src="contact.avatar" :alt="contact.name" />
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
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton,
  IonContent, IonAvatar, IonButton, IonIcon, IonList, IonItem, IonLabel,
  toastController, alertController,
} from '@ionic/vue';
import { chatbubbleOutline, searchOutline, banOutline } from 'ionicons/icons';
import { computed } from 'vue';
import { getContact, startDirectChat, blockContact, unblockContact } from '@/db/queries';
import { ensureProfile } from '@/composables/useProfileGate';
import type { Contact } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { peerPresence, presenceLabel } from '@/composables/usePresence';

const route = useRoute();
const router = useRouter();
const contactId = route.params.id as string;

const contact = useLiveQuery<Contact | undefined>(
  () => getContact(contactId),
  ['contacts'],
  undefined,
);

// Online / last-seen line under the name ('' when unknown / hidden).
const statusLine = computed(() => presenceLabel(peerPresence(contactId)));

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
              void toastController
                .create({ message: 'Could not block. Try again.', duration: 1500, color: 'danger' })
                .then((t) => t.present());
            }
          })();
        },
      },
    ],
  });
  await alert.present();
}

async function unblock() {
  try {
    await unblockContact(contactId);
  } catch {
    void toastController
      .create({ message: 'Could not unblock. Try again.', duration: 1500, color: 'danger' })
      .then((t) => t.present());
  }
}

function copyUsername() {
  if (!contact.value?.username) return;
  void navigator.clipboard?.writeText(`@${contact.value.username}`);
  void toastController.create({ message: 'Username copied', duration: 1200 }).then((t) => t.present());
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
