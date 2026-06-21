<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings/privacy" />
        </ion-buttons>
        <ion-title>Close friends</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Close friends</ion-title>
        </ion-toolbar>
      </ion-header>

      <p class="hint">
        Pick a smaller circle for posts you mark “Close friends”. This list is private —
        it stays on your device and is never shared with anyone, including the server.
      </p>

      <div v-if="!friends.length" class="empty">Add some friends first to build a close-friends list.</div>

      <ion-list v-else :inset="true">
        <ion-item v-for="f in friends" :key="f.id">
          <ion-avatar slot="start" class="avatar">
            <img v-if="f.avatar" :src="f.avatar" :alt="f.name" />
            <div v-else class="ph">{{ initial(f.name) }}</div>
          </ion-avatar>
          <ion-label>
            {{ f.name }}
            <p v-if="f.username">@{{ f.username }}</p>
          </ion-label>
          <ion-toggle
            slot="end"
            :checked="!!f.closeFriend"
            @ion-change="toggle(f.id, $event)"
          />
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonList, IonItem, IonAvatar, IonLabel, IonToggle, onIonViewWillEnter,
} from '@ionic/vue';
import { ref } from 'vue';
import { listFriends, setCloseFriend } from '@/db/queries';
import type { Contact } from '@/db/types';

const friends = ref<Contact[]>([]);

async function load(): Promise<void> {
  friends.value = await listFriends();
}
onIonViewWillEnter(load);

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
async function toggle(id: string, e: CustomEvent): Promise<void> {
  const checked = (e.detail as { checked?: boolean }).checked ?? false;
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
  padding: 40px 24px;
  text-align: center;
  color: var(--ion-color-medium);
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
