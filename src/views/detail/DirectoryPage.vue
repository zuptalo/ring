<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/contacts" />
        </ion-buttons>
        <ion-title>User directory</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="query"
          placeholder="Search by name or @username"
          :debounce="250"
          @ion-input="onSearch($event.detail.value ?? '')"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-list>
        <ion-item
          v-for="u in results"
          :key="u.id"
          button
          :detail="false"
          @click="openActions(u)"
        >
          <div class="avatar-wrap" slot="start">
            <ion-avatar>
              <img :src="u.avatar || initialsAvatar(u.displayName)" :alt="u.displayName" />
            </ion-avatar>
            <span v-if="peerPresence(u.id)?.online" class="presence-dot" aria-hidden="true" />
          </div>
          <ion-label>
            <h2>{{ u.displayName }}</h2>
            <p class="handle">@{{ u.username }}</p>
            <p v-if="presenceLabel(peerPresence(u.id))" class="status">
              {{ presenceLabel(peerPresence(u.id)) }}
            </p>
          </ion-label>
        </ion-item>
      </ion-list>

      <div v-if="!loading && results.length === 0" class="empty">
        <ion-note>{{ query ? 'No one matches that.' : 'No other members yet.' }}</ion-note>
      </div>
      <div v-if="loading" class="empty">
        <ion-spinner name="crescent" />
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonSearchbar, IonList, IonItem, IonAvatar, IonLabel, IonNote, IonSpinner,
  actionSheetController,
} from '@ionic/vue';
import { fetchDirectory, type DirectoryUser } from '@/services/api';
import { importDirectoryUser } from '@/services/directory';
import { getContact, startDirectChat } from '@/db/queries';
import { ensureProfile } from '@/composables/useProfileGate';
import { initialsAvatar } from '@/db/avatars';
import { peerPresence, presenceLabel } from '@/composables/usePresence';
import { subscribePresence } from '@/composables/useSync';

const router = useRouter();
const query = ref('');
const results = ref<DirectoryUser[]>([]);
const loading = ref(false);

// Token so a slow earlier search can't overwrite a newer one.
let seq = 0;

async function load(q: string): Promise<void> {
  const mine = ++seq;
  loading.value = true;
  try {
    // Strip a leading "@" so searching "@bob" matches the username "bob".
    const term = q.trim().replace(/^@+/, '');
    const { users } = await fetchDirectory({ q: term || undefined, limit: 50 });
    if (mine !== seq) return; // a newer search superseded this one
    results.value = users;
    // Reveal presence for the visible results (server gates per each owner's tier).
    void subscribePresence(users.map((u) => u.id));
  } catch {
    if (mine === seq) results.value = [];
  } finally {
    if (mine === seq) loading.value = false;
  }
}

function onSearch(q: string): void {
  query.value = q;
  void load(q);
}

onMounted(() => void load(''));

// Save someone from the directory: import their profile into contacts.
async function save(u: DirectoryUser): Promise<string | null> {
  return importDirectoryUser(u.id);
}

async function openActions(u: DirectoryUser): Promise<void> {
  const sheet = await actionSheetController.create({
    header: `${u.displayName} · @${u.username}`,
    buttons: [
      {
        text: 'Message',
        handler: () => {
          void (async () => {
            if (!(await ensureProfile())) return; // require a name + photo first
            await save(u);
            const c = await getContact(u.id);
            if (c) router.push(`/chat/${await startDirectChat(c)}`);
          })();
        },
      },
      {
        text: 'Save to contacts',
        handler: () => {
          void (async () => {
            await save(u);
            router.push(`/contact/${u.id}`);
          })();
        },
      },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}
</script>

<style scoped>
.handle {
  color: var(--ion-color-primary);
  font-weight: 500;
}
.status {
  color: var(--app-text-muted);
  font-size: 13px;
}
.empty {
  text-align: center;
  margin-top: 40px;
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
