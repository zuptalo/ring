<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings/privacy" />
        </ion-buttons>
        <ion-title>Close friends</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search friends"
          :debounce="120"
          @ion-input="onSearch"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <p class="hint">
        Pick a smaller circle for posts you mark “Close friends”. This list is private. It stays on
        your device and is never shared with anyone, including the server.
      </p>

      <div v-if="!friends.length" class="empty">Add some friends first to build a close-friends list.</div>

      <template v-else>
        <!-- Close friends, shown first and highlighted. -->
        <ion-list v-if="closeFriends.length" :inset="true" class="closelist">
          <ion-list-header>
            <ion-icon :icon="star" color="primary" />
            <ion-label>Close friends · {{ closeFriends.length }}</ion-label>
          </ion-list-header>
          <ion-item v-for="f in closeFriends" :key="f.id" class="closeitem">
            <ion-avatar slot="start" class="avatar">
              <img v-if="f.avatar" :src="f.avatar" :alt="f.name" />
              <div v-else class="ph">{{ initial(f.name) }}</div>
            </ion-avatar>
            <ion-label>
              {{ f.name }}
              <p v-if="f.username">@{{ f.username }}</p>
            </ion-label>
            <ion-toggle slot="end" :checked="true" @ion-change="toggle(f.id, $event)" />
          </ion-item>
        </ion-list>

        <!-- Everyone else. -->
        <ion-list :inset="true">
          <ion-list-header><ion-label>Friends</ion-label></ion-list-header>
          <ion-item v-for="f in otherFriends" :key="f.id">
            <ion-avatar slot="start" class="avatar">
              <img v-if="f.avatar" :src="f.avatar" :alt="f.name" />
              <div v-else class="ph">{{ initial(f.name) }}</div>
            </ion-avatar>
            <ion-label>
              {{ f.name }}
              <p v-if="f.username">@{{ f.username }}</p>
            </ion-label>
            <ion-toggle slot="end" :checked="false" @ion-change="toggle(f.id, $event)" />
          </ion-item>
          <div v-if="!otherFriends.length && !closeFriends.length" class="empty">No friends match “{{ search }}”.</div>
        </ion-list>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonList, IonListHeader, IonItem, IonAvatar, IonLabel, IonToggle, IonIcon, IonSearchbar,
  onIonViewWillEnter,
} from '@ionic/vue';
import { computed, ref } from 'vue';
import { star } from 'ionicons/icons';
import { listFriends, setCloseFriend } from '@/db/queries';
import type { Contact } from '@/db/types';

const friends = ref<Contact[]>([]);
const search = ref('');

async function load(): Promise<void> {
  friends.value = await listFriends();
}
onIonViewWillEnter(load);

function onSearch(e: CustomEvent): void {
  search.value = (e.detail as { value?: string | null }).value ?? '';
}
const matches = (f: Contact): boolean => {
  const q = search.value.trim().toLowerCase();
  return !q || f.name.toLowerCase().includes(q) || (f.username ?? '').toLowerCase().includes(q);
};
const closeFriends = computed(() => friends.value.filter((f) => f.closeFriend && matches(f)));
const otherFriends = computed(() => friends.value.filter((f) => !f.closeFriend && matches(f)));

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
async function toggle(id: string, e: CustomEvent): Promise<void> {
  const checked = (e.detail as { checked?: boolean }).checked ?? false;
  // Removing a close friend revokes your close-only posts from them (handled in
  // setCloseFriend); adding just sets the flag.
  await setCloseFriend(id, checked);
  const f = friends.value.find((c) => c.id === id);
  if (f) f.closeFriend = checked;
}
</script>

<style scoped>
.hint {
  margin: 4px 20px 8px;
  font-size: 13px;
  color: var(--app-text-muted, var(--ion-color-medium));
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--ion-color-medium);
}
ion-list-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.closelist {
  border: 1px solid color-mix(in srgb, var(--ion-color-primary) 35%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--ion-color-primary) 6%, transparent);
}
.closeitem {
  --background: transparent;
}
.avatar {
  width: 40px;
  height: 40px;
}
.avatar .ph {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--ion-color-step-150, rgba(120, 120, 128, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}
</style>
